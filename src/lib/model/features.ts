import type { CareLevel, DayWeather, Difficulty, FeatureKey, MonthNormal } from "../types";

/**
 * Feature extraction for the survival model.
 *
 * This module is the single source of truth for feature values. It is
 * imported by the training script, the REST layer, the MCP tools and the UI,
 * so a pact can never be scored with different inputs depending on who asks.
 *
 * Every feature is derived from something a visitor can actually measure
 * (window light hours, how often they water, who cares for the plant) or from
 * real upstream weather data. Nothing here reads a hidden signal.
 *
 * Design rule: nine of the ten features are risk-shaped, where a larger value
 * always means a worse outcome. That makes one negative weight per feature the
 * correct hypothesis, keeps the logistic fit well conditioned, and lets the UI
 * read each bar as "this is how much this one thing is costing you".
 * `lightHeadroom` is the only feature where more is better.
 *
 * Pure module, erasable TypeScript syntax only, so `npm run train` can import
 * it directly without a build step.
 */

export interface SpeciesTraits {
  minLightHours: number;
  maxLightHours: number;
  minTempC: number;
  maxTempC: number;
  waterDays: number;
  waterToleranceDays: number;
  difficulty: Difficulty;
}

export interface FeatureInput {
  species: SpeciesTraits;
  /** Measured/estimated direct light hours per day at this window. */
  windowHours: number;
  /** How often the recipient actually waters, in days. */
  wateringDays: number;
  careLevel: CareLevel;
  /** Live (or labelled fallback) daily forecast. */
  forecast: DayWeather[];
  /** 12 monthly climate normals for the recipient's location. */
  normals: MonthNormal[];
}

export interface ExtractedFeature {
  key: FeatureKey;
  label: string;
  value: number;
  /** True when a larger value is a worse outcome. */
  risk: boolean;
  /** Human-readable, numbers-first evidence for this exact feature. */
  evidence: string;
}

export type FeatureGroupId = "light" | "water" | "air" | "care";

export interface FeatureGroup {
  id: FeatureGroupId;
  label: string;
  features: FeatureKey[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  { id: "light", label: "Light", features: ["lightDeficit", "lightOvershoot", "lightHeadroom"] },
  { id: "water", label: "Water", features: ["waterDry", "waterWet", "drySpell"] },
  { id: "air", label: "Air", features: ["coldShare", "heatShare", "climateStrain"] },
  { id: "care", label: "Care", features: ["careShortfall"] },
];

const CARE_INDEX: Record<CareLevel, number> = {
  forgetful: 0,
  weekly: 1,
  diligent: 2,
};

const DIFFICULTY_INDEX: Record<Difficulty, number> = {
  easy: 0,
  moderate: 1,
  fussy: 2,
};

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Sill thermal model.
 *
 * Open-Meteo only publishes outdoor conditions, but the plant is on an indoor
 * windowsill. Judging a plant directly against the outdoor forecast makes
 * every temperate city look arctic, which is both wrong and useless to the
 * person reading the page.
 *
 * So outdoor extremes are mapped onto sill extremes with a fixed, published
 * damping model: glazing, mass and a heated flat pull the sill toward a neutral
 * indoor temperature. Cold is damped harder than heat, because radiators hold
 * a flat near 17-20 °C in winter while a sunlit south sill in summer genuinely
 * gets hot behind the glass.
 *
 * This is deliberately simple and inspectable rather than clever. It is a
 * deterministic transform with no fitted parameters, and it is shown to the
 * reader on the detail page ("8.0 °C outside reads as 13.0 °C on this sill").
 */
export const SILL_MODEL = {
  /** Temperature an unheated-to-moderately-heated flat drifts toward. */
  neutralC: 17,
  /** How much of an outdoor cold extreme reaches the sill. */
  coldDamping: 0.45,
  /** How much of an outdoor heat extreme reaches a sunlit sill. */
  heatDamping: 0.6,
} as const;

export function sillTemperature(outdoorC: number, side: "cold" | "heat"): number {
  const damping = side === "cold" ? SILL_MODEL.coldDamping : SILL_MODEL.heatDamping;
  return SILL_MODEL.neutralC + (outdoorC - SILL_MODEL.neutralC) * damping;
}

function round(value: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function f1(value: number): string {
  return value.toFixed(1);
}

function lightTerms(windowHours: number, species: SpeciesTraits) {
  const span = Math.max(2, species.maxLightHours - species.minLightHours);
  const deficit = clamp((species.minLightHours - windowHours) / Math.max(1.5, species.minLightHours), 0, 1.5);
  const overshoot = clamp((windowHours - species.maxLightHours) / 4, 0, 1.5);
  const headroom = clamp((windowHours - species.minLightHours) / span, 0, 1);

  const deficitEvidence =
    deficit > 0
      ? `${f1(windowHours)} h of light against a ${species.minLightHours}\u2013${species.maxLightHours} h band: ${f1(species.minLightHours - windowHours)} h short of the minimum.`
      : `${f1(windowHours)} h of light already clears the ${species.minLightHours} h minimum.`;
  const overshootEvidence =
    overshoot > 0
      ? `${f1(windowHours)} h runs ${f1(windowHours - species.maxLightHours)} h past the ${species.maxLightHours} h ceiling.`
      : `${f1(windowHours)} h stays under the ${species.maxLightHours} h ceiling.`;
  const headroomEvidence =
    headroom >= 0.999
      ? `Sitting at the top of the ${species.minLightHours}\u2013${species.maxLightHours} h band.`
      : `${Math.round(headroom * 100)}% of the way from the ${species.minLightHours} h minimum to the ${species.maxLightHours} h maximum.`;

  return {
    deficit: round(deficit),
    overshoot: round(overshoot),
    headroom: round(headroom),
    deficitEvidence,
    overshootEvidence,
    headroomEvidence,
    headroomRaw: headroom,
  };
}

/**
 * Cold exposure. Severity is summed across the days observed and divided by the
 * length of the FULL forecast window, not the days seen so far. Dividing by the
 * full length is what makes the projection path monotonic: as more cold nights
 * arrive the exposure can only grow, which is the causal story the product
 * tells. Dividing by the observed length would turn it into a running average,
 * where a single mild day would erase the stress of the week before it.
 */
function coldTerm(days: DayWeather[], species: SpeciesTraits, windowLength: number) {
  let sum = 0;
  let count = 0;
  let worst = 0;
  let worstDate = "";
  let worstOutdoor = 0;
  let worstSill = 0;
  for (const day of days) {
    const sill = sillTemperature(day.minC, "cold");
    const severity = clamp((species.minTempC - sill) / 8, 0, 1);
    if (severity > 0) {
      sum += severity;
      count += 1;
      const under = species.minTempC - sill;
      if (under > worst) {
        worst = under;
        worstDate = day.date;
        worstOutdoor = day.minC;
        worstSill = sill;
      }
    }
  }
  const value = windowLength > 0 ? sum / windowLength : 0;
  const evidence =
    count === 0
      ? `No night in this ${days.length}-day window puts the sill below ${species.minTempC} \u00b0C (coldest read ${f1(sillTemperature(Math.min(...days.map((d) => d.minC)), "cold"))} \u00b0C).`
      : `${count} of ${days.length} nights put the sill below ${species.minTempC} \u00b0C; worst was ${f1(worstOutdoor)} \u00b0C outside reading ${f1(worstSill)} \u00b0C on the sill (${worstDate}).`;
  return { value: round(value), evidence, count };
}

function heatTerm(days: DayWeather[], species: SpeciesTraits, windowLength: number) {
  let sum = 0;
  let count = 0;
  let worst = 0;
  let worstDate = "";
  let worstOutdoor = 0;
  let worstSill = 0;
  for (const day of days) {
    const sill = sillTemperature(day.maxC, "heat");
    const severity = clamp((sill - species.maxTempC) / 6, 0, 1);
    if (severity > 0) {
      sum += severity;
      count += 1;
      const over = sill - species.maxTempC;
      if (over > worst) {
        worst = over;
        worstDate = day.date;
        worstOutdoor = day.maxC;
        worstSill = sill;
      }
    }
  }
  const value = windowLength > 0 ? sum / windowLength : 0;
  const evidence =
    count === 0
      ? `No day in this ${days.length}-day window puts the sill above ${species.maxTempC} \u00b0C (warmest read ${f1(sillTemperature(Math.max(...days.map((d) => d.maxC)), "heat"))} \u00b0C).`
      : `${count} of ${days.length} days put the sill above ${species.maxTempC} \u00b0C; worst was ${f1(worstOutdoor)} \u00b0C outside reading ${f1(worstSill)} \u00b0C behind the glass (${worstDate}).`;
  return { value: round(value), evidence, count };
}

function waterTerms(wateringDays: number, species: SpeciesTraits) {
  const tol = Math.max(4, species.waterToleranceDays);
  const diff = wateringDays - species.waterDays;
  const rawDry = Math.max(0, diff - tol) / tol;
  const wetScale = clamp(species.waterDays / 12, 0.4, 2);
  const rawWet = (Math.max(0, -diff - tol) / tol) * wetScale;
  const dry = clamp(rawDry, 0, 3);
  const wet = clamp(rawWet, 0, 3);

  const dryEvidence =
    diff <= tol
      ? `Watering every ${f1(wateringDays)} d against a ${species.waterDays} d need: inside the \u00b1${tol.toFixed(0)} d tolerance, so no stress accrued.`
      : `Watering every ${f1(wateringDays)} d against a ${species.waterDays} d need: ${(diff - tol).toFixed(0)} d beyond tolerance accumulating every cycle.`;
  const wetEvidence =
    diff >= -tol
      ? `Watering every ${f1(wateringDays)} d is not more often than a ${species.waterDays} d species wants.`
      : `Watering every ${f1(wateringDays)} d against a ${species.waterDays} d need: ${(-diff - tol).toFixed(0)} d beyond tolerance, the classic rot route.`;

  return { dry, wet, dryEvidence, wetEvidence, rawDry, rawWet, tol };
}

function climateTerm(normals: MonthNormal[], species: SpeciesTraits) {
  if (normals.length === 0) {
    return { value: 0, evidence: "No climate normals available for this location." };
  }
  let cold = 0;
  let hot = 0;
  const coldList: string[] = [];
  const hotList: string[] = [];
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (const n of normals) {
    const name = names[n.month - 1] ?? `M${n.month}`;
    const c = clamp((species.minTempC - n.minC) / 10, 0, 1);
    const h = clamp((n.maxC - species.maxTempC) / 8, 0, 1);
    cold += c;
    hot += h;
    if (c > 0) coldList.push(name);
    if (h > 0) hotList.push(name);
  }
  const value = round(clamp(cold / normals.length + hot / normals.length, 0, 2));
  const parts: string[] = [];
  if (coldList.length > 0) {
    parts.push(
      `${coldList.length} of ${normals.length} months normal below ${species.minTempC} \u00b0C (${coldList.join(", ")})`,
    );
  }
  if (hotList.length > 0) {
    parts.push(
      `${hotList.length} above ${species.maxTempC} \u00b0C (${hotList.join(", ")})`,
    );
  }
  const evidence =
    parts.length === 0
      ? `All ${normals.length} monthly normals sit inside ${species.minTempC}\u2013${species.maxTempC} \u00b0C here.`
      : `${parts.join(", ")}.`;
  return { value, evidence };
}

function careTerm(careLevel: CareLevel, species: SpeciesTraits) {
  const deficit = CARE_INDEX[careLevel] - DIFFICULTY_INDEX[species.difficulty];
  const shortfall = clamp(-deficit / 2, 0, 1);
  const evidence =
    deficit === 0
      ? `A ${species.difficulty} species with a ${careLevel} routine: matched.`
      : deficit > 0
        ? `A ${species.difficulty} species handed to a ${careLevel} caretaker: the routine is ${deficit} level${deficit > 1 ? "s" : ""} short of what it asks for.`
        : `A ${species.difficulty} species with an attentive ${careLevel} caretaker: more care than it needs, which is rarely harmful.`;
  return { value: round(shortfall), evidence };
}

function drySpellTerm(days: DayWeather[], species: SpeciesTraits, wateringDays: number, windowLength: number) {
  const threshold = species.maxTempC - 6;
  const drying = days.filter((d) => d.precipitationProbabilityMax <= 20 && d.maxC >= threshold);
  if (drying.length === 0) {
    return {
      value: 0,
      evidence: `No dry-heat days in this ${days.length}-day window (under ${threshold.toFixed(0)} \u00b0C with \u226420% rain chance).`,
    };
  }
  const impliedInterval = windowLength / (drying.length + 1);
  const gap = Math.max(0, wateringDays - impliedInterval);
  const value = round(clamp(gap / Math.max(4, species.waterDays), 0, 2));
  const evidence =
    gap > 0.2
      ? `${drying.length} dry-heat days in ${days.length}; a ${f1(impliedInterval)} d gap covers them, but the routine is ${f1(wateringDays)} d.`
      : `${drying.length} dry-heat days in ${days.length}, covered by the current ${f1(wateringDays)} d routine.`;
  return { value, evidence, dryingDays: drying.length, impliedInterval: round(impliedInterval, 2) };
}

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  lightDeficit: "Light deficit",
  lightOvershoot: "Light overshoot",
  lightHeadroom: "Light headroom",
  coldShare: "Cold nights",
  heatShare: "Hot days",
  waterDry: "Too dry",
  waterWet: "Too wet",
  climateStrain: "Climate strain",
  careShortfall: "Care shortfall",
  drySpell: "Dry spell",
};

export const FEATURE_RISK: Record<FeatureKey, boolean> = {
  lightDeficit: true,
  lightOvershoot: true,
  lightHeadroom: false,
  coldShare: true,
  heatShare: true,
  waterDry: true,
  waterWet: true,
  climateStrain: true,
  careShortfall: true,
  drySpell: true,
};

/**
 * `upToIndex` re-evaluates the weather-derived features using only the forecast
 * prefix available on that day, which is how the projection path is produced
 * without a second model.
 */
export function extractFeatures(input: FeatureInput, upToIndex?: number): ExtractedFeature[] {
  const slice = typeof upToIndex === "number" ? input.forecast.slice(0, upToIndex + 1) : input.forecast;
  const window = slice.length > 0 ? slice : input.forecast;
  // Exposure features normalise against the length of the full forecast window so
  // that evaluating a prefix accumulates risk instead of averaging it away.
  const windowLength = Math.max(1, input.forecast.length);

  const light = lightTerms(input.windowHours, input.species);
  const cold = coldTerm(window, input.species, windowLength);
  const heat = heatTerm(window, input.species, windowLength);
  const water = waterTerms(input.wateringDays, input.species);
  const climate = climateTerm(input.normals, input.species);
  const care = careTerm(input.careLevel, input.species);
  const drySpell = drySpellTerm(window, input.species, input.wateringDays, windowLength);

  return [
    { key: "lightDeficit", label: FEATURE_LABELS.lightDeficit, value: light.deficit, risk: true, evidence: light.deficitEvidence },
    { key: "lightOvershoot", label: FEATURE_LABELS.lightOvershoot, value: light.overshoot, risk: true, evidence: light.overshootEvidence },
    { key: "lightHeadroom", label: FEATURE_LABELS.lightHeadroom, value: light.headroom, risk: false, evidence: light.headroomEvidence },
    { key: "coldShare", label: FEATURE_LABELS.coldShare, value: cold.value, risk: true, evidence: cold.evidence },
    { key: "heatShare", label: FEATURE_LABELS.heatShare, value: heat.value, risk: true, evidence: heat.evidence },
    { key: "waterDry", label: FEATURE_LABELS.waterDry, value: water.dry, risk: true, evidence: water.dryEvidence },
    { key: "waterWet", label: FEATURE_LABELS.waterWet, value: water.wet, risk: true, evidence: water.wetEvidence },
    { key: "climateStrain", label: FEATURE_LABELS.climateStrain, value: climate.value, risk: true, evidence: climate.evidence },
    { key: "careShortfall", label: FEATURE_LABELS.careShortfall, value: care.value, risk: true, evidence: care.evidence },
    { key: "drySpell", label: FEATURE_LABELS.drySpell, value: drySpell.value, risk: true, evidence: drySpell.evidence },
  ];
}

export function featuresToVector(features: ExtractedFeature[]): number[] {
  return features.map((f) => f.value);
}

/**
 * Raw sub-terms the published risk procedure needs. Kept separate from the
 * feature vector because the procedure is a hazard accumulator, while the
 * model is a linear-in-features classifier.
 */
export function rawTerms(input: FeatureInput) {
  const light = lightTerms(input.windowHours, input.species);
  const water = waterTerms(input.wateringDays, input.species);
  const threshold = input.species.maxTempC - 6;
  const dryingDays = input.forecast.filter(
    (d) => d.precipitationProbabilityMax <= 20 && d.maxC >= threshold,
  ).length;
  return {
    light,
    water,
    dryingDays,
    windowLength: input.forecast.length,
  };
}