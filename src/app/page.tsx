import { SITE } from "@/lib/config";
import { MODEL_CARD } from "@/lib/model/infer";
import { GitHubLink } from "@/components/github-link";
import { CtaLink } from "@/components/ui";
import { ALERT_THRESHOLD } from "@/lib/engine/verdict";

function BigNumber({ value, label }: { value: string; label: string }) {
  return (
    <div className="tag px-4 py-3">
      <p className="num text-[1.7rem] leading-none text-loam">{value}</p>
      <p className="label-mono mt-1.5">{label}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="pb-8">
      {/* Hero. Asymmetric and left-weighted: the product is an instrument you
          read, not a centred marketing banner. */}
      <section className="grid gap-8 pt-4 lg:grid-cols-[1.25fr_0.75fr] lg:gap-12">
        <div>
          <p className="label-mono">For the plant you are about to give away</p>
          <h1 className="mt-3 max-w-2xl text-[2.5rem] leading-[1.06] tracking-[-0.025em] sm:text-[3.4rem]">
            Most gifted plants do not die of neglect.
            <span className="block text-clay">They die of a bad window.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[1.05rem] leading-relaxed text-loam-soft">
            {SITE.name} takes the plant, the person, the city and the window, reads the
            real fourteen-day forecast and the climate normals for that city, and tells you
            the odds — including the week it is most likely to die. Then it asks you to
            come back on day ninety and record what actually happened.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <CtaLink href="/advisor">Place a plant</CtaLink>
            <CtaLink href="/pacts" variant="secondary">
              See the ledge
            </CtaLink>
            <GitHubLink variant="cta" />
          </div>
          <p className="mt-4 max-w-md text-xs leading-relaxed text-loam-faint">
            No account, no API key, no third-party service to sign up for. Your pacts are
            stored against an anonymous HTTP-only session cookie.
          </p>
        </div>

        <aside className="lg:pt-2">
          <div className="tag p-5">
            <p className="label-mono">The model, in the open</p>
            <p className="mt-2 text-sm leading-relaxed text-loam-soft">
              A logistic regression with published weights, fitted on real weather for{" "}
              {MODEL_CARD.corpus.cities} cities and labelled by a hand-written risk
              procedure. It runs inside the serverless function. There is no model API to
              call and no key to lose.
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              {[
                ["Model", MODEL_CARD.version],
                ["Features", `${MODEL_CARD.features.length} observable quantities`],
                ["Corpus", `${MODEL_CARD.corpus.rows.toLocaleString("en-GB")} placements`],
                ["Held-out AUC", MODEL_CARD.metrics.holdoutAuc.toFixed(3)],
                ["Alert threshold", `${Math.round(ALERT_THRESHOLD * 100)}% survival`],
              ].map(([term, definition]) => (
                <div key={term} className="flex justify-between gap-3 border-b border-edge-soft pb-1.5">
                  <dt className="label-mono pt-0.5">{term}</dt>
                  <dd className="num text-right text-xs text-loam-soft">{definition}</dd>
                </div>
              ))}
            </dl>
            <a
              href="/method"
              className="mt-4 inline-block font-mono text-[11px] uppercase tracking-[0.12em] text-clay underline decoration-clay/40 underline-offset-4 hover:decoration-clay"
            >
              Read the method and the provenance
            </a>
          </div>
        </aside>
      </section>

      {/* The three jobs, stated as jobs rather than feature lists. */}
      <section className="mt-14">
        <p className="label-mono">What it is for</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Before you hand it over",
              body: "Model the exact spot — north window, 3 hours of light, watered every ten days — against the real forecast for your friend's city, and find out whether you are about to gift a coffin.",
            },
            {
              title: "When you hand it over",
              body: "Send a care card that names the one thing most likely to kill it, what to change, and the exact date the projection turns. It is a Markdown file or a printable page, not a screenshot.",
            },
            {
              title: "Ninety days later",
              body: "Come back and record what happened. Every outcome is sealed into a per-pact SHA-384 chain, so the record of your prediction cannot quietly be edited afterwards.",
            },
          ].map((job) => (
            <div key={job.title} className="tag focus-ring p-5">
              <h3 className="text-[1.15rem]">{job.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-loam-soft">{job.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The 10-second moment, described concretely. */}
      <section className="mt-14">
        <p className="label-mono">Ten seconds</p>
        <div className="terrace-lines tag mt-3 overflow-hidden p-6 sm:p-8">
          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Pick the plant", "Twenty-nine houseplants with light, temperature and watering ranges, taxonomy resolved against the GBIF Backbone."],
              ["Name the spot", "Choose the recipient's city and drag the window's light hours. The projection recomputes on every move, from live data."],
              ["Commit the pact", "Persist it with its odds, its killer and its due date. The row and its seal are written in one transaction."],
              ["Take the card away", "Download a Markdown care card or open the printable version, and come back on day ninety."],
            ].map(([title, body], index) => (
              <li key={title} className="relative">
                <span className="num absolute -top-1 right-0 text-[2.4rem] leading-none text-edge">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="relative text-[1.05rem]">{title}</p>
                <p className="relative mt-1.5 text-sm leading-relaxed text-loam-soft">{body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            <CtaLink href="/advisor">Start with a plant</CtaLink>
            <CtaLink href="/agent" variant="secondary">
              Or drive it from an agent
            </CtaLink>
          </div>
        </div>
      </section>

      {/* Numbers, all of which are reproducible. */}
      <section className="mt-14">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <BigNumber value={String(MODEL_CARD.corpus.cities)} label="cities in the corpus" />
          <BigNumber
            value={MODEL_CARD.corpus.rows.toLocaleString("en-GB")}
            label="real-weather placements"
          />
          <BigNumber value={MODEL_CARD.metrics.holdoutAuc.toFixed(3)} label="held-out AUC" />
          <BigNumber
            value={`${Math.round(MODEL_CARD.metrics.baseSurvivalRate * 100)}%`}
            label="base survival rate"
          />
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-loam-faint">
          The base survival rate is the share of randomly sampled placements — random
          species, random window, random routine, real weather — that the labelling
          procedure calls a survivor. It is the honest floor for a gift, and a good
          placement should read well above it. All four figures come from the committed
          model card and can be regenerated with <span className="num">npm run train</span>.
        </p>
      </section>

      {/* Honest limits, before anyone discovers them. */}
      <section className="mt-14">
        <div className="rounded-[3px] border border-warn/40 bg-warn-wash p-5">
          <p className="label-mono text-warn">What this is not</p>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-loam-soft">
            <li>
              Not a plant identifier. It resolves names against a taxonomy; it does not
              diagnose disease from a photograph.
            </li>
            <li>
              Not a survival guarantee. The probability is a model output on a real corpus,
              and the corpus itself is only {Math.round(MODEL_CARD.metrics.baseSurvivalRate * 100)}
              % survivors.
            </li>
            <li>
              Not veterinary or horticultural advice. Care ranges are approximate published
              guidelines, and toxicity flags are conservative and general.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}