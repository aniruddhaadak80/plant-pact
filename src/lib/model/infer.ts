import type { ExtractedFeature } from "./features";
import { WEIGHTS } from "./weights";
import type { FeatureKey, ModelFeature, ModelResult } from "../types";

/**
 * In-process inference for the survival model.
 *
 * Deliberately tiny and deliberately boring: a bias plus seven weighted
 * features, then a logistic squash. No network call, no vendor SDK, no API
 * key, sub-millisecond. It runs identically in a route handler, in the MCP
 * tool layer and in a browser test, which is what makes the numbers on the
 * page and the numbers in the agent response provably the same numbers.
 */

export const MODEL_VERSION = WEIGHTS.version;

export function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function round(value: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function labelFor(probability: number): ModelResult["label"] {
  if (probability >= 0.7) return "likely";
  if (probability >= 0.35) return "uncertain";
  return "unlikely";
}

export function infer(features: ExtractedFeature[]): ModelResult {
  const detailed: ModelFeature[] = features.map((feature) => {
    const weight = WEIGHTS.features[feature.key as FeatureKey];
    return {
      key: feature.key,
      label: feature.label,
      value: feature.value,
      weight: round(weight, 4),
      contribution: round(weight * feature.value, 4),
      evidence: feature.evidence,
    };
  });

  const logit =
    WEIGHTS.bias + detailed.reduce((sum, feature) => sum + feature.contribution, 0);
  const probability = sigmoid(logit);

  const worst = detailed
    .filter((feature) => feature.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution || a.key.localeCompare(b.key))[0];

  const killer = worst ? worst.key : "lightDeficit";

  return {
    modelVersion: MODEL_VERSION,
    logit: round(logit, 6),
    probability: round(probability, 4),
    label: labelFor(probability),
    features: detailed,
    killer,
    killerContribution: worst ? worst.contribution : 0,
  };
}

export interface ModelCard {
  version: string;
  family: string;
  trainedAt: string;
  seed: number;
  features: FeatureKey[];
  corpus: {
    cities: number;
    rows: number;
    trainRows: number;
    holdoutRows: number;
    labels: { survived: number; failed: number };
  };
  metrics: {
    holdoutAuc: number;
    holdoutAccuracy: number;
    logLoss: number;
    brier: number;
    baseSurvivalRate: number;
  };
  notes: string;
}

export const MODEL_CARD: ModelCard = WEIGHTS.card;