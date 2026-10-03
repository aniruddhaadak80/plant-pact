// GENERATED FILE - do not edit by hand. Run `npm run train` to regenerate.
//
// Logistic-regression survival model for Plant Pact, fitted with batch gradient
// descent (seed 20261002, 6000 iterations, L2=0.04) against labels produced by the
// published risk procedure pact-risk-procedure@2026.10.0 (hazard threshold 1.6).
// Feature values come from real Open-Meteo forecasts and ERA5 normals across
// 24 cities; see training/cities.json for provenance.
//
// Held-out metrics below were computed with these rounded weights, so they
// describe exactly what the application runs.
import type { FeatureKey } from "../types";

export const WEIGHTS = {
  version: "pact-survival@2026.10.0",
  bias: 1.2915,
  features: {
  lightDeficit: -0.7324,
  lightOvershoot: -0.2032,
  lightHeadroom: 0.3022,
  coldShare: -0.441,
  heatShare: -0.0342,
  waterDry: -0.8511,
  waterWet: -1.2444,
  climateStrain: -0.4112,
  careShortfall: -0.5511,
  drySpell: -0.6398,
  },
  card: {
    version: "pact-survival@2026.10.0",
    family: "logistic regression (L2, batch gradient descent)",
    trainedAt: "2026-10-03T02:36:08.554Z",
    seed: 20261002,
    features: [
      "lightDeficit",
      "lightOvershoot",
      "lightHeadroom",
      "coldShare",
      "heatShare",
      "waterDry",
      "waterWet",
      "climateStrain",
      "careShortfall",
      "drySpell",
    ] as FeatureKey[],
    corpus: {
      cities: 24,
      rows: 8040,
      trainRows: 6432,
      holdoutRows: 1608,
      labels: {
        survived: 4690,
        failed: 3350,
      },
    },
    metrics: {
      holdoutAuc: 0.9556,
      holdoutAccuracy: 0.8887,
      logLoss: 0.4586,
      brier: 0.1413,
      baseSurvivalRate: 0.5833,
    },
    notes:
      "Features are observable quantities: measured window light, stated watering cadence, stated care level, plus live forecast and climate-normal aggregates. Contribution = weight x feature; the sum of contributions plus the bias is the logit, and sigmoid(logit) is the reported survival probability.",
  },
} as const;
