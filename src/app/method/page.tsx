import type { Metadata } from "next";
import Link from "next/link";
import { MODEL_CARD } from "@/lib/model/infer";
import { ENGINE_VERSION, ALERT_THRESHOLD } from "@/lib/engine/verdict";
import { HAZARD_THRESHOLD, HAZARD_WEIGHTS, LABELING_VERSION } from "@/lib/engine/labeling";
import { SILL_MODEL } from "@/lib/model/features";
import { GENESIS_SEAL, SEAL_ALGORITHM } from "@/lib/integrity/chain";
import { FEATURE_LABELS } from "@/lib/model/features";
import { WEIGHTS } from "@/lib/model/weights";
import { SAFETY_DISCLAIMER } from "@/lib/export";
import { SITE } from "@/lib/config";
import { SectionHeading } from "@/components/ui";
import { MAX_PACTS_PER_SESSION } from "@/lib/service";

export const metadata: Metadata = {
  title: "Method",
  description:
    "How Plant Pact actually decides: the trained model and its held-out metrics, the labelling procedure it was fitted against, the sill thermal model, data provenance, and the integrity chain.",
  alternates: { canonical: "/method" },
};

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-3 border-b border-edge-soft py-1.5">
      <dt className="label-mono pt-0.5">{term}</dt>
      <dd className="num text-right text-xs text-loam-soft">{children}</dd>
    </div>
  );
}

export default function MethodPage() {
  const weights = Object.entries(WEIGHTS.features) as [string, number][];
  const sealFormula = [
    "seal_n = " + SEAL_ALGORITHM + "(",
    "  UTF-8( prevSeal ) + canonicalJson( event_n )",
    ")",
    "",
    "genesis = " + GENESIS_SEAL,
  ].join("\n");

  return (
    <div className="pb-10">
      <SectionHeading
        label="Method"
        title="How the odds are produced"
        lede="No hidden service, no proprietary model, no API key. This page states the algorithm, the corpus, the metrics and the limits so the number on a pact can be argued with."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------- model card ---------------- */}
        <section className="tag min-w-0 p-5">
          <p className="label-mono">Model card</p>
          <h2 className="mt-1 text-[1.35rem]">{MODEL_CARD.family}</h2>
          <p className="mt-2 text-sm leading-relaxed text-loam-soft">{MODEL_CARD.notes}</p>
          <dl className="mt-4">
            <Row term="version">{MODEL_CARD.version}</Row>
            <Row term="engine">{ENGINE_VERSION}</Row>
            <Row term="trained at">{MODEL_CARD.trainedAt.slice(0, 19).replace("T", " ")} utc</Row>
            <Row term="seed">{MODEL_CARD.seed}</Row>
            <Row term="features">{MODEL_CARD.features.length} observable quantities</Row>
            <Row term="corpus">
              {MODEL_CARD.corpus.rows.toLocaleString("en-GB")} placements across{" "}
              {MODEL_CARD.corpus.cities} cities
            </Row>
            <Row term="train / holdout">
              {MODEL_CARD.corpus.trainRows.toLocaleString("en-GB")} /{" "}
              {MODEL_CARD.corpus.holdoutRows.toLocaleString("en-GB")}
            </Row>
            <Row term="label balance">
              {MODEL_CARD.corpus.labels.survived.toLocaleString("en-GB")} survived ·{" "}
              {MODEL_CARD.corpus.labels.failed.toLocaleString("en-GB")} failed
            </Row>
            <Row term="held-out AUC">{MODEL_CARD.metrics.holdoutAuc.toFixed(4)}</Row>
            <Row term="held-out accuracy">{MODEL_CARD.metrics.holdoutAccuracy.toFixed(4)}</Row>
            <Row term="held-out log loss">{MODEL_CARD.metrics.logLoss.toFixed(4)}</Row>
            <Row term="held-out Brier">{MODEL_CARD.metrics.brier.toFixed(4)}</Row>
            <Row term="base survival rate">
              {(MODEL_CARD.metrics.baseSurvivalRate * 100).toFixed(1)}%
            </Row>
            <Row term="alert threshold">{Math.round(ALERT_THRESHOLD * 100)}% survival</Row>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-loam-faint">
            Metrics are computed with the rounded weights that ship in the repository, so they
            describe the code that actually runs. Regenerate everything with{" "}
            <span className="num">npm run train</span>; refresh the weather corpus with{" "}
            <span className="num">npm run corpus</span>.
          </p>
        </section>

        {/* ---------------- pipeline ---------------- */}
        <section className="tag min-w-0 p-5">
          <p className="label-mono">The pipeline</p>
          <ol className="mt-3 space-y-3 text-sm leading-relaxed text-loam-soft">
            <li>
              <strong className="text-loam">1 · Real weather.</strong> A 14-day daily forecast
              from Open-Meteo plus 12 monthly normals derived from the ERA5 reanalysis archive
              for the recipient&apos;s coordinates. Cached 15 minutes and 30 days respectively.
            </li>
            <li>
              <strong className="text-loam">2 · Sill thermal model.</strong> Outdoor extremes are
              damped toward {SILL_MODEL.neutralC} °C: cold by ×{SILL_MODEL.coldDamping}, heat by ×
              {SILL_MODEL.heatDamping}. A flat is not the street outside, and judging a plant by
              the raw outdoor forecast makes every temperate city look arctic.
            </li>
            <li>
              <strong className="text-loam">3 · Ten features.</strong> Each is derived from
              something measurable — window light, watering cadence, stated care level — or from
              the weather above. Nine are risk-shaped where larger means worse;{" "}
              {FEATURE_LABELS.lightHeadroom} is the only one where more is better.
            </li>
            <li>
              <strong className="text-loam">4 · Logistic inference.</strong>{" "}
              <span className="num">p = σ(bias + Σ weightᵢ · featureᵢ)</span>, computed in-process.
              Contributions sum exactly to the logit, which is what the ledger displays.
            </li>
            <li>
              <strong className="text-loam">5 · Projection path.</strong> The same weight vector is
              re-evaluated on the forecast prefix available on each day, so the curve drifts as
              cold nights and dry spells accumulate. The last point equals the headline number.
            </li>
            <li>
              <strong className="text-loam">6 · The failing week.</strong> The first day survival
              drops below {Math.round(ALERT_THRESHOLD * 100)}%, or a slope projection beyond the
              window when it never crosses inside it.
            </li>
          </ol>
        </section>
      </div>

      {/* ---------------- features ---------------- */}
      <section className="mt-6">
        <p className="label-mono">Features and shipped weights</p>
        <div className="tag mt-2.5 min-w-0 overflow-x-auto p-4">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="border-b border-edge">
                <th className="label-mono pb-2 pr-3 font-normal">feature</th>
                <th className="label-mono pb-2 pr-3 font-normal">direction</th>
                <th className="label-mono pb-2 pr-3 font-normal">weight</th>
                <th className="label-mono pb-2 font-normal">what it reads</th>
              </tr>
            </thead>
            <tbody>
              {weights.map(([key, weight]) => (
                <tr key={key} className="border-b border-edge-soft align-top">
                  <td className="num py-2 pr-3">{key}</td>
                  <td className="py-2 pr-3 text-xs text-loam-soft">
                    {key === "lightHeadroom" ? "higher is better" : "higher is worse"}
                  </td>
                  <td className={`num py-2 pr-3 ${weight >= 0 ? "text-leaf" : "text-clay"}`}>
                    {weight >= 0 ? "+" : "−"}
                    {Math.abs(weight).toFixed(4)}
                  </td>
                  <td className="py-2 text-xs leading-relaxed text-loam-soft">
                    {FEATURE_READING[key]}
                  </td>
                </tr>
              ))}
              <tr className="border-b border-edge-soft">
                <td className="num py-2 pr-3">bias</td>
                <td className="py-2 pr-3 text-xs text-loam-soft">—</td>
                <td className={`num py-2 pr-3 ${WEIGHTS.bias >= 0 ? "text-leaf" : "text-clay"}`}>
                  {WEIGHTS.bias >= 0 ? "+" : "−"}
                  {Math.abs(WEIGHTS.bias).toFixed(4)}
                </td>
                <td className="py-2 text-xs leading-relaxed text-loam-soft">
                  The base odds before any risk is applied.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-loam-faint">
          <strong className="text-loam-soft">Read this honestly:</strong> water dominates. The
          two watering features carry the largest weights in the model, which matches the two
          ways gifted plants actually die. Heat is real but almost never the deciding factor
          once the sill model is applied, and its near-zero weight is an empirical finding rather
          than an oversight.
        </p>
      </section>

      {/* ---------------- labelling ---------------- */}
      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="tag min-w-0 p-5">
          <p className="label-mono">The labelling procedure</p>
          <p className="mt-2 text-sm leading-relaxed text-loam-soft">
            Training labels come from a separate, hand-written risk procedure: accumulate hazard
            from every way a placement can fail, and call it a survival when the total stays under{" "}
            <span className="num">{HAZARD_THRESHOLD}</span>. The application never scores with this
            function — it scores with the trained model. Keeping them separate is the point: the
            model can be audited against the procedure it approximates instead of silently
            standing in for it.
          </p>
          <dl className="mt-3">
            {Object.entries(HAZARD_WEIGHTS).map(([key, weight]) => (
              <Row key={key} term={key}>
                ×{weight.toFixed(2)}
              </Row>
            ))}
            <Row term="threshold">survives if hazard &lt; {HAZARD_THRESHOLD}</Row>
            <Row term="version">{LABELING_VERSION}</Row>
          </dl>
        </div>

        <div className="tag min-w-0 p-5">
          <p className="label-mono">Integrity</p>
          <p className="mt-2 text-sm leading-relaxed text-loam-soft">
            Every create, update, outcome and deletion appends an event to a per-pact chain. Seals
            are computed over recursively key-sorted JSON so the same logical event always hashes
            the same way.
          </p>
<pre className="num mt-3 overflow-x-auto rounded-[3px] border border-edge bg-shell px-3 py-2 text-[11px] leading-relaxed">
            {sealFormula}
          </pre>
          <p className="mt-3 text-sm leading-relaxed text-loam-soft">
            Deleting a pact tombstones the row and keeps every event, so the record of a
            prediction cannot be quietly rewritten. The{" "}
            <Link href="/verify" className="underline decoration-edge underline-offset-2 hover:text-clay">
              verify route
            </Link>{" "}
            replays a chain and names the first sequence that fails.
          </p>
        </div>
      </section>

      {/* ---------------- data + limits ---------------- */}
      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="tag min-w-0 p-5">
          <p className="label-mono">Data provenance</p>
          <dl className="mt-2">
            <Row term="forecast">
              <a href="https://open-meteo.com/" className="underline decoration-edge underline-offset-2">
                Open-Meteo Forecast API
              </a>
            </Row>
            <Row term="climate normals">
              <a href="https://open-meteo.com/en/docs/historical-weather-api" className="underline decoration-edge underline-offset-2">
                Open-Meteo archive, ERA5 reanalysis
              </a>
            </Row>
            <Row term="taxonomy">
              <a href="https://www.gbif.org/" className="underline decoration-edge underline-offset-2">
                GBIF Backbone Taxonomy
              </a>
            </Row>
            <Row term="care ranges">Curated in src/lib/species.ts</Row>
            <Row term="offline fallback">Sealed London sample, 2026-10-02</Row>
            <Row term="third-party keys">none</Row>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-loam-faint">
            Every response states its own <span className="num">origin</span>:{" "}
            <span className="num">live</span>, or the sealed sample with its real capture date and
            a note saying it does not describe the requested place. Fallback data is never
            written to the database and never replaces user data.
          </p>
        </div>

        <div className="tag min-w-0 p-5">
          <p className="label-mono">Ownership, limits and safety</p>
          <ul className="mt-2 space-y-2 text-sm leading-relaxed text-loam-soft">
            <li>
              <strong className="text-loam">No accounts.</strong> Ownership is an unguessable v4
              UUID in an HTTP-only, SameSite=Lax cookie. Every query is scoped by it, so one
              visitor can never read or mutate another visitor&apos;s pacts.
            </li>
            <li>
              <strong className="text-loam">Abuse control is best-effort.</strong> Anonymous writes
              are limited to 20 per minute per session and{" "}
              {MAX_PACTS_PER_SESSION} pacts per session. The limiter is an in-memory bucket, so it
              resets per serverless instance; a hosted limiter is the honest upgrade.
            </li>
            <li>
              <strong className="text-loam">Not medical, legal or veterinary advice.</strong>{" "}
              {SAFETY_DISCLAIMER}
            </li>
            <li>
              <strong className="text-loam">The sills are modelled, not measured.</strong> An indoor
              window&apos;s light hours are a number a person has to estimate. The model can only be
              as honest as that estimate, which is why the evidence string on every factor repeats
              it back.
            </li>
            <li>
              <strong className="text-loam">Deleting keeps history.</strong>{" "}
              <span className="num">DELETE</span> tombstones; the chain survives.
            </li>
          </ul>
        </div>
      </section>

      <p className="mt-8 max-w-3xl text-xs leading-relaxed text-loam-faint">
        Source and history:{" "}
        <a
          href={SITE.repositoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-edge underline-offset-2 hover:text-clay"
        >
          {SITE.repositoryUrl}
        </a>
        . Health and store verification at <span className="num">/api/health</span>, and the
        agent manifest at <span className="num">/mcp.json</span>.
      </p>
    </div>
  );
}

const FEATURE_READING: Record<string, string> = {
  lightDeficit: "How far the sill falls short of the species' minimum light.",
  lightOvershoot: "Hours past the species' light ceiling, which scorches rather than feeds.",
  lightHeadroom: "Comfortable headroom inside the light band. The only positive feature.",
  coldShare: "Share of forecast nights whose modelled sill temperature is below tolerance.",
  heatShare: "Share of days whose modelled sill temperature is above tolerance.",
  waterDry: "Accumulated deficit when the routine is slower than the species wants.",
  waterWet: "The rot risk when the routine is faster than the species wants.",
  climateStrain: "How much of the year sits outside tolerance, from ERA5 monthly normals.",
  careShortfall: "Gap between the stated routine and the species' difficulty.",
  drySpell: "Whether the routine leaves the forecast's dry-heat days uncovered.",
};