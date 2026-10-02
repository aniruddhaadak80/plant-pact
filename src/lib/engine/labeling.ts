import type { FeatureInput } from "../model/features";
import { rawTerms, sillTemperature } from "../model/features";

/**
 * The published risk procedure.
 *
 * This is the decision procedure a careful grower would write down: accumulate
 * a hazard score from every way a placement can go wrong, and call it a
 * survival when the accumulated hazard stays under a fixed threshold. It is
 * hand-auditable, fully documented, and it is what produces the labels the
 * shipped model is fitted against (see scripts/train-model.ts).
 *
 * The application never scores a pact with this function. It scores with the
 * trained model in src/lib/model, which approximates this procedure from the
 * same observable features. Keeping the two separate is deliberate: the model
 * can be audited against the procedure it was fitted to instead of quietly
 * standing in for it.
 */

export const LABELING_VERSION = "pact-risk-procedure@2026.10.0";

/** Accumulated hazard at or above this value means the plant is not expected to last. */
export const HAZARD_THRESHOLD = 1.6;

export const HAZARD_WEIGHTS = {
  lightDeficit: 1.5,
  lightOvershoot: 0.5,
  coldShare: 1.2,
  heatShare: 0.9,
  waterDry: 1.1,
  waterWet: 1.2,
  climateStrain: 0.8,
  careShortfall: 0.7,
  drySpell: 0.8,
} as const;

export interface HazardBreakdown {
  total: number;
  survives: boolean;
  terms: { label: string; value: number; weight: number; contribution: number }[];
  dominant: string;
}

export function hazardScore(input: FeatureInput): HazardBreakdown {
  const t = rawTerms(input);
  const climate = climateTermValue(input);
  const care = careTermValue(input);

  const raw: { label: string; value: number; weight: number }[] = [
    { label: "light deficit", value: t.light.deficit, weight: HAZARD_WEIGHTS.lightDeficit },
    { label: "light overshoot", value: t.light.overshoot, weight: HAZARD_WEIGHTS.lightOvershoot },
    { label: "cold nights", value: coldTermValue(input), weight: HAZARD_WEIGHTS.coldShare },
    { label: "hot days", value: heatTermValue(input), weight: HAZARD_WEIGHTS.heatShare },
    { label: "too dry", value: t.water.dry, weight: HAZARD_WEIGHTS.waterDry },
    { label: "too wet", value: t.water.wet, weight: HAZARD_WEIGHTS.waterWet },
    { label: "climate strain", value: climate, weight: HAZARD_WEIGHTS.climateStrain },
    { label: "care shortfall", value: care, weight: HAZARD_WEIGHTS.careShortfall },
    { label: "dry spell", value: drySpellValue(input, t.dryingDays, t.windowLength), weight: HAZARD_WEIGHTS.drySpell },
  ];

  const terms = raw.map((term) => ({
    label: term.label,
    value: Math.round(term.value * 1000) / 1000,
    weight: term.weight,
    contribution: Math.round(term.value * term.weight * 1000) / 1000,
  }));

  const total = terms.reduce((sum, term) => sum + term.contribution, 0);
  const dominant =
    terms
      .slice()
      .sort((a, b) => b.contribution - a.contribution || a.label.localeCompare(b.label))[0]?.label ??
    "none";

  return {
    total: Math.round(total * 1000) / 1000,
    survives: total < HAZARD_THRESHOLD,
    terms,
    dominant,
  };
}

export function labelFor(input: FeatureInput): number {
  return hazardScore(input).survives ? 1 : 0;
}

function coldTermValue(input: FeatureInput): number {
  const s = input.species;
  if (input.forecast.length === 0) return 0;
  let sum = 0;
  for (const day of input.forecast) {
    sum += Math.max(0, Math.min(1, (s.minTempC - sillTemperature(day.minC, "cold")) / 8));
  }
  return sum / input.forecast.length;
}

function heatTermValue(input: FeatureInput): number {
  const s = input.species;
  if (input.forecast.length === 0) return 0;
  let sum = 0;
  for (const day of input.forecast) {
    sum += Math.max(0, Math.min(1, (sillTemperature(day.maxC, "heat") - s.maxTempC) / 6));
  }
  return sum / input.forecast.length;
}

function climateTermValue(input: FeatureInput): number {
  const s = input.species;
  if (input.normals.length === 0) return 0;
  let cold = 0;
  let hot = 0;
  for (const n of input.normals) {
    cold += Math.max(0, Math.min(1, (s.minTempC - sillTemperature(n.minC, "cold")) / 10));
    hot += Math.max(0, Math.min(1, (sillTemperature(n.maxC, "heat") - s.maxTempC) / 8));
  }
  return Math.min(2, cold / input.normals.length + hot / input.normals.length);
}

function careTermValue(input: FeatureInput): number {
  const careIndex = input.careLevel === "forgetful" ? 0 : input.careLevel === "weekly" ? 1 : 2;
  const difficultyIndex =
    input.species.difficulty === "easy" ? 0 : input.species.difficulty === "moderate" ? 1 : 2;
  const deficit = careIndex - difficultyIndex;
  return Math.max(0, Math.min(1, -deficit / 2));
}

function drySpellValue(input: FeatureInput, dryingDays: number, windowLength: number): number {
  if (dryingDays === 0 || windowLength === 0) return 0;
  const implied = windowLength / (dryingDays + 1);
  const gap = Math.max(0, input.wateringDays - implied);
  return Math.max(0, Math.min(2, gap / Math.max(4, input.species.waterDays)));
}