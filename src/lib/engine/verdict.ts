import type {
  BreakingPoint,
  CareLevel,
  DayProjection,
  EngineVerdict,
  FeatureKey,
  ModelResult,
  SkyBundle,
  SpeciesProfile,
} from "../types";
import { extractFeatures, type FeatureInput } from "../model/features";
import { MODEL_VERSION, infer } from "../model/infer";
import { FORECAST_DAYS } from "../weather/open-meteo";

export const ENGINE_VERSION = "pact-verdict@2026.10.0";

/**
 * Survival below this level counts as "this placement fails". The headline
 * probability is model output; the threshold is a published product decision,
 * so a reader can disagree with the threshold without disputing the model.
 */
export const ALERT_THRESHOLD = 0.5;

export interface VerdictInput {
  species: SpeciesProfile;
  windowHours: number;
  wateringDays: number;
  careLevel: CareLevel;
  sky: SkyBundle;
  /** Commitment length in days, recorded on the pact. */
  horizonDays: number;
}

export function featureInputFrom(input: VerdictInput): FeatureInput {
  return {
    species: {
      minLightHours: input.species.minLightHours,
      maxLightHours: input.species.maxLightHours,
      minTempC: input.species.minTempC,
      maxTempC: input.species.maxTempC,
      waterDays: input.species.waterDays,
      waterToleranceDays: input.species.waterToleranceDays,
      difficulty: input.species.difficulty,
    },
    windowHours: input.windowHours,
    wateringDays: input.wateringDays,
    careLevel: input.careLevel,
    forecast: input.sky.forecast,
    normals: input.sky.normals,
  };
}

interface Advice {
  headline: string;
  action: string;
}

export const ADVICE: Record<FeatureKey, Advice> = {
  lightDeficit: {
    headline: "Not enough light for this species.",
    action:
      "Move it to the brightest window in the flat, or add a grow lamp. If no window can supply the hours, choose a lower-light species instead of a fussy one.",
  },
  lightOvershoot: {
    headline: "Far more light than this species tolerates.",
    action:
      "Pull it back from the glass with a sheer curtain or move it off a west sill. Scorch shows up as bleached patches that never recover.",
  },
  lightHeadroom: {
    headline: "Light is comfortably inside the band.",
    action: "Nothing to change. Note the window so the next person does not move it.",
  },
  coldShare: {
    headline: "Cold nights put this species below its tolerance.",
    action:
      "Keep it off the sill on the coldest nights and away from draughts and single glazing. Moving it a metre into the room is usually enough.",
  },
  heatShare: {
    headline: "Hot days push the sill past its tolerance.",
    action: "Give it shade at midday, ventilate the room, and check whether the pot is sitting in direct sun behind glass.",
  },
  waterDry: {
    headline: "The watering rhythm is too slow for this species.",
    action:
      "Shorten the gap between waterings to what the plant asks for, and set a calendar reminder. Under-watering is the quieter of the two failures.",
  },
  waterWet: {
    headline: "The watering rhythm is too fast for this species.",
    action:
      "Let it dry further between drinks, and check that the pot drains. Constantly moist soil is the most reliable way to kill a plant that people were trying to save.",
  },
  climateStrain: {
    headline: "This location is outside the species' year-round comfort range.",
    action:
      "Expect the hard weeks to be seasonal, not random. Move it indoors for the coldest stretch, or pick a species that tolerates this climate.",
  },
  careShortfall: {
    headline: "The routine is thinner than this species needs.",
    action:
      "Either raise the cadence, or hand the plant to someone whose routine matches it. Plants are unforgiving about this in a way pets are not.",
  },
  drySpell: {
    headline: "The forecast contains a dry, hot stretch the routine does not cover.",
    action:
      "Add a single extra watering around the dry-heat days in the forecast, and move it off a warm sill during that stretch.",
  },
};

function killerFeature(model: ModelResult): FeatureKey {
  return model.killer;
}

/**
 * The projection path.
 *
 * The same weight vector is re-evaluated on the forecast prefix available on
 * each day, so the path is not a separate model and not an animation curve: it
 * is the shipped model run with less evidence. Because the weather-derived
 * features accumulate over the prefix, the curve drifts as cold nights and dry
 * spells build up. The final point of the path is exactly the headline
 * probability, which is a property the tests assert.
 *
 * It is a projection under the model's own assumptions, not an upstream
 * forecast, and the UI says so.
 */
function buildPath(input: VerdictInput): { path: DayProjection[]; model: ModelResult } {
  const base = featureInputFrom(input);
  const window = input.sky.forecast.slice(0, FORECAST_DAYS);
  const path: DayProjection[] = [];
  let previousSurvival = 1;
  let finalModel: ModelResult | null = null;

  for (let i = 0; i < window.length; i += 1) {
    const features = extractFeatures(base, i);
    const model = infer(features);
    path.push({
      date: window[i].date,
      minC: window[i].minC,
      maxC: window[i].maxC,
      survival: model.probability,
      previousSurvival: Math.round(previousSurvival * 10000) / 10000,
      dayKiller: killerFeature(model),
    });
    previousSurvival = model.probability;
    finalModel = model;
  }

  if (!finalModel) {
    finalModel = infer(extractFeatures(base));
  }
  return { path, model: finalModel };
}

function findBreakingPoint(path: DayProjection[]): BreakingPoint {
  const crossing = path.findIndex((point) => point.survival < ALERT_THRESHOLD);
  if (crossing >= 0) {
    return {
      date: path[crossing].date,
      dayIndex: crossing,
      projectedDate: path[crossing].date,
      probabilityAtProjection: path[crossing].survival,
    };
  }

  // No crossing inside the forecast window. Project the recent slope forward so
  // the answer is still a date rather than a shrug.
  const tail = path.slice(-Math.min(7, path.length));
  if (tail.length >= 2) {
    const first = tail[0];
    const last = tail[tail.length - 1];
    const daysBetween = Math.max(1, tail.length - 1);
    const slope = (last.survival - first.survival) / daysBetween;
    if (slope < -1e-6 && last.survival > ALERT_THRESHOLD) {
      const daysToCross = (last.survival - ALERT_THRESHOLD) / -slope;
      if (daysToCross <= 730) {
        const projected = new Date(`${last.date}T00:00:00Z`);
        projected.setUTCDate(projected.getUTCDate() + Math.ceil(daysToCross));
        return {
          date: null,
          dayIndex: null,
          projectedDate: projected.toISOString().slice(0, 10),
          probabilityAtProjection: ALERT_THRESHOLD,
        };
      }
    }
  }

  const last = path[path.length - 1];
  return {
    date: null,
    dayIndex: null,
    projectedDate: null,
    probabilityAtProjection: last ? last.survival : 0,
  };
}

function confidenceFor(sky: SkyBundle, pathLength: number): EngineVerdict["confidence"] {
  if (sky.origin !== "live") return "low";
  if (sky.normals.length < 12) return "low";
  if (pathLength < 10) return "medium";
  return "high";
}

function buildAlerts(input: VerdictInput, model: ModelResult): string[] {
  const alerts: string[] = [];
  const byKey = new Map(model.features.map((f) => [f.key, f]));

  if (input.species.toxic) {
    alerts.push(
      `${input.species.commonName} is flagged toxic to pets and children. Keep it out of reach; the flag is conservative and general, so confirm species with a veterinarian if an animal chews it.`,
    );
  }
  const cold = byKey.get("coldShare");
  if (cold && cold.value > 0.2) {
    alerts.push(`Cold exposure is material here: ${cold.evidence}`);
  }
  const wet = byKey.get("waterWet");
  if (wet && wet.value > 0.5) {
    alerts.push(`Over-watering risk is the dominant water term: ${wet.evidence}`);
  }
  if (input.sky.origin === "fallback") {
    alerts.push(
      "Weather is the sealed offline sample, not a live forecast. Re-run the projection when the service is reachable before trusting the date.",
    );
  }
  return alerts;
}

export function evaluate(input: VerdictInput): EngineVerdict {
  const { path, model } = buildPath(input);
  const breakingPoint = findBreakingPoint(path);
  const killer = killerFeature(model);
  const advice = ADVICE[killer];

  const ranked = model.features
    .filter((f) => f.key !== "lightHeadroom" && f.value > 0)
    .sort((a, b) => a.contribution - b.contribution || a.key.localeCompare(b.key));
  const secondary = ranked[1];

  const recommendation =
    model.probability >= 0.7
      ? `Commit to this placement. ${advice.headline}`
      : model.probability >= 0.35
        ? `Commit only with a change. ${advice.headline}`
        : `Do not gift this yet. ${advice.headline}`;

  const recommendationDetail = secondary
    ? `${advice.action} Second-order: ${ADVICE[secondary.key as FeatureKey]?.action ?? ""}`.trim()
    : advice.action;

  return {
    engineVersion: ENGINE_VERSION,
    modelVersion: MODEL_VERSION,
    model,
    path,
    breakingPoint,
    killerLabel:
      model.features.find((feature) => feature.key === killer)?.label ?? killer,
    killerNote: advice.headline,
    recommendation,
    recommendationDetail: recommendationDetail.trim(),
    alerts: buildAlerts(input, model),
    horizonDays: input.horizonDays,
    confidence: confidenceFor(input.sky, input.sky.forecast.length),
  };
}

/** One-line summary stored on the pact row so lists do not need a rescore. */
export function killerNote(killer: FeatureKey): string {
  return ADVICE[killer].headline;
}