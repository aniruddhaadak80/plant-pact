import type { EngineVerdict } from "@/lib/types";
import { ALERT_THRESHOLD } from "@/lib/engine/verdict";

/**
 * The odds, and the week it dies.
 *
 * A diverging bar for the probability and a 14-day projection ribbon. The ribbon
 * is drawn from real model output: the same weight vector re-evaluated on the
 * forecast prefix available on each day. It is a projection under the model's own
 * assumptions, not an upstream forecast, and the caption says so.
 */

function pct(value: number): string {
  return `${Math.round(value * 100)}`;
}

export function VerdictDial({ verdict }: { verdict: EngineVerdict }) {
  const path = verdict.path;
  const probability = verdict.model.probability;
  const failing = verdict.breakingPoint.projectedDate ?? verdict.breakingPoint.date;
  const crossing = verdict.breakingPoint.dayIndex;
  const inside = verdict.breakingPoint.date !== null;

  const tone =
    probability >= 0.7 ? "leaf" : probability >= 0.35 ? "warn" : "risk";
  const toneText = tone === "leaf" ? "text-leaf" : tone === "warn" ? "text-warn" : "text-risk";

  return (
    <div className="tag p-5" data-testid="verdict-dial" data-probability={probability}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="label-mono">Chance of surviving {verdict.horizonDays} days</p>
          <p className={`num mt-1 text-[3.4rem] leading-none ${toneText}`}>{pct(probability)}%</p>
          <p className="mt-1 text-sm text-loam-soft">
            {verdict.model.label === "likely"
              ? "On this placement, it probably makes it."
              : verdict.model.label === "uncertain"
                ? "Coin-flip territory. One change would decide it."
                : "On this placement, it probably does not make it."}
          </p>
        </div>
        <div className="text-right">
          <p className="label-mono">Largest risk</p>
          <p className="mt-1 text-[1.05rem] leading-tight text-clay">{verdict.killerLabel}</p>
          <p className="num mt-0.5 text-xs text-loam-faint">
            −{Math.abs(verdict.model.killerContribution).toFixed(3)} logit
          </p>
        </div>
      </div>

      {/* Diverging probability bar against the alert threshold. */}
      <div className="mt-4">
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-edge">
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${
              tone === "leaf" ? "bg-leaf" : tone === "warn" ? "bg-warn" : "bg-risk"
            }`}
            style={{ width: `${Math.round(probability * 100)}%` }}
          />
          <div
            className="absolute inset-y-0 w-px bg-loam"
            style={{ left: `${Math.round(ALERT_THRESHOLD * 100)}%` }}
            title={`Alert threshold ${Math.round(ALERT_THRESHOLD * 100)}%`}
          />
        </div>
        <p className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-loam-faint">
          <span>0%</span>
          <span>alert at {Math.round(ALERT_THRESHOLD * 100)}%</span>
          <span>100%</span>
        </p>
      </div>

      {/* Projection ribbon. */}
      <div className="mt-5">
        <p className="label-mono">Survival projection across the forecast window</p>
        <svg
          viewBox="0 0 300 72"
          className="mt-2 h-[72px] w-full"
          role="img"
          aria-label={`Survival projection from ${path[0]?.date ?? ""} to ${path[path.length - 1]?.date ?? ""}, ending at ${pct(probability)} percent.`}
          preserveAspectRatio="none"
        >
          {path.length > 1 ? (
            <>
              <line
                x1="0"
                x2="300"
                y1={72 - ALERT_THRESHOLD * 72}
                y2={72 - ALERT_THRESHOLD * 72}
                stroke="currentColor"
                className="text-loam-faint"
                strokeWidth="0.6"
                strokeDasharray="3 3"
                opacity="0.6"
              />
              <path
                d={path
                  .map((point, index) => {
                    const x = (index / (path.length - 1)) * 300;
                    const y = 72 - point.survival * 72;
                    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
                  })
                  .join(" ")}
                fill="none"
                strokeWidth="1.8"
                className={tone === "leaf" ? "stroke-leaf" : tone === "warn" ? "stroke-warn" : "stroke-risk"}
              />
              {crossing !== null && path[crossing] ? (
                <line
                  x1={(crossing / (path.length - 1)) * 300}
                  x2={(crossing / (path.length - 1)) * 300}
                  y1="0"
                  y2="72"
                  strokeWidth="1.2"
                  className="stroke-risk"
                />
              ) : null}
              <circle
                cx={300}
                cy={72 - probability * 72}
                r="2.4"
                className={tone === "leaf" ? "fill-leaf" : tone === "warn" ? "fill-warn" : "fill-risk"}
              />
            </>
          ) : (
            <text x="4" y="40" className="fill-loam-faint" fontSize="9">
              no forecast days available
            </text>
          )}
        </svg>

        <p
          className="mt-2 text-sm leading-relaxed"
          data-testid="breaking-point"
          data-date={failing ?? ""}
        >
          {failing ? (
            <>
              Survival crosses {Math.round(ALERT_THRESHOLD * 100)}% on{" "}
              <strong className="num text-clay">{failing}</strong>.{" "}
              {inside
                ? "That falls inside the current forecast window."
                : "Projected beyond the window from the model's own slope, so treat the exact date as indicative."}
            </>
          ) : (
            <>
              No week in the forecast window drops survival below{" "}
              {Math.round(ALERT_THRESHOLD * 100)}%, and the trend is flat or rising.
            </>
          )}
        </p>
      </div>
    </div>
  );
}