import type { NextRequest } from "next/server";
import { getSessionId } from "@/lib/session";
import { ServiceError, jsonError } from "@/lib/api-helpers";
import { checkRate, pruneRateStore } from "@/lib/rate-limit";
import {
  commitPact,
  deletePact,
  getPactDetail,
  listPacts,
  recordOutcome,
  scorePlacement,
  verifyPact,
} from "@/lib/service";
import { matchTaxon } from "@/lib/taxonomy/gbif";
import { fetchSky } from "@/lib/weather/open-meteo";
import { SITE, siteOrigin } from "@/lib/config";
import { ENGINE_VERSION, ALERT_THRESHOLD, killerNote } from "@/lib/engine/verdict";
import { MODEL_CARD, MODEL_VERSION } from "@/lib/model/infer";
import { LABELING_VERSION } from "@/lib/engine/labeling";
import { GENESIS_SEAL, SEAL_ALGORITHM } from "@/lib/integrity/chain";
import { getRepository } from "@/lib/db";
import { parseOutcome, parsePlacement } from "@/lib/validation";
import type { PlacementInput } from "@/lib/validation";
import type { EngineVerdict, SkyBundle } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * MCP-style JSON-RPC 2.0 endpoint.
 *
 * Speaks initialize / tools/list / tools/call plus ping, with real JSON-RPC
 * error codes and typed input schemas. Every tool calls the same service layer
 * the browser UI calls, so an agent that commits a pact and a person who
 * commits a pact produce byte-identical rows and identical seal chains.
 *
 * OWNERSHIP: tools are scoped to the caller's anonymous HTTP-only session
 * cookie, exactly like the UI. There are no accounts and no shared global
 * state, so an agent can only ever touch the pacts of the session that made
 * the call.
 *
 * IDEMPOTENCY: the three mutating tools accept an idempotency key. commit_pact
 * returns the existing pact with created=false when a key is replayed;
 * record_outcome refuses to close a pact twice (409 conflict rather than a
 * second event).
 */

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "plant-pact";

const PLACEMENT_PROPERTIES = {
  speciesSlug: { type: "string", description: "Catalogue slug, e.g. golden-pothos. GET /api/species lists them." },
  plantLabel: { type: "string", description: "What you call this plant, e.g. \"the office one\"." },
  friendName: { type: "string", description: "Who is receiving it." },
  placeLabel: { type: "string", description: "Where it will live, e.g. \"Berlin, Germany\"." },
  latitude: { type: "number", minimum: -90, maximum: 90, description: "Latitude of the recipient's location." },
  longitude: { type: "number", minimum: -180, maximum: 180, description: "Longitude of the recipient's location." },
  windowLabel: { type: "string", description: "The window itself, e.g. \"bedroom, first floor\"." },
  windowAspect: {
    type: "string",
    enum: ["north", "east", "south", "west", "unknown"],
    description: "Which way the window faces.",
  },
  windowHours: {
    type: "number",
    minimum: 0,
    maximum: 24,
    description: "Measured or estimated hours of direct light on the sill per day.",
  },
  wateringDays: {
    type: "number",
    minimum: 0.5,
    maximum: 90,
    description: "How often the recipient will actually water, in days.",
  },
  careLevel: {
    type: "string",
    enum: ["forgetful", "weekly", "diligent"],
    description: "How attentive this household is with plants generally.",
  },
  petsPresent: { type: "boolean", description: "Whether pets or small children live there." },
  commitmentDays: {
    type: "integer",
    minimum: 7,
    maximum: 730,
    description: "How many days you are betting on. Defaults to 90.",
  },
} as const;

const TOOLS = [
  {
    name: "score_placement",
    title: "Score a plant placement",
    description:
      "Run the deterministic survival model against live Open-Meteo weather and ERA5 climate normals for a candidate placement. Writes nothing. Returns the survival probability, the single largest risk factor, the date the projection crosses the alert threshold, and a per-factor ledger with evidence.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      required: [
        "speciesSlug",
        "plantLabel",
        "friendName",
        "placeLabel",
        "latitude",
        "longitude",
        "windowLabel",
        "windowHours",
        "wateringDays",
      ],
      properties: { ...PLACEMENT_PROPERTIES },
    },
  },
  {
    name: "commit_pact",
    title: "Commit a pact",
    description:
      "Persist a placement as a pact: scores it, stores it, and appends the creation event to a SHA-384 seal chain. This is the same code path the browser uses. Accepts idempotencyKey; replaying a key returns the original pact with created=false rather than duplicating it.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      required: [
        "speciesSlug",
        "plantLabel",
        "friendName",
        "placeLabel",
        "latitude",
        "longitude",
        "windowLabel",
        "windowHours",
        "wateringDays",
      ],
      properties: {
        ...PLACEMENT_PROPERTIES,
        idempotencyKey: { type: "string", maxLength: 120, description: "Retry-safe key for this commitment." },
      },
    },
  },
  {
    name: "record_outcome",
    title: "Record what happened",
    description:
      "Close the loop: record whether the plant survived, struggled or died, and on which day. Closes the pact (fulfilled or called), appends an outcome event and returns the refreshed chain replay.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      required: ["pactId", "outcome"],
      properties: {
        pactId: { type: "string", description: "The pact id to close." },
        outcome: { type: "string", enum: ["survived", "struggled", "died", "pending"] },
        day: { type: "number", minimum: 0, maximum: 730, description: "Day of the commitment the outcome was observed." },
        note: { type: "string", maxLength: 600 },
      },
    },
  },
  {
    name: "delete_pact",
    title: "Delete a pact",
    description:
      "Tombstone a pact. The row stops appearing in every read but its audit chain is retained and stays replayable, so the deletion remains provable.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: {
      type: "object",
      required: ["pactId"],
      properties: { pactId: { type: "string" } },
    },
  },
  {
    name: "list_pacts",
    title: "List pacts",
    description: "List the calling session's pacts, newest first, with optional status filter.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50 },
        offset: { type: "integer", minimum: 0 },
        status: { type: "string", enum: ["committed", "fulfilled", "called"] },
      },
    },
  },
  {
    name: "get_pact",
    title: "Get a pact",
    description:
      "Read one pact with its species profile, its audit events, a freshly computed verdict from current weather, and the chain replay result.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      required: ["pactId"],
      properties: { pactId: { type: "string" } },
    },
  },
  {
    name: "get_forecast",
    title: "Get live weather for a location",
    description:
      "Normalized 14-day forecast plus 12 monthly ERA5 climate normals for a coordinate pair. States whether the payload is live or the sealed offline sample.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      required: ["latitude", "longitude"],
      properties: {
        latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
        placeLabel: { type: "string", maxLength: 80 },
      },
    },
  },
  {
    name: "match_species",
    title: "Resolve a plant name",
    description:
      "Resolve any plant name against the GBIF Backbone Taxonomy: accepted scientific name, family, nomenclatural status and usage key. Falls back to the bundled catalogue and says so.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", minLength: 2, maxLength: 120 } },
    },
  },
  {
    name: "verify_integrity",
    title: "Verify a seal chain",
    description:
      "Replay a pact's SHA-384 chain from its genesis value and report the first broken sequence, or a clean pass with the head seal. Works on tombstoned pacts.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      required: ["pactId"],
      properties: { pactId: { type: "string" } },
    },
  },
];

const MUTATING_TOOLS = new Set(["commit_pact", "record_outcome", "delete_pact"]);

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcError(id: string | number | null, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function textResult(summary: string, structured: unknown) {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: structured,
    isError: false,
  };
}

function toolError(summary: string) {
  return { content: [{ type: "text", text: summary }], isError: true };
}

function argString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ServiceError("invalid_params", `${key} is required and must be a non-empty string.`, 400);
  }
  return value;
}

function argOptionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : undefined;
}

function placementFromParams(params: Record<string, unknown>): PlacementInput {
  const body: Record<string, unknown> = { ...params };
  delete body.idempotencyKey;
  return parsePlacement(body);
}

function summariseVerdict(result: {
  verdict: EngineVerdict;
  species: { slug?: string; commonName: string; scientificName: string } | null;
  sky: SkyBundle;
}) {
  const failing = result.verdict.breakingPoint.projectedDate ?? result.verdict.breakingPoint.date;
  return {
species: {
    slug: result.species?.slug ?? null,
    commonName: result.species?.commonName ?? "unknown species",
    scientificName: result.species?.scientificName ?? "unknown",
  },
    probability: result.verdict.model.probability,
    label: result.verdict.model.label,
    killer: result.verdict.model.killer,
    killerNote: killerNote(result.verdict.model.killer),
    projectedFailDate: failing,
    insideForecastWindow: result.verdict.breakingPoint.date !== null,
    recommendation: result.verdict.recommendation,
    recommendationDetail: result.verdict.recommendationDetail,
    engineVersion: result.verdict.engineVersion,
    modelVersion: result.verdict.modelVersion,
    weatherOrigin: result.sky.origin,
    weatherFetchedAt: result.sky.fetchedAt,
    alerts: result.verdict.alerts,
    factors: result.verdict.model.features.map((f) => ({
      key: f.key,
      label: f.label,
      value: f.value,
      weight: f.weight,
      contribution: f.contribution,
      evidence: f.evidence,
    })),
    path: result.verdict.path,
  };
}

async function callTool(
  name: string,
  params: Record<string, unknown>,
  sessionId: string,
): Promise<{ summary: string; structured: unknown; isError?: boolean }> {
  switch (name) {
    case "score_placement": {
      const result = await scorePlacement(placementFromParams(params));
      const failing = result.verdict.breakingPoint.projectedDate ?? result.verdict.breakingPoint.date;
      return {
        summary: `${result.species.commonName} for ${String(params.friendName)} at ${String(params.placeLabel)}: ${Math.round(result.verdict.model.probability * 100)}% chance of surviving ${result.verdict.horizonDays} days. Biggest risk: ${result.verdict.model.killer}. ${failing ? `Projected to cross the alert threshold on ${failing}.` : "No failing week projected."}`,
        structured: summariseVerdict(result),
      };
    }

    case "commit_pact": {
      const placement = placementFromParams(params);
      const key =
        typeof params.idempotencyKey === "string" && params.idempotencyKey.trim()
          ? params.idempotencyKey.trim().slice(0, 120)
          : null;
      const result = await commitPact(sessionId, placement, key);
      return {
        summary: `${result.created ? "Committed" : "Returned existing"} pact ${result.pact.id} for ${result.pact.friendName}: ${Math.round(result.pact.probability * 100)}% survival probability, top risk ${result.pact.killer}, check back ${result.pact.dueDate}. Seal ${result.pact.seal.slice(0, 16)}…`,
        structured: {
          created: result.created,
          pact: result.pact,
          verdict: summariseVerdict({
            verdict: result.verdict,
            species: result.pact.species,
            sky: result.sky,
          }),
          careCardUrl: `/api/pacts/${result.pact.id}/card`,
        },
      };
    }

    case "record_outcome": {
      const pactId = argString(params, "pactId");
      const { outcome, day, note } = parseOutcome(params);
      const result = await recordOutcome(sessionId, pactId, outcome, day, note);
      return {
        summary: `Recorded "${outcome}" on pact ${pactId}; status is now ${result.pact.status}. Chain replay: ${result.replay.ok ? "clean" : `broken at seq ${result.replay.brokenAtSeq}`} across ${result.replay.events} events.`,
        structured: { pact: result.pact, replay: result.replay },
      };
    }

    case "delete_pact": {
      const pactId = argString(params, "pactId");
      const result = await deletePact(sessionId, pactId);
      return {
        summary: `Tombstoned pact ${pactId}. Audit chain retained with ${result.replay.events} events; replay ${result.replay.ok ? "clean" : "broken"}.`,
        structured: { tombstone: { id: result.pact.id, deletedAt: result.pact.deletedAt, seal: result.pact.seal }, replay: result.replay },
      };
    }

    case "list_pacts": {
      const limitRaw = argOptionalNumber(params, "limit");
      const offsetRaw = argOptionalNumber(params, "offset");
      const statusRaw = params.status;
      const result = await listPacts(sessionId, {
        limit: Math.min(50, Math.max(1, Math.floor(limitRaw ?? 20))),
        offset: Math.max(0, Math.floor(offsetRaw ?? 0)),
        status:
          typeof statusRaw === "string" && ["committed", "fulfilled", "called"].includes(statusRaw)
            ? (statusRaw as "committed" | "fulfilled" | "called")
            : undefined,
        includeDeleted: false,
      });
      return {
        summary: `${result.pacts.length} of ${result.total} pacts in this session.`,
        structured: { total: result.total, pacts: result.pacts },
      };
    }

    case "get_pact": {
      const pactId = argString(params, "pactId");
      const detail = await getPactDetail(sessionId, pactId);
      return {
        summary: `${detail.pact.plantLabel} for ${detail.pact.friendName}: ${Math.round(detail.pact.probability * 100)}% predicted survival, status ${detail.pact.status}, outcome ${detail.pact.outcome}, ${detail.replay.events} sealed events, replay ${detail.replay.ok ? "clean" : `broken at seq ${detail.replay.brokenAtSeq}`}.`,
        structured: { pact: detail.pact, events: detail.events, replay: detail.replay },
      };
    }

    case "get_forecast": {
      const latitude = argOptionalNumber(params, "latitude");
      const longitude = argOptionalNumber(params, "longitude");
      if (latitude === undefined || longitude === undefined) {
        throw new ServiceError("invalid_params", "latitude and longitude are required numbers.", 400);
      }
      const placeLabel =
        typeof params.placeLabel === "string" && params.placeLabel.trim()
          ? params.placeLabel.trim().slice(0, 80)
          : `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
      const sky = await fetchSky({ latitude, longitude, placeLabel });
      return {
        summary: `${sky.origin === "live" ? "Live" : "Sealed offline sample"} weather for ${sky.placeLabel}: ${sky.forecast.length} days from ${sky.fetchedAt}. Coldest ${Math.min(...sky.forecast.map((d) => d.minC))} °C, warmest ${Math.max(...sky.forecast.map((d) => d.maxC))} °C.`,
        structured: sky,
      };
    }

    case "match_species": {
      const name = argString(params, "name");
      const match = await matchTaxon(name);
      if (!match) {
        return { summary: `No taxonomy match for "${name}".`, structured: { match: null }, isError: true };
      }
      return {
        summary: `${match.scientificName} (${match.family ?? "family unknown"}, ${match.status ?? "status unknown"}) via ${match.sourceName} [origin ${match.origin}].`,
        structured: match,
      };
    }

    case "verify_integrity": {
      const pactId = argString(params, "pactId");
      const replay = await verifyPact(sessionId, pactId);
      return {
        summary: replay.ok
          ? `Chain verified: ${replay.events} events, head seal ${replay.headSeal?.slice(0, 24)}…`
          : `Chain BROKEN at sequence ${replay.brokenAtSeq}: ${replay.reason}`,
        structured: replay,
      };
    }

    default:
      throw new ServiceError("unknown_tool", `No tool named "${name}".`, 404);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  let payload: RpcRequest | RpcRequest[];
  try {
    payload = (await request.json()) as RpcRequest | RpcRequest[];
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error: request body is not valid JSON."), {
      status: 400,
    });
  }

  // JSON-RPC 2.0 batches are optional; a single request is the normal case.
  const batch = Array.isArray(payload);
  const messages: RpcRequest[] = batch
    ? (payload as RpcRequest[])
    : [payload as RpcRequest];
  if (messages.length === 0) {
    return Response.json(rpcError(null, -32600, "Invalid Request: empty batch."), { status: 400 });
  }

  const responses: unknown[] = [];
  let sessionId = "";

  for (const message of messages) {
    // A payload that is not a JSON object at all is a protocol error, not a
    // notification: JSON-RPC notifications are objects without an id, so a bare
    // string or number must always be answered rather than silently dropped.
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      responses.push(
        rpcError(null, -32600, "Invalid Request: each message must be a JSON-RPC 2.0 object."),
      );
      continue;
    }
    const isNotification = message.id === undefined;
    const id = message.id ?? null;

    try {
      if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
        if (!isNotification) {
          responses.push(rpcError(id, -32600, "Invalid Request: jsonrpc 2.0 and method are required."));
        }
        continue;
      }

      const params = (message.params ?? {}) as Record<string, unknown>;

      switch (message.method) {
        case "initialize":
          sessionId = sessionId || (await getSessionId());
          if (!isNotification) {
            responses.push(
              rpcResult(id, {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: { tools: { listChanged: false }, resources: { subscribe: false } },
                serverInfo: {
                  name: SERVER_NAME,
                  title: SITE.name,
                  version: MODEL_VERSION,
                },
                instructions: `Forecast how long a gifted houseplant survives in a specific home, using live Open-Meteo weather and a trained survival model, then collect the real outcome. Tools: score_placement (analysis, writes nothing), commit_pact / record_outcome / delete_pact (mutations through the same service layer the web UI uses), list_pacts / get_pact / get_forecast / match_species / verify_integrity (reads). All operations are scoped to the calling session's HTTP-only cookie. Alert threshold ${ALERT_THRESHOLD}. Engine ${ENGINE_VERSION}.`,
              }),
            );
          }
          break;

        case "notifications/initialized":
        case "initialized":
          break;

        case "ping":
          sessionId = sessionId || (await getSessionId());
          if (!isNotification) responses.push(rpcResult(id, {}));
          break;

        case "tools/list":
          sessionId = sessionId || (await getSessionId());
          if (!isNotification) responses.push(rpcResult(id, { tools: TOOLS }));
          break;

        case "resources/list":
          sessionId = sessionId || (await getSessionId());
          if (!isNotification) {
            const repo = await getRepository();
            responses.push(
              rpcResult(id, {
                resources: [
                  {
                    uri: `${siteOrigin()}/api/species`,
                    name: "Species catalogue",
                    description: `Seeded reference catalogue of ${(await repo.listSpecies()).length} houseplants with taxonomy, light, temperature and watering ranges.`,
                    mimeType: "application/json",
                  },
                  {
                    uri: `${siteOrigin()}/method`,
                    name: "Method and provenance",
                    description: "Model card, labelling procedure, sill thermal model, data provenance and safety notes.",
                    mimeType: "text/markdown",
                  },
                ],
              }),
            );
          }
          break;

        case "tools/call": {
          sessionId = sessionId || (await getSessionId());
          const name = params.name;
          if (typeof name !== "string") {
            if (!isNotification) responses.push(rpcError(id, -32602, "Invalid params: tools/call requires a tool name."));
            break;
          }
          const toolParams = (params.arguments ?? params.args ?? {}) as Record<string, unknown>;

          if (MUTATING_TOOLS.has(name)) {
            pruneRateStore();
            const rate = checkRate(`mcp-write:${sessionId}`, 20);
            if (!rate.allowed) {
              if (!isNotification) {
                responses.push(
                  rpcResult(id, toolError(`Rate limited: retry in ${rate.retryAfterSeconds}s.`)),
                );
              }
              break;
            }
          }

          try {
            const result = await callTool(name, toolParams, sessionId);
            if (!isNotification) responses.push(rpcResult(id, textResult(result.summary, result.structured)));
          } catch (error) {
            if (error instanceof ServiceError) {
              // A tool-level failure is a tool result, not a protocol error:
              // the model gets to read the message and retry differently.
              if (!isNotification) {
                responses.push(rpcResult(id, toolError(`${error.code}: ${error.message}`)));
              }
            } else {
              if (!isNotification) {
                responses.push(
                  rpcError(id, -32603, "Internal error while executing the tool."),
                );
              }
              console.error("[plant-pact] mcp tool failure:", error);
            }
          }
          break;
        }

        default:
          if (!isNotification) {
            responses.push(rpcError(id, -32601, `Method not found: ${message.method}`));
          }
      }
    } catch (error) {
      if (!isNotification) {
        responses.push(rpcError(id, -32603, "Internal error."));
      }
      console.error("[plant-pact] mcp failure:", error);
    }
  }

  if (responses.length === 0) {
    return new Response(null, { status: 202 });
  }
  return Response.json(batch ? responses : responses[0], {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(): Promise<Response> {
  return jsonError(
    "method_not_allowed",
    "This MCP endpoint speaks JSON-RPC 2.0 over HTTP POST. See public/mcp.json for the manifest.",
    405,
    {
      endpoint: "/api/mcp",
      protocol: "jsonrpc-2.0",
      methods: ["initialize", "tools/list", "tools/call", "ping", "resources/list"],
      repository: SITE.repositoryUrl,
      genesisSeal: GENESIS_SEAL,
      sealAlgorithm: SEAL_ALGORITHM,
      labelingVersion: LABELING_VERSION,
      modelCard: MODEL_CARD.version,
    },
  );
}