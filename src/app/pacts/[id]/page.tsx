import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionId, isUuid } from "@/lib/session";
import { getPactDetail } from "@/lib/service";
import { ServiceError } from "@/lib/api-helpers";
import { VerdictDial } from "@/components/verdict-dial";
import { FactorLedger } from "@/components/factor-ledger";
import { SkyBand } from "@/components/sky-band";
import { PactActions } from "@/components/pact-actions";
import { OriginBadge } from "@/components/ui";
import { GENESIS_SEAL, SEAL_ALGORITHM } from "@/lib/integrity/chain";
import { MODEL_CARD } from "@/lib/model/infer";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Pact" };
  try {
    const detail = await getPactDetail(await getSessionId(), id);
    return {
      title: `${detail.pact.plantLabel} for ${detail.pact.friendName}`,
      description: `A ${Math.round(detail.pact.probability * 100)}% predicted survival for ${detail.pact.plantLabel} at ${detail.pact.placeLabel}. Top risk: ${detail.pact.killerNote}`,
      alternates: { canonical: `/pacts/${id}` },
      robots: { index: false, follow: false },
    };
  } catch {
    return { title: "Pact", robots: { index: false, follow: false } };
  }
}

function ChainTable({
  events,
  replay,
}: {
  events: { seq: number; eventType: string; seal: string; prevSeal: string; createdAt: string }[];
  replay: { ok: boolean; events: number; headSeal: string | null; brokenAtSeq: number | null };
}) {
  return (
    <section className="tag p-4" data-testid="chain-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label-mono">Audit chain</p>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
            replay.ok
              ? "border-leaf/40 bg-leaf-wash text-leaf-deep"
              : "border-risk/40 bg-risk-wash text-risk"
          }`}
          data-testid="chain-status"
        >
          {replay.ok ? `verified · ${replay.events} events` : `broken at ${replay.brokenAtSeq}`}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-xs">
          <thead>
            <tr className="border-b border-edge">
              <th className="label-mono pb-1.5 pr-3 font-normal">seq</th>
              <th className="label-mono pb-1.5 pr-3 font-normal">event</th>
              <th className="label-mono pb-1.5 pr-3 font-normal">seal</th>
              <th className="label-mono pb-1.5 font-normal">when</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-edge-soft">
              <td className="num py-1.5 pr-3 text-loam-faint">0</td>
              <td className="py-1.5 pr-3 text-loam-faint">genesis</td>
              <td className="num py-1.5 pr-3 text-loam-faint">{GENESIS_SEAL.slice(0, 16)}…</td>
              <td className="py-1.5 text-loam-faint">—</td>
            </tr>
            {events.map((event) => (
              <tr key={event.seq} className="border-b border-edge-soft">
                <td className="num py-1.5 pr-3">{event.seq}</td>
                <td className="py-1.5 pr-3">{event.eventType.replace(/_/g, " ")}</td>
                <td className="num py-1.5 pr-3 text-loam-soft">{event.seal.slice(0, 16)}…</td>
                <td className="num py-1.5 text-loam-faint">{event.createdAt.slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-loam-faint">
        Each seal is{" "}
        <span className="num">SHA-384(UTF-8(prevSeal) ‖ canonicalJson(event))</span> over
        recursively key-sorted JSON, chained from the genesis value above. Deleting the pact
        tombstones the row and keeps every event, so the record of the prediction cannot be
        quietly rewritten.{" "}
        {replay.headSeal ? (
          <>
            Head seal{" "}
            <span className="num text-loam-soft">{replay.headSeal.slice(0, 24)}…</span>
          </>
        ) : null}
      </p>
    </section>
  );
}

export default async function PactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ committed?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  let detail: Awaited<ReturnType<typeof getPactDetail>>;
  try {
    detail = await getPactDetail(await getSessionId(), id);
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) notFound();
    throw error;
  }

  const { pact, verdict, sky, replay, events } = detail;
  const { committed } = await searchParams;

  return (
    <div className="pb-8">
      <nav aria-label="Breadcrumb" className="mb-4 pt-2">
        <Link
          href="/pacts"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-loam-faint no-underline underline decoration-edge underline-offset-4 hover:text-clay"
        >
          ← the ledge
        </Link>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-mono">
            Pact for {pact.friendName} · {pact.placeLabel}
          </p>
          <h1 className="mt-1.5 text-[2.1rem] leading-tight sm:text-[2.6rem]">{pact.plantLabel}</h1>
          <p className="mt-1 text-sm italic text-loam-faint">{pact.species?.scientificName}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {sky ? <OriginBadge origin={sky.origin} /> : null}
          <p className="num text-xs text-loam-faint">
            committed {pact.createdAt.slice(0, 10)} · due {pact.dueDate}
          </p>
          <p className="num text-xs text-loam-faint">
            seal {pact.seal.slice(0, 16)}…
          </p>
        </div>
      </header>

      {sky ? (
        <div className="mt-6">
          <SkyBand
            latitude={pact.latitude}
            longitude={pact.longitude}
            placeLabel={pact.placeLabel}
            tone="inline"
          />
        </div>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-6">
          {verdict ? <VerdictDial verdict={verdict} /> : null}

          {verdict?.alerts.length ? (
            <ul className="space-y-2">
              {verdict.alerts.map((alert) => (
                <li
                  key={alert}
                  className="rounded-[3px] border border-warn/40 bg-warn-wash px-3 py-2 text-xs leading-relaxed text-loam-soft"
                >
                  {alert}
                </li>
              ))}
            </ul>
          ) : null}

          {verdict ? (
            <div>
              <p className="label-mono mb-2.5">Factor ledger</p>
              <FactorLedger verdict={verdict} />
            </div>
          ) : null}

          <ChainTable events={events} replay={replay} />
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <PactActions pact={pact} replay={replay} committed={committed === "1"} />

          <section className="tag p-4">
            <p className="label-mono">Provenance</p>
            <dl className="mt-2 space-y-1.5 text-xs">
              {[
                ["Engine", verdict?.engineVersion ?? "—"],
                ["Model", verdict?.modelVersion ?? MODEL_CARD.version],
                ["Corpus", `${MODEL_CARD.corpus.rows.toLocaleString("en-GB")} placements, ${MODEL_CARD.corpus.cities} cities`],
                ["Held-out AUC", MODEL_CARD.metrics.holdoutAuc.toFixed(3)],
                ["Seal", SEAL_ALGORITHM],
                ["Weather fetched", sky?.fetchedAt ?? "—"],
                ["Weather source", sky?.sourceName ?? "—"],
              ].map(([term, definition]) => (
                <div key={term} className="flex justify-between gap-3 border-b border-edge-soft pb-1">
                  <dt className="text-loam-faint">{term}</dt>
                  <dd className="num text-right text-loam-soft">{definition}</dd>
                </div>
              ))}
            </dl>
            {sky?.origin !== "live" && sky?.note ? (
              <p className="mt-2 rounded-[3px] bg-warn-wash px-2.5 py-2 font-mono text-[11px] leading-relaxed text-warn">
                {sky.note}
              </p>
            ) : null}
            <a
              href="/method"
              className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.12em] text-clay underline decoration-clay/40 underline-offset-4 hover:decoration-clay"
            >
              Full method
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}