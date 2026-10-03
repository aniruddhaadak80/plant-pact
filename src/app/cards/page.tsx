import type { Metadata } from "next";
import { listPacts, getPactDetail } from "@/lib/service";
import { getSessionId } from "@/lib/session";
import { SectionHeading, EmptyState, CtaLink } from "@/components/ui";
import { OriginBadge } from "@/components/ui";
import { renderCareCard } from "@/lib/export";
import type { SkyBundle } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Care cards",
  description:
    "Every care card in this session: the odds, the one thing most likely to kill it, the week it dies and the exact date to check back.",
  alternates: { canonical: "/cards" },
};

/**
 * The export route.
 *
 * A card is rendered server-side from the stored pact plus a freshly computed
 * verdict, so what you download is the current state of the prediction rather
 * than a snapshot taken when it was committed. Each card also offers the plain
 * Markdown source, which is the form you paste into a message.
 */
export default async function CardsPage() {
  const sessionId = await getSessionId();
  const { pacts } = await listPacts(sessionId, {
    limit: 50,
    offset: 0,
    includeDeleted: false,
  });

  const cards = await Promise.all(
    pacts.map(async (pact) => {
      const detail = await getPactDetail(sessionId, pact.id);
      return { pact: detail.pact, verdict: detail.verdict, sky: detail.sky };
    }),
  );

  return (
    <div className="pb-8">
      <SectionHeading
        label="Takeaway"
        title="Care cards"
        lede="One per pact, rendered from the stored record plus today's weather. Markdown downloads are the version you send to the person receiving the plant."
      />

      {cards.length === 0 ? (
        <EmptyState
          title="No cards yet"
          body="A card exists for every committed pact. Commit one and it will appear here, already filled in."
          action={<CtaLink href="/advisor">Place a plant</CtaLink>}
        />
      ) : (
        <ul className="min-w-0 space-y-4">
          {cards.map(({ pact, verdict, sky }) => {
            const failing = verdict?.breakingPoint.projectedDate ?? verdict?.breakingPoint.date;
            return (
              <li key={pact.id} className="tag p-5" data-testid="care-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="label-mono">
                      {pact.friendName} · {pact.placeLabel}
                    </p>
                    <h3 className="mt-1 text-[1.35rem] leading-tight">{pact.plantLabel}</h3>
                    <p className="text-xs italic text-loam-faint">{pact.species?.scientificName}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="num text-[1.8rem] leading-none text-leaf">
                      {Math.round((verdict?.model.probability ?? pact.probability) * 100)}%
                    </span>
                    {sky ? <OriginBadge origin={(sky as SkyBundle).origin} /> : null}
                  </div>
                </div>

                <dl className="mt-4 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  {[
                    ["Window", `${pact.windowLabel} · ${pact.windowHours} h/day · ${pact.windowAspect}`],
                    ["Watering", `every ${pact.wateringDays} days`],
                    ["Top risk", pact.killerNote],
                    ["Failing week", failing ?? "not projected inside the window"],
                    ["Check back", pact.dueDate],
                    ["Forecast state", sky ? (sky.origin === "live" ? "live" : "sealed sample") : "—"],
                  ].map(([term, definition]) => (
                    <div key={term} className="flex justify-between gap-3 border-b border-edge-soft pb-1">
                      <dt className="shrink-0 text-loam-faint">{term}</dt>
                      <dd className="num text-right text-loam-soft">{definition}</dd>
                    </div>
                  ))}
                </dl>

                {verdict && sky ? (
                  <details className="mt-4">
                    <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-clay marker:content-none">
                      Preview the markdown
                    </summary>
                    <pre className="num mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-[3px] border border-edge bg-shell px-3 py-2 text-[11px] leading-relaxed text-loam-soft">
                      {renderCareCard(pact, verdict, sky)}
                    </pre>
                  </details>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={`/api/pacts/${pact.id}/card`}
                    className="inline-flex items-center rounded-[4px] border border-clay bg-clay px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-plaster no-underline hover:bg-clay-deep"
                  >
                    Download .md
                  </a>
                  <a
                    href={`/api/pacts/${pact.id}/card?format=html`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded-[4px] border border-edge bg-plaster px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-loam no-underline hover:border-clay hover:text-clay"
                  >
                    Open printable
                  </a>
                  <a
                    href={`/pacts/${pact.id}`}
                    className="inline-flex items-center rounded-[4px] border border-edge bg-plaster px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-loam no-underline hover:border-clay hover:text-clay"
                  >
                    Open pact
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}