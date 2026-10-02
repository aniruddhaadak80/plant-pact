import type { Metadata } from "next";
import { AgentConsole } from "@/components/agent-console";
import { SectionHeading } from "@/components/ui";
import { MODEL_CARD } from "@/lib/model/infer";
import { ENGINE_VERSION, ALERT_THRESHOLD } from "@/lib/engine/verdict";
import { GENESIS_SEAL, SEAL_ALGORITHM } from "@/lib/integrity/chain";
import { LABELING_VERSION, HAZARD_THRESHOLD } from "@/lib/engine/labeling";
import { SITE, siteOrigin } from "@/lib/config";

export const metadata: Metadata = {
  title: "Agent console",
  description:
    "Drive Plant Pact over JSON-RPC 2.0: score a placement, commit a pact, record the outcome, verify the seal chain and delete - all through the same service layer the web UI uses.",
  alternates: { canonical: "/agent" },
};

const TOOL_NAMES = [
  ["score_placement", "analysis", "Reads live weather, writes nothing."],
  ["commit_pact", "mutation", "Persists a pact and seals the creation event. Idempotency-Key supported."],
  ["record_outcome", "mutation", "Closes the loop and appends an outcome event."],
  ["delete_pact", "mutation", "Tombstones the row, retains the chain."],
  ["list_pacts", "read", "Lists this session's pacts."],
  ["get_pact", "read", "Pact, events, fresh verdict, replay result."],
  ["get_forecast", "read", "Normalized forecast plus ERA5 normals, labelled live or sealed."],
  ["match_species", "read", "GBIF Backbone Taxonomy resolution."],
  ["verify_integrity", "read", "Replays the SHA-384 chain and reports the first break."],
];

export default function AgentPage() {
  return (
    <div className="pb-8">
      <SectionHeading
        label="Agent interface"
        title="Nine typed tools over JSON-RPC 2.0"
        lede="Every call below is a real request to the live endpoint, in this browser session, against the same database and the same engine as the pages you have already used."
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="tag overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-edge">
                <th className="label-mono px-4 py-2 font-normal">tool</th>
                <th className="label-mono px-2 py-2 font-normal">kind</th>
                <th className="label-mono px-4 py-2 font-normal">what it does</th>
              </tr>
            </thead>
            <tbody>
              {TOOL_NAMES.map(([name, kind, description]) => (
                <tr key={name} className="border-b border-edge-soft">
                  <td className="num px-4 py-2 align-top">{name}</td>
                  <td className="px-2 py-2 align-top">
                    <span
                      className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${
                        kind === "mutation"
                          ? "border-clay/40 bg-clay-wash text-clay-deep"
                          : kind === "read"
                            ? "border-edge bg-shell text-loam-soft"
                            : "border-leaf/40 bg-leaf-wash text-leaf-deep"
                      }`}
                    >
                      {kind}
                    </span>
                  </td>
                  <td className="px-4 py-2 align-top text-xs leading-relaxed text-loam-soft">
                    {description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="tag h-fit p-4">
          <p className="label-mono">Endpoint</p>
          <p className="num mt-1.5 break-all text-xs text-loam-soft">{siteOrigin()}/api/mcp</p>
          <p className="label-mono mt-4">Manifest</p>
          <p className="num mt-1.5 break-all text-xs text-loam-soft">{siteOrigin()}/mcp.json</p>
          <dl className="mt-4 space-y-1.5 text-xs">
            {[
              ["Protocol", "JSON-RPC 2.0 over HTTP POST"],
              ["Methods", "initialize · tools/list · tools/call · ping · resources/list"],
              ["Ownership", "caller's HTTP-only session cookie"],
              ["Engine", ENGINE_VERSION],
              ["Model", MODEL_CARD.version],
              ["Alert threshold", `${Math.round(ALERT_THRESHOLD * 100)}%`],
              ["Labeling", LABELING_VERSION],
              ["Hazard threshold", String(HAZARD_THRESHOLD)],
              ["Seals", `${SEAL_ALGORITHM} from ${GENESIS_SEAL.slice(0, 12)}…`],
              ["Rate limits", "20 writes/min/session (best-effort per instance)"],
            ].map(([term, definition]) => (
              <div key={term} className="flex justify-between gap-3 border-b border-edge-soft pb-1">
                <dt className="shrink-0 text-loam-faint">{term}</dt>
                <dd className="num text-right text-loam-soft">{definition}</dd>
              </div>
            ))}
          </dl>
          <a
            href="/method"
            className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.12em] text-clay underline decoration-clay/40 underline-offset-4 hover:decoration-clay"
          >
            Model card and provenance
          </a>
          <p className="mt-3 text-xs leading-relaxed text-loam-faint">
            Open source under MIT at{" "}
            <a
              href={SITE.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-edge underline-offset-2 hover:text-clay"
            >
              {SITE.repositorySlug}
            </a>
            .
          </p>
        </aside>
      </div>

      <AgentConsole />
    </div>
  );
}