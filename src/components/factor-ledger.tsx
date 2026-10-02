"use client";

import { useState } from "react";
import type { EngineVerdict, FeatureKey, ModelFeature } from "@/lib/types";
import { FEATURE_GROUPS } from "@/lib/model/features";

/**
 * The factor ledger.
 *
 * Ten features grouped into the four things that actually kill a gifted plant:
 * light, water, air and care. Each row shows the contribution the feature made to
 * the logit and the sentence that justifies it. Selecting a row highlights it in
 * the projection above; hovering a factor is not required to read any of it.
 */

const GROUP_BLURB: Record<string, string> = {
  light: "How many hours of direct light the sill actually gets.",
  water: "The gap between what the plant needs and what a person does.",
  air: "Outdoor extremes, mapped through the sill thermal model.",
  care: "Whether the routine matches the species' difficulty.",
};

function contributionBar(feature: ModelFeature) {
  const magnitude = Math.min(1, Math.abs(feature.contribution) / 1.6);
  const positive = feature.contribution >= 0;
  return (
    <div className="flex h-1.5 w-14 items-center" aria-hidden="true">
      <div className="relative h-1.5 flex-1 bg-edge-soft">
        <div className="absolute top-0 h-full w-px bg-loam-faint" style={{ left: "50%" }} />
        <div
          className={`absolute top-0 h-full ${positive ? "bg-leaf left-1/2" : "bg-clay right-1/2"}`}
          style={{ width: `${magnitude * 50}%` }}
        />
      </div>
    </div>
  );
}

export function FactorLedger({
  verdict,
  compact = false,
}: {
  verdict: EngineVerdict;
  compact?: boolean;
}) {
  const [selected, setSelected] = useState<FeatureKey | null>(null);

  const ranked = verdict.model.features
    .filter((feature) => feature.value > 0 || feature.key === "lightHeadroom")
    .sort((a, b) => a.contribution - b.contribution);

  const shown = compact ? ranked.slice(0, 6) : ranked;

  return (
    <div className="space-y-3" data-testid="factor-ledger">
      {FEATURE_GROUPS.map((group) => {
        const rows = shown.filter((feature) => group.features.includes(feature.key));
        if (rows.length === 0) return null;
        return (
          <section key={group.id} className="tag p-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[1.05rem]">{group.label}</h3>
              <p className="text-[0.7rem] leading-snug text-loam-faint">{GROUP_BLURB[group.id]}</p>
            </div>
            <ul className="mt-2.5 divide-y divide-edge-soft">
              {rows.map((feature) => {
                const isSelected = selected === feature.key;
                const isKiller = feature.key === verdict.model.killer;
                return (
                  <li key={feature.key}>
                    <button
                      type="button"
                      onClick={() => setSelected(isSelected ? null : feature.key)}
                      aria-expanded={isSelected}
                      className={`w-full rounded-[3px] px-1 py-2 text-left transition-colors hover:bg-shell ${
                        isSelected ? "bg-shell" : ""
                      }`}
                      data-testid={`factor-${feature.key}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5">
                          {isKiller ? (
                            <span
                              className="rounded-full bg-clay px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-plaster"
                              title="Largest single risk"
                            >
                              top risk
                            </span>
                          ) : null}
                          <span className="text-sm">{feature.label}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          {contributionBar(feature)}
                          <span
                            className={`num text-xs ${
                              feature.contribution >= 0 ? "text-leaf" : "text-clay"
                            }`}
                          >
                            {feature.contribution >= 0 ? "+" : "−"}
                            {Math.abs(feature.contribution).toFixed(3)}
                          </span>
                        </span>
                      </div>
                      {isSelected ? (
                        <p className="mt-1.5 max-w-prose border-l-2 border-edge pl-2.5 text-xs leading-relaxed text-loam-soft">
                          {feature.evidence}
                          <span className="num mt-1 block text-loam-faint">
                            value {feature.value.toFixed(3)} × weight {feature.weight.toFixed(4)} =
                            {" "}
                            {feature.contribution.toFixed(4)} logit
                          </span>
                        </p>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {!compact && ranked.length > shown.length ? (
        <p className="text-xs text-loam-faint">{shown.length} factors shown.</p>
      ) : null}

      {compact ? (
        <p className="px-1 text-xs leading-relaxed text-loam-faint">
          {ranked.length} factors are computed. Open a pact to see the full ledger and the
          evidence behind each number.
        </p>
      ) : null}

      <p className="sr-only">
        {ranked.map((feature) => `${feature.label}: ${feature.evidence}`).join(" ")}
      </p>
    </div>
  );
}