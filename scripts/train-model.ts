/**
 * Fits the shipped survival model and writes src/lib/model/weights.ts.
 *
 * Method, in plain words:
 *   1. Take the 24 real cities in training/cities.json (real 14-day forecasts
 *      plus real ERA5 monthly normals, fetched by scripts/fetch-training-corpus.ts).
 *   2. For each city, deterministically sample realistic placements: a species
 *      from the catalogue, a window with a plausible number of light hours, a
 *      watering cadence a real person would keep, and a stated care level.
 *   3. Extract the seven observable features with the SAME extractor the app
 *      uses at inference time (src/lib/model/features.ts).
 *   4. Label each scenario with the published risk procedure
 *      (src/lib/engine/labeling.ts): survived = 1 when accumulated hazard
 *      stays under the documented threshold, otherwise 0.
 *   5. Fit an L2-regularised logistic regression by batch gradient descent with
 *      a fixed seed, a fixed iteration count and a class-balanced loss
 *      (survival is the minority class, and an unbalanced fit degenerates into
 *      predicting failure for everything). No randomness beyond the seeded
 *      sampler, so re-running reproduces byte-identical weights.
 *   6. Report held-out AUC, accuracy, log loss and Brier score, then write the
 *      weights rounded to 4dp and re-score the holdout with those rounded
 *      weights so the published metrics describe the shipped model exactly.
 *
 * Run with:  npm run train
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOGUE } from "../src/lib/species.ts";
import { extractFeatures, featuresToVector } from "../src/lib/model/features.ts";
import { labelFor } from "../src/lib/engine/labeling.ts";
import { HAZARD_THRESHOLD, LABELING_VERSION } from "../src/lib/engine/labeling.ts";
import { FEATURE_KEYS } from "../src/lib/types.ts";
import type { DayWeather, MonthNormal } from "../src/lib/types.ts";

const SEED = 20261002;
const MODEL_VERSION = "pact-survival@2026.10.0";
const SCENARIOS_PER_CITY = 620;
const HOLDOUT_EVERY = 5;
const ITERATIONS = 6000;
const LEARNING_RATE = 0.6;
const L2 = 0.04;
const SCENARIOS_PER_SPECIES = 14;

/**
 * Realism of the sampler matters more than its size. An earlier version drew
 * window light and watering cadence uniformly, which describes nobody: it put
 * a fiddle-leaf fig in a 15-minute window watered every 30 days. The weights
 * below describe how people actually behave:
 *   - most windows deliver 2-6 h of light, very few deliver 15 minutes;
 *   - people water on their own rhythm (weekly-ish), not on the plant's rhythm,
 *     which is precisely the mismatch this product exists to detect;
 *   - most households are "weekly" caretakers, and care level does not adapt
 *     to the species, which is why gifted fussy plants die.
 */
const WINDOW_HOURS: [number, number][] = [
  [0.25, 1], [0.5, 2], [1, 3], [1.5, 4], [2, 8], [2.5, 7], [3, 8], [3.5, 6],
  [4, 7], [4.5, 5], [5, 6], [6, 5], [7, 3], [8, 3], [9, 2], [10, 2], [12, 1], [14, 1],
];
const WATERING_DAYS: [number, number][] = [
  [1, 2], [2, 3], [3, 6], [4, 7], [5, 8], [6, 6], [7, 7], [9, 5],
  [10, 5], [12, 3], [14, 3], [17, 2], [21, 2], [25, 1], [30, 1],
];
const CARE_LEVELS: [string, number][] = [["forgetful", 0.2], ["weekly", 0.55], ["diligent", 0.25]];

/**
 * How often each climate turns up in real life. Equivalently-weighted cities
 * would over-represent subarctic and equatorial extremes by a wide margin.
 */
const CITY_WEIGHTS: Record<string, number> = {
  "Reykjavik, Iceland": 0.35,
  "Tromso, Norway": 0.25,
  Ushuaia: 0.15,
  Dubai: 0.4,
  Singapore: 0.5,
  Bangkok: 0.6,
  Cairo: 0.7,
  Nairobi: 0.6,
  Bogotá: 0.8,
  "Mexico City, Mexico": 1.2,
  Kathmandu: 0.7,
  Jaipur: 0.9,
  Christchurch: 0.5,
  Chicago: 1.2,
  Toronto: 1.1,
  "New York, United States": 1.4,
  "Sao Paulo, Brazil": 1.2,
  Sydney: 1.0,
  London: 1.8,
  Berlin: 1.3,
  Warsaw: 1.0,
  Bengaluru: 1.5,
  Tokyo: 1.4,
};

function cityWeight(label: string): number {
  const key = Object.keys(CITY_WEIGHTS).find((k) => label.startsWith(k));
  return key ? CITY_WEIGHTS[key] : 1;
}

function pickWeighted<T>(pairs: [T, number][], rnd: () => number): T {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let roll = rnd() * total;
  for (const [value, w] of pairs) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

interface CorpusCity {
  label: string;
  latitude: number;
  longitude: number;
  forecast: DayWeather[];
  normals: MonthNormal[];
}

interface Row {
  vector: number[];
  label: number;
  city: string;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const corpusPath = resolve(here, "..", "training", "cities.json");
const weightsPath = resolve(here, "..", "src", "lib", "model", "weights.ts");

const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { cities: CorpusCity[] };

const rng = mulberry32(SEED);
const rows: Row[] = [];

// Cities are visited once each, with the number of scenarios drawn from that
// city scaled by how common its climate is in real life.
for (const city of corpus.cities) {
  const target = Math.max(
    40,
    Math.round(SCENARIOS_PER_CITY * (cityWeight(city.label) / 1.25)),
  );
  const scenarios: {
    species: (typeof CATALOGUE)[number];
    windowHours: number;
    wateringDays: number;
    careLevel: string;
  }[] = [];
  // Every species gets several placements per city so no species dominates the
  // label distribution through sheer count.
  for (const species of CATALOGUE) {
    for (let k = 0; k < SCENARIOS_PER_SPECIES; k += 1) {
      scenarios.push({
        species,
        windowHours: pickWeighted(WINDOW_HOURS, rng),
        wateringDays: pickWeighted(WATERING_DAYS, rng),
        careLevel: pickWeighted(CARE_LEVELS, rng),
      });
    }
  }
  // Shuffle deterministically, then take the requested number.
  for (let i = scenarios.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [scenarios[i], scenarios[j]] = [scenarios[j], scenarios[i]];
  }

  for (const scenario of scenarios.slice(0, target)) {
    const input = {
      species: {
        minLightHours: scenario.species.minLightHours,
        maxLightHours: scenario.species.maxLightHours,
        minTempC: scenario.species.minTempC,
        maxTempC: scenario.species.maxTempC,
        waterDays: scenario.species.waterDays,
        waterToleranceDays: scenario.species.waterToleranceDays,
        difficulty: scenario.species.difficulty,
      },
      windowHours: scenario.windowHours,
      wateringDays: scenario.wateringDays,
      careLevel: scenario.careLevel as "forgetful" | "weekly" | "diligent",
      forecast: city.forecast,
      normals: city.normals,
    };
    const features = extractFeatures(input);
    rows.push({
      vector: featuresToVector(features),
      label: labelFor(input),
      city: city.label,
    });
  }
}

const train = rows.filter((_, i) => i % HOLDOUT_EVERY !== 0);
const holdout = rows.filter((_, i) => i % HOLDOUT_EVERY === 0);

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

const D = FEATURE_KEYS.length;
const weights = new Array<number>(D).fill(0);
let bias = 0;

const trainPositives = train.filter((r) => r.label === 1).length;
const trainNegatives = train.length - trainPositives;
// Class-balanced loss. Survival is the minority class in the corpus, so an
// unbalanced fit would simply learn to predict failure and rank nothing.
const posWeight = train.length / (2 * Math.max(1, trainPositives));
const negWeight = train.length / (2 * Math.max(1, trainNegatives));

for (let iter = 0; iter < ITERATIONS; iter += 1) {
  const lr = LEARNING_RATE / (1 + iter / 2500);
  const gradW = new Array<number>(D).fill(0);
  let gradB = 0;
  for (const row of train) {
    let z = bias;
    for (let j = 0; j < D; j += 1) z += weights[j] * row.vector[j];
    const p = sigmoid(z);
    const classWeight = row.label === 1 ? posWeight : negWeight;
    const err = (p - row.label) * classWeight;
    for (let j = 0; j < D; j += 1) gradW[j] += err * row.vector[j];
    gradB += err;
  }
  for (let j = 0; j < D; j += 1) {
    const g = gradW[j] / train.length + L2 * weights[j];
    weights[j] -= lr * g;
  }
  bias -= lr * (gradB / train.length);
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

const shippedWeights = weights.map(round4);
const shippedBias = round4(bias);

function score(vector: number[], w: number[], b: number): number {
  let z = b;
  for (let j = 0; j < w.length; j += 1) z += w[j] * vector[j];
  return sigmoid(z);
}

function auc(pairs: { p: number; y: number }[]): number {
  const sorted = pairs.slice().sort((a, b) => a.p - b.p || a.y - b.y);
  let rank = 1;
  const ranks: number[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i].p === sorted[i - 1].p) {
      ranks.push(rank);
      rank += 1;
    } else {
      ranks.push(rank);
      rank += 1;
    }
  }
  let posSum = 0;
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].y === 1) {
      pos += 1;
      posSum += ranks[i];
    } else {
      neg += 1;
    }
  }
  if (pos === 0 || neg === 0) return 1;
  return (posSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

const holdoutScored = holdout.map((row) => ({
  p: score(row.vector, shippedWeights, shippedBias),
  y: row.label,
}));

const holdoutAuc = auc(holdoutScored);
let correct = 0;
let logLoss = 0;
let brier = 0;
for (const { p, y } of holdoutScored) {
  if ((p >= 0.5 ? 1 : 0) === y) correct += 1;
  const clipped = Math.min(1 - 1e-9, Math.max(1e-9, p));
  logLoss += -(y * Math.log(clipped) + (1 - y) * Math.log(1 - clipped));
  brier += (p - y) ** 2;
}
const holdoutAccuracy = correct / holdoutScored.length;
const holdoutLogLoss = logLoss / holdoutScored.length;
const holdoutBrier = brier / holdoutScored.length;

const survivedCount = rows.filter((r) => r.label === 1).length;

const weightEntries = FEATURE_KEYS.map(
  (key, i) => `  ${key}: ${shippedWeights[i]},`,
).join("\n");

const file = `// GENERATED FILE - do not edit by hand. Run \`npm run train\` to regenerate.
//
// Logistic-regression survival model for Plant Pact, fitted with batch gradient
// descent (seed ${SEED}, ${ITERATIONS} iterations, L2=${L2}) against labels produced by the
// published risk procedure ${LABELING_VERSION} (hazard threshold ${HAZARD_THRESHOLD}).
// Feature values come from real Open-Meteo forecasts and ERA5 normals across
// ${corpus.cities.length} cities; see training/cities.json for provenance.
//
// Held-out metrics below were computed with these rounded weights, so they
// describe exactly what the application runs.
import type { FeatureKey } from "../types";

export const WEIGHTS = {
  version: "${MODEL_VERSION}",
  bias: ${shippedBias},
  features: {
${weightEntries}
  },
  card: {
    version: "${MODEL_VERSION}",
    family: "logistic regression (L2, batch gradient descent)",
    trainedAt: "${new Date().toISOString()}",
    seed: ${SEED},
    features: [
${FEATURE_KEYS.map((k) => `      "${k}",`).join("\n")}
    ] as FeatureKey[],
    corpus: {
      cities: ${corpus.cities.length},
      rows: ${rows.length},
      trainRows: ${train.length},
      holdoutRows: ${holdout.length},
      labels: {
        survived: ${survivedCount},
        failed: ${rows.length - survivedCount},
      },
    },
    metrics: {
      holdoutAuc: ${round4(holdoutAuc)},
      holdoutAccuracy: ${round4(holdoutAccuracy)},
      logLoss: ${round4(holdoutLogLoss)},
      brier: ${round4(holdoutBrier)},
      baseSurvivalRate: ${round4(survivedCount / rows.length)},
    },
    notes:
      "Features are observable quantities: measured window light, stated watering cadence, stated care level, plus live forecast and climate-normal aggregates. Contribution = weight x feature; the sum of contributions plus the bias is the logit, and sigmoid(logit) is the reported survival probability.",
  },
} as const;
`;

writeFileSync(weightsPath, file, "utf8");

console.log(`rows=${rows.length} train=${train.length} holdout=${holdout.length}`);
console.log(
  `labels survived=${survivedCount} failed=${rows.length - survivedCount} (${(
    (survivedCount / rows.length) *
    100
  ).toFixed(1)}% survived)`,
);
console.log(`bias=${shippedBias}`);
for (let i = 0; i < D; i += 1) console.log(`  w(${FEATURE_KEYS[i]}) = ${shippedWeights[i]}`);
console.log(
  `holdout AUC=${holdoutAuc.toFixed(4)} accuracy=${holdoutAccuracy.toFixed(4)} logLoss=${holdoutLogLoss.toFixed(4)} brier=${holdoutBrier.toFixed(4)}`,
);
console.log(`wrote ${weightsPath}`);