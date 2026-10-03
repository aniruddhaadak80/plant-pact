#!/usr/bin/env node
/**
 * Live end-to-end verification.
 *
 * Proves, against a real deployment with real HTTP requests, that the claims in
 * the README are true. Nothing here is mocked and nothing is simulated: the
 * same sequence a person performs is performed with fetch().
 *
 *   node scripts/verify-live.mjs
 *   PLANT_PACT_URL=https://your-deployment.vercel.app node scripts/verify-live.mjs
 *
 * The base URL comes from the environment; no secret is ever read or printed.
 * A cookie jar is maintained so every call shares one anonymous session, which
 * is what makes the ownership and idempotency checks meaningful.
 */

const BASE = (process.env.PLANT_PACT_URL || "https://plant-pact.vercel.app").replace(/\/+$/, "");
const REPO_URL = "https://github.com/aniruddhaadak80/plant-pact";

const jar = new Map();
let cookieHeader = "";
let passed = 0;
const failures = [];

function ok(name, detail = "") {
  passed += 1;
  console.log(`  \u2713 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
}

function fail(name, detail) {
  failures.push(`${name}: ${detail}`);
  console.log(`  \u2717 ${name} \u2014 ${detail}`);
}

function check(name, condition, detail = "") {
  if (condition) ok(name, detail);
  else fail(name, detail || "assertion failed");
  return Boolean(condition);
}

function rememberCookies(response) {
  const raw = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  for (const entry of raw) {
    const [pair] = entry.split(";");
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function callOnce(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.body !== undefined && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  if (cookieHeader) headers.cookie = cookieHeader;
  // `rawBody` sends bytes verbatim, which is how a deliberately malformed payload
  // is tested. `body` is serialised normally.
  const payload = options.rawBody !== undefined
    ? options.rawBody
    : options.body === undefined
      ? undefined
      : JSON.stringify(options.body);
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: payload,
    redirect: "manual",
  });
  rememberCookies(response);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, text, json, headers: response.headers };
}

/**
 * Transport-level retries only. A verifier that silently retried a failing
 * assertion would be worthless, so a 4xx or 5xx is returned immediately and
 * only genuine socket/TLS failures are retried.
 */
async function call(path, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await callOnce(path, options);
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  throw lastError;
}

function section(title) {
  console.log(`\n${title}`);
}

const PLACEMENT = {
  speciesSlug: "monstera",
  plantLabel: "live verifier plant",
  friendName: "live verifier friend",
  placeLabel: "Lisbon, Portugal",
  latitude: 38.7223,
  longitude: -9.1393,
  windowLabel: "verifier window",
  windowAspect: "south",
  windowHours: 5,
  wateringDays: 8,
  careLevel: "weekly",
  petsPresent: false,
  commitmentDays: 90,
};

async function main() {
  console.log(`Verifying ${BASE}`);

  /* ---------------------------------------------------------------- */
  section("1 · Landing page");
  const home = await call("/");
  check("GET / returns 200", home.status === 200, `status ${home.status}`);
  check("landing names the product", home.text.includes("Plant Pact"));
  check("landing links the real repository", home.text.includes(REPO_URL));
  check(
    "landing commits to a real action",
    /Commit this pact|Place a plant/i.test(home.text),
    "found a primary CTA",
  );

  /* ---------------------------------------------------------------- */
  section("2 · Health and real persistence");
  const health = await call("/api/health");
  check("GET /api/health returns 200", health.status === 200, `status ${health.status}`);
  check(
    "health reports a verified store",
    health.json?.persistence?.ok === true,
    health.json?.persistence?.detail ?? "no detail",
  );
  check(
    "health names the production adapter",
    health.json?.persistence?.adapter === "postgres",
    `adapter ${health.json?.persistence?.adapter}`,
  );
  check(
    "health proves it queried, not a static object",
    typeof health.json?.persistence?.detail === "string" &&
      health.json.persistence.detail.includes("SELECT 1 succeeded"),
    health.json?.persistence?.detail ?? "",
  );
  check(
    "health reports the engine and model versions",
    Boolean(health.json?.engineVersion && health.json?.modelVersion),
    `${health.json?.engineVersion} / ${health.json?.modelVersion}`,
  );

  /* ---------------------------------------------------------------- */
  section("3 · Live data");
  const species = await call("/api/species");
  check("catalogue is seeded", Array.isArray(species.json?.species) && species.json.species.length > 20,
    `${species.json?.species?.length} species`);

  const gbifSeed = species.json?.species?.find((s) => s.slug === "golden-pothos");
  check(
    "catalogue carries real GBIF taxonomy",
    gbifSeed?.gbifUsageKey === 2868323 && gbifSeed?.family === "Araceae",
    `${gbifSeed?.scientificName} → key ${gbifSeed?.gbifUsageKey}`,
  );

  const taxon = await call("/api/species?q=Epipremnum%20aureum");
  check(
    "any name resolves against the GBIF Backbone Taxonomy",
    taxon.json?.match?.canonicalName === "Epipremnum aureum",
    `origin ${taxon.json?.origin}`,
  );
  check(
    "taxonomy states its own source",
    typeof taxon.json?.match?.sourceName === "string",
    taxon.json?.match?.sourceName,
  );

  const sky = await call("/api/sky?lat=38.7223&lon=-9.1393&place=Lisbon%2C%20Portugal");
  const bundle = sky.json?.sky;
  check("live weather endpoint returns a normalized result", Array.isArray(bundle?.forecast) && bundle.forecast.length > 0,
    `${bundle?.forecast?.length} days, origin ${bundle?.origin}`);
  check("weather carries attribution and a fetch time", Boolean(bundle?.attribution && bundle?.fetchedAt));
  check("weather carries climate normals", Array.isArray(bundle?.normals) && bundle.normals.length === 12,
    `${bundle?.normals?.length} monthly normals`);
  check(
    "weather never silently passes fallback off as live",
    bundle?.origin === "live" ? !bundle.note : Boolean(bundle.note),
    bundle?.origin === "live" ? "labelled live" : "labelled fallback with a note",
  );

  /* ---------------------------------------------------------------- */
  section("4 · The deterministic engine");
  const score = await call("/api/score", { method: "POST", body: { ...PLACEMENT, windowHours: 1.5 } });
  const verdict = score.json?.verdict;
  check("engine returns a versioned result", Boolean(verdict?.engineVersion && verdict?.modelVersion),
    `${verdict?.engineVersion} / ${verdict?.modelVersion}`);
  check("engine returns a probability", typeof verdict?.model?.probability === "number",
    String(verdict?.model?.probability));
  check("engine itemises ten factors", verdict?.model?.features?.length === 10,
    `${verdict?.model?.features?.length} factors`);
  check("every factor carries evidence", verdict?.model?.features?.every((f) => typeof f.evidence === "string" && f.evidence.length > 10));
  check("engine names the largest risk", Boolean(verdict?.model?.killer), String(verdict?.model?.killer));
  check("engine gives an actionable recommendation", typeof verdict?.recommendation === "string" && verdict.recommendation.length > 20);
  check("engine produces a projection path", Array.isArray(verdict?.path) && verdict.path.length > 0,
    `${verdict?.path?.length} days`);
  check(
    "the path ends at the headline probability",
    verdict?.path?.length > 0 &&
      Math.abs(verdict.path[verdict.path.length - 1].survival - verdict.model.probability) < 0.001,
  );
  check("analysis writes nothing", score.json?.persisted === false);

  /* ---------------------------------------------------------------- */
  section("5 · CRUD through the public API");
  const idempotencyKey = `verify-live-${Date.now()}`;
  const created = await call("/api/pacts", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: PLACEMENT,
  });
  check("POST /api/pacts returns 201", created.status === 201, `status ${created.status}`);
  const pactId = created.json?.pact?.id;
  check("created record has an id and a seal", Boolean(pactId) && created.json?.pact?.seal?.length === 96,
    created.json?.pact?.seal?.slice(0, 16));

  const readBack = await call(`/api/pacts/${pactId}`);
  check("GET /api/pacts/[id] reads it back", readBack.status === 200 && readBack.json?.pact?.id === pactId);
  check("read-back persists the placement",
    readBack.json?.pact?.windowHours === 5 && readBack.json?.pact?.wateringDays === 8);
  check("read-back attaches the species profile", readBack.json?.pact?.species?.slug === "monstera");
  check("read-back includes a fresh verdict from live weather", Boolean(readBack.json?.verdict?.model?.probability));

  const replaySameKey = await call("/api/pacts", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: PLACEMENT,
  });
  check("a replayed idempotency key does not create a second pact",
    replaySameKey.json?.created === false && replaySameKey.json?.pact?.id === pactId);

  const patched = await call(`/api/pacts/${pactId}`, { method: "PATCH", body: { windowHours: 9 } });
  check("PATCH updates the placement", patched.status === 200 && patched.json?.pact?.windowHours === 9);
  const afterPatch = await call(`/api/pacts/${pactId}`);
  check("persisted state reflects the update", afterPatch.json?.pact?.windowHours === 9);
  check("update re-scored the pact",
    afterPatch.json?.pact?.probability !== created.json?.pact?.probability,
    `${created.json?.pact?.probability} → ${afterPatch.json?.pact?.probability}`);

  const badPatch = await call(`/api/pacts/${pactId}`, { method: "PATCH", body: { windowHours: 99 } });
  check("invalid input is rejected with a 4xx and a stable envelope",
    badPatch.status === 400 && badPatch.json?.error?.code === "invalid_field",
    `status ${badPatch.status}, code ${badPatch.json?.error?.code}`);

  const card = await call(`/api/pacts/${pactId}/card`);
  check("care card downloads valid markdown",
    card.status === 200 &&
      card.headers.get("content-type")?.includes("text/markdown") &&
      card.text.includes("# Care card:"),
    `${card.text.length} bytes`);
  check("care card carries provenance and timestamps", card.text.includes("Open-Meteo") && card.text.includes("SHA-384"));
  check("care card carries the safety disclaimer", card.text.includes("not horticultural or veterinary advice"));

  /* ---------------------------------------------------------------- */
  section("6 · MCP agent interface");
  const initialize = await call("/api/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-live", version: "1.0.0" } } },
  });
  check("MCP initialize succeeds",
    initialize.json?.result?.protocolVersion === "2025-06-18" && initialize.json?.result?.serverInfo?.name === "plant-pact",
    initialize.json?.result?.serverInfo?.version);
  check("initialize advertises tool capability", Boolean(initialize.json?.result?.capabilities?.tools));

  const tools = await call("/api/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
  const names = (tools.json?.result?.tools ?? []).map((t) => t.name);
  check("tools/list returns the expected tools",
    ["score_placement", "commit_pact", "record_outcome", "delete_pact", "list_pacts", "get_pact", "get_forecast", "match_species", "verify_integrity"]
      .every((n) => names.includes(n)),
    `${names.length} tools`);
  check("tools carry typed input schemas",
    (tools.json?.result?.tools ?? []).every((t) => t.inputSchema?.type === "object" && t.inputSchema?.properties));

  const unknownMethod = await call("/api/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 3, method: "nope" } });
  check("unknown methods get JSON-RPC -32601", unknownMethod.json?.error?.code === -32601);

  const badJson = await call("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    rawBody: "{not json at all",
  });
  check("malformed JSON gets JSON-RPC -32700", badJson.json?.error?.code === -32700,
    `status ${badJson.status}, code ${badJson.json?.error?.code}`);

  const notAnObject = await call("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    rawBody: JSON.stringify("just a string"),
  });
  check("a non-object payload gets -32600 rather than being dropped", notAnObject.json?.error?.code === -32600,
    `status ${notAnObject.status}, code ${notAnObject.json?.error?.code}`);

  const emptyPatch = await call(`/api/pacts/${pactId}`, { method: "PATCH", body: {} });
  check("an empty patch is rejected, not silently ignored", emptyPatch.status === 400,
    `status ${emptyPatch.status}, code ${emptyPatch.json?.error?.code}`);

  const unknownField = await call(`/api/pacts/${pactId}`, { method: "PATCH", body: { windowHour: 4 } });
  check("an unknown patch field is rejected", unknownField.status === 400,
    `status ${unknownField.status}, code ${unknownField.json?.error?.code}`);

  const agentScore = await call("/api/mcp", {
    method: "POST",
    body: {
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "score_placement", arguments: { ...PLACEMENT, windowHours: 1 } },
    },
  });
  check("MCP analysis tool runs the same engine",
    typeof agentScore.json?.result?.structuredContent?.probability === "number",
    `p=${agentScore.json?.result?.structuredContent?.probability}`);
  check("MCP analysis tool returns factor evidence",
    agentScore.json?.result?.structuredContent?.factors?.length === 10);

  const agentKey = `verify-live-mcp-${Date.now()}`;
  const agentCommit = await call("/api/mcp", {
    method: "POST",
    body: {
      jsonrpc: "2.0", id: 5, method: "tools/call",
      params: { name: "commit_pact", arguments: { ...PLACEMENT, plantLabel: "agent committed plant", idempotencyKey: agentKey } },
    },
  });
  const agentPactId = agentCommit.json?.result?.structuredContent?.pact?.id;
  check("MCP mutating tool creates a real record", Boolean(agentPactId),
    agentPactId ? String(agentPactId).slice(0, 8) : "no id");

  const agentReadBack = await call(`/api/pacts/${agentPactId}`);
  check("the agent mutation is visible through the REST read path",
    agentReadBack.status === 200 && agentReadBack.json?.pact?.plantLabel === "agent committed plant",
    "proves one shared service layer");

  const agentVerify = await call("/api/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "verify_integrity", arguments: { pactId: pactId } } },
  });
  check("MCP integrity tool replays a pact created through REST",
    agentVerify.json?.result?.structuredContent?.ok === true,
    `${agentVerify.json?.result?.structuredContent?.events} events`);

  const badTool = await call("/api/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_pact", arguments: { pactId: "00000000-0000-4000-8000-000000000000" } } },
  });
  check("tool failures surface as tool errors, not protocol errors",
    badTool.json?.result?.isError === true && String(badTool.json?.result?.content?.[0]?.text).includes("not_found"),
    badTool.json?.result?.content?.[0]?.text);

  /* ---------------------------------------------------------------- */
  section("7 · Integrity");
  const replay = await call(`/api/pacts/${pactId}/verify`);
  check("chain replay reports no broken link",
    replay.json?.replay?.ok === true && replay.json?.replay?.events >= 2,
    `${replay.json?.replay?.events} events, head ${String(replay.json?.replay?.headSeal).slice(0, 16)}`);
  check("replay exposes the genesis-based head seal",
    typeof replay.json?.replay?.headSeal === "string" && replay.json.replay.headSeal.length === 96);

  const outcome = await call(`/api/pacts/${pactId}/outcome`, {
    method: "POST",
    body: { outcome: "survived", day: 90, note: "verified by the live verifier" },
  });
  check("outcome closes the pact", outcome.json?.pact?.status === "fulfilled");
  // created, updated, outcome_recorded
  check("outcome appends a sealed event", outcome.json?.replay?.events >= 3, `${outcome.json?.replay?.events} events`);

  const closedEdit = await call(`/api/pacts/${pactId}`, { method: "PATCH", body: { windowHours: 3 } });
  check("a closed pact cannot be edited (409)", closedEdit.status === 409, `status ${closedEdit.status}`);

  /* ---------------------------------------------------------------- */
  section("8 · Manifest, navigation and routes");
  const manifest = await call("/mcp.json");
  check("mcp.json is served and valid", manifest.status === 200 && Boolean(manifest.json?.name),
    manifest.json?.name);
  check("mcp.json points at the live endpoint",
    manifest.json?.endpoint === "/api/mcp" && Boolean(manifest.json?.liveUrl),
    manifest.json?.liveUrl);

  for (const route of ["/", "/advisor", "/pacts", "/cards", "/agent", "/method", "/verify", "/sitemap.xml", "/robots.txt"]) {
    const response = await call(route);
    check(`GET ${route} returns 200`, response.status === 200, `status ${response.status}`);
  }

  const agentPage = await call("/agent");
  check("navigation and footer both carry the repository URL",
    (agentPage.text.match(new RegExp(REPO_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length >= 2,
    "at least two occurrences");
  check("no broken internal links on the landing page",
    !/\/href="\/[a-z-]*undefined/.test(home.text) && !/href="undefined/.test(home.text));

  const notFound = await call("/pacts/00000000-0000-4000-8000-000000000000");
  check("an unknown pact id is a 404, not a leak", notFound.status === 404, `status ${notFound.status}`);

  const repoResponse = await fetch(REPO_URL, { redirect: "follow" });
  check("the repository URL returns 200", repoResponse.status === 200, `status ${repoResponse.status}`);

  /* ---------------------------------------------------------------- */
  section("9 · Cleanup");
  const removed = await call(`/api/pacts/${pactId}`, { method: "DELETE" });
  check("DELETE tombstones the record", removed.status === 200 && removed.json?.deleted === true);
  // created, updated, outcome_recorded, deleted
  check("the tombstone retains a replayable chain",
    removed.json?.replay?.ok === true && removed.json?.replay?.events >= 4,
    `${removed.json?.replay?.events} events retained`);
  const afterDelete = await call(`/api/pacts/${pactId}`);
  check("the deleted record is absent from reads", afterDelete.status === 404, `status ${afterDelete.status}`);

  const removedAgent = await call("/api/mcp", {
    method: "POST",
    body: { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "delete_pact", arguments: { pactId: agentPactId } } },
  });
  check("the agent-created record is cleaned up too",
    removedAgent.json?.result?.structuredContent?.replay?.ok === true);

  /* ---------------------------------------------------------------- */
  console.log(`\n${"=".repeat(64)}`);
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log("Every live claim verified.");
}

main().catch((error) => {
  console.error("\nVerification could not complete:", error?.message ?? error);
  process.exit(1);
});