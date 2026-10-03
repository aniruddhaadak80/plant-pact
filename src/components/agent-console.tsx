"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, inputClass } from "./ui";

/**
 * In-page MCP console.
 *
 * Sends real JSON-RPC 2.0 to /api/mcp over HTTP POST - the same endpoint an
 * agent client would use, with the same session cookie, the same service layer
 * and the same rate limits. The request and the response are both shown, because
 * a console that only shows success is a screenshot with extra steps.
 */

interface Preset {
  id: string;
  label: string;
  group: "Handshake" | "Analysis" | "Mutation" | "Read";
  description: string;
  request: unknown;
  /** Filled in at click time when a pact id is known. */
  needsPactId?: boolean;
}

const INITIALIZE: Preset = {
  id: "initialize",
  label: "initialize",
  group: "Handshake",
  description: "Negotiate the protocol version and list server capabilities.",
  request: {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "plant-pact-console", version: "1.0.0" },
    },
  },
};

const TOOLS_LIST: Preset = {
  id: "tools-list",
  label: "tools/list",
  group: "Handshake",
  description: "Discover every typed tool the server exposes.",
  request: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
};

const SCORE: Preset = {
  id: "score",
  label: "score_placement",
  group: "Analysis",
  description:
    "Run the survival model for a fiddle-leaf fig in a Reykjavík hallway. Writes nothing.",
  request: {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "score_placement",
      arguments: {
        speciesSlug: "fiddle-leaf-fig",
        plantLabel: "the hallway one",
        friendName: "Maya",
        placeLabel: "Reykjavík, Iceland",
        latitude: 64.1466,
        longitude: -21.9426,
        windowLabel: "hallway, ground floor",
        windowAspect: "north",
        windowHours: 2,
        wateringDays: 14,
        careLevel: "weekly",
        petsPresent: false,
        commitmentDays: 90,
      },
    },
  },
};

const COMMIT: Preset = {
  id: "commit",
  label: "commit_pact",
  group: "Mutation",
  description:
    "Persist a pact through the same service layer the browser uses. Sends an Idempotency-Key so a repeat returns the original pact.",
  request: {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "commit_pact",
      arguments: {
        idempotencyKey: "console-demo-1",
        speciesSlug: "golden-pothos",
        plantLabel: "the desk one",
        friendName: "Ada",
        placeLabel: "Berlin, Germany",
        latitude: 52.52,
        longitude: 13.405,
        windowLabel: "study, first floor",
        windowAspect: "east",
        windowHours: 4.5,
        wateringDays: 9,
        careLevel: "weekly",
        petsPresent: true,
        commitmentDays: 90,
      },
    },
  },
};

const LIST: Preset = {
  id: "list",
  label: "list_pacts",
  group: "Read",
  description: "List the pacts owned by this session, newest first.",
  request: {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "list_pacts", arguments: { limit: 10 } },
  },
};

function getPreset(id: string): Preset {
  return [INITIALIZE, TOOLS_LIST, SCORE, COMMIT, LIST].find((p) => p.id === id) ?? INITIALIZE;
}

/**
 * `origin` is resolved on the server and passed in, because this component runs
 * in the browser where the deployment's environment variables do not exist.
 * Computing it client-side would render localhost during hydration and trip
 * React's text-mismatch check.
 */
export function AgentConsole({ origin }: { origin: string }) {
  const [selected, setSelected] = useState("initialize");
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pactId, setPactId] = useState<string | null>(null);
  const [resultLinks, setResultLinks] = useState<{ label: string; href: string }[]>([]);

  const presets = [INITIALIZE, TOOLS_LIST, SCORE, COMMIT, LIST];

  async function send(presetId: string) {
    const preset = getPreset(presetId);
    setSelected(presetId);
    setBusy(true);
    setError(null);
    setResultLinks([]);

    const body = JSON.stringify(preset.request);
    setRequest(body);

    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const text = await response.text();
      setResponse(text);

      if (!response.ok) {
        setError(`HTTP ${response.status}: the endpoint rejected the call.`);
        return;
      }
      try {
        const parsed = JSON.parse(text) as {
          error?: { code: number; message: string };
          result?: {
            content?: { text?: string }[];
            structuredContent?: { created?: boolean; pact?: { id: string } };
          };
        };
        if (parsed.error) {
          setError(`JSON-RPC ${parsed.error.code}: ${parsed.error.message}`);
          return;
        }
        const structured = parsed.result?.structuredContent;
        if (structured?.pact?.id) {
          const id = structured.pact.id;
          setPactId(id);
          setResultLinks([
            { label: `Open the committed pact /pacts/${id.slice(0, 8)}…`, href: `/pacts/${id}` },
            { label: "Download its care card", href: `/api/pacts/${id}/card` },
          ]);
        }
      } catch {
        setError("The response was not valid JSON-RPC. See the raw body above.");
      }
    } catch {
      setError("Could not reach /api/mcp. The call was not delivered.");
    } finally {
      setBusy(false);
    }
  }

  async function pactScoped(tool: "record_outcome" | "verify_integrity" | "delete_pact") {
    if (!pactId) {
      setError("Run commit_pact first so there is a pact in this session to act on.");
      return;
    }
    const arguments_: Record<string, unknown> = { pactId };
    if (tool === "record_outcome") {
      arguments_.outcome = "survived";
      arguments_.day = 90;
      arguments_.note = "Recorded from the agent console.";
    }
    setBusy(true);
    setError(null);
    setResultLinks([]);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: tool, arguments: arguments_ },
    });
    setRequest(body);
    try {
      const response = await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const text = await response.text();
      setResponse(text);
      if (!response.ok) setError(`HTTP ${response.status}: the call was rejected.`);
    } catch {
      setError("Could not reach /api/mcp. The call was not delivered.");
    } finally {
      setBusy(false);
    }
  }

  const selectedPreset = getPreset(selected);

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => void send(preset.id)}
            disabled={busy}
            className={`tag focus-ring p-3 text-left transition-colors hover:border-clay disabled:opacity-60 ${
              selected === preset.id ? "border-clay bg-clay-wash" : ""
            }`}
            data-testid={`preset-${preset.id}`}
          >
            <span className="label-mono">{preset.group}</span>
            <span className="num mt-1 block text-sm">{preset.label}</span>
          </button>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-loam-faint">{selectedPreset.description}</p>

      {pactId ? (
        <div className="tag p-3">
          <p className="label-mono">Acting on a pact in this session</p>
          <p className="num mt-1 break-all text-xs text-loam-soft">{pactId}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void pactScoped("verify_integrity")} disabled={busy}>
              verify_integrity
            </Button>
            <Button variant="secondary" onClick={() => void pactScoped("record_outcome")} disabled={busy}>
              record_outcome
            </Button>
            <Button variant="danger" onClick={() => void pactScoped("delete_pact")} disabled={busy}>
              delete_pact
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          className="rounded-[3px] border border-risk/40 bg-risk-wash px-4 py-3"
          role="alert"
          data-testid="agent-error"
        >
          <p className="text-sm text-risk">{error}</p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="tag overflow-hidden">
          <div className="flex items-center justify-between border-b border-edge px-4 py-2">
            <p className="label-mono">Request</p>
            <span className="label-mono">POST /api/mcp</span>
          </div>
          <pre
            className="num max-h-80 overflow-auto px-4 py-3 text-[11px] leading-relaxed text-loam-soft"
            data-testid="agent-request"
          >
            {request || "Pick a call above. The request body will appear here."}
          </pre>
        </section>

        <section className="tag overflow-hidden">
          <div className="flex items-center justify-between border-b border-edge px-4 py-2">
            <p className="label-mono">Response</p>
            <span className="label-mono" data-testid="agent-status">
              {busy ? "in flight" : response ? "received" : "idle"}
            </span>
          </div>
          <pre
            className="num max-h-80 overflow-auto px-4 py-3 text-[11px] leading-relaxed text-loam-soft"
            data-testid="agent-response"
          >
            {response || "The JSON-RPC response will appear here."}
          </pre>
        </section>
      </div>

      {resultLinks.length > 0 ? (
        <ul className="space-y-1.5" data-testid="agent-result-links">
          {resultLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-clay underline decoration-clay/40 underline-offset-4 hover:decoration-clay"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="tag p-4">
        <p className="label-mono">Wire it into a client</p>
        <p className="mt-1.5 text-sm leading-relaxed text-loam-soft">
          The manifest at <span className="num">/mcp.json</span> points at this deployment&apos;s
          real endpoint. Tools are scoped to the caller&apos;s HTTP-only session cookie, so an
          agent and a browser tab share ownership rather than inventing a parallel world.
        </p>
        <pre className="num mt-3 overflow-x-auto rounded-[3px] border border-edge bg-shell px-3 py-2 text-[11px] leading-relaxed">
{`curl -s ${origin}/api/mcp \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
        </pre>
        <input className={`${inputClass} mt-3`} readOnly value="/mcp.json" aria-label="Manifest path" />
      </section>
    </div>
  );
}