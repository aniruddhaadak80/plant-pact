import { describe, expect, it } from "vitest";
import { extractFeatures, type FeatureInput } from "@/lib/model/features";
import { infer, sigmoid, MODEL_CARD } from "@/lib/model/infer";
import { WEIGHTS } from "@/lib/model/weights";
import { evaluate, ALERT_THRESHOLD, ENGINE_VERSION } from "@/lib/engine/verdict";
import type { CareLevel, DayWeather, MonthNormal, SkyBundle } from "@/lib/types";

const POTHOS = {
  slug: "golden-pothos",
  commonName: "Golden pothos",
  scientificName: "Epipremnum aureum",
  family: "Araceae",
  minLightHours: 2,
  maxLightHours: 6,
  minTempC: 13,
  maxTempC: 30,
  waterDays: 8,
  waterToleranceDays: 4,
  difficulty: "easy" as const,
  toxic: true,
  note: "",
  careSource: "",
  gbifUsageKey: 2868323,
  gbifFamily: "Araceae",
  gbifStatus: "ACCEPTED",
  taxonomyFetchedAt: null,
};

const FICUS = {
  ...POTHOS,
  slug: "fiddle-leaf-fig",
  commonName: "Fiddle-leaf fig",
  scientificName: "Ficus lyrata",
  family: "Moraceae",
  minLightHours: 5,
  maxLightHours: 8,
  minTempC: 16,
  maxTempC: 27,
  waterDays: 10,
  waterToleranceDays: 3,
  difficulty: "fussy" as const,
};

function sky(minC: number, maxC: number, days = 14): SkyBundle {
  const forecast: DayWeather[] = [];
  for (let i = 0; i < days; i += 1) {
    forecast.push({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      minC,
      maxC,
      meanC: (minC + maxC) / 2,
      precipitationProbabilityMax: 10,
    });
  }
  const normals: MonthNormal[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    meanC: (minC + maxC) / 2,
    minC,
    maxC,
    frostDays: 0,
    hotDays: 0,
    samples: 30,
  }));
  return {
    origin: "live",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    sourceName: "test",
    sourceUrl: "https://open-meteo.com/",
    attribution: "test",
    upstream: {},
    latitude: 51.5,
    longitude: -0.12,
    placeLabel: "Testville",
    forecast,
    normals,
  };
}

function input(overrides: Partial<FeatureInput> = {}): FeatureInput {
  return {
    species: POTHOS,
    windowHours: 4,
    wateringDays: 8,
    careLevel: "weekly",
    forecast: sky(12, 18).forecast,
    normals: sky(12, 18).normals,
    ...overrides,
  };
}

describe("sigmoid", () => {
  it("is bounded and symmetric", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 12);
    expect(sigmoid(-40)).toBeCloseTo(0, 12);
    expect(sigmoid(40)).toBeCloseTo(1, 12);
    expect(sigmoid(2.5) + sigmoid(-2.5)).toBeCloseTo(1, 12);
  });
});

describe("model weights", () => {
  it("gives every risk feature a non-positive weight and light headroom a positive one", () => {
    for (const [key, weight] of Object.entries(WEIGHTS.features)) {
      if (key === "lightHeadroom") expect(weight).toBeGreaterThan(0);
      else expect(weight).toBeLessThanOrEqual(0);
    }
  });

  it("publishes a model card with held-out metrics that are actually good", () => {
    expect(MODEL_CARD.metrics.holdoutAuc).toBeGreaterThan(0.9);
    expect(MODEL_CARD.corpus.rows).toBeGreaterThan(1000);
    expect(MODEL_CARD.features.length).toBe(10);
    expect(MODEL_CARD.metrics.baseSurvivalRate).toBeGreaterThan(0.05);
    expect(MODEL_CARD.metrics.baseSurvivalRate).toBeLessThan(0.95);
  });
});

describe("infer", () => {
  it("is deterministic for identical features", () => {
    const features = extractFeatures(input());
    expect(infer(features)).toEqual(infer(features));
  });

  it("makes contributions sum exactly to the reported logit", () => {
    const result = infer(extractFeatures(input()));
    const summed = result.features.reduce((sum, f) => sum + f.contribution, 0);
    expect(WEIGHTS.bias + summed).toBeCloseTo(result.logit, 4);
    expect(sigmoid(result.logit)).toBeCloseTo(result.probability, 3);
  });

  it("reports the largest negative contributor as the killer", () => {
    const result = infer(extractFeatures(input({ windowHours: 0.5, wateringDays: 28 })));
    const worst = result.features.reduce((a, b) => (b.contribution < a.contribution ? b : a));
    expect(result.killer).toBe(worst.key);
    expect(result.killerContribution).toBeCloseTo(worst.contribution, 4);
  });

  it("raises survival when a light deficit is removed", () => {
    const dim = infer(extractFeatures(input({ windowHours: 0.5 })));
    const bright = infer(extractFeatures(input({ windowHours: 6 })));
    expect(bright.probability).toBeGreaterThan(dim.probability);
  });

  it("raises survival when over-watering is corrected", () => {
    const drowned = infer(extractFeatures(input({ wateringDays: 1 })));
    const correct = infer(extractFeatures(input({ wateringDays: 8 })));
    expect(correct.probability).toBeGreaterThan(drowned.probability);
  });

  it("rates a fussy species below an easy one in the same window", () => {
    const easy = infer(extractFeatures(input({ species: POTHOS })));
    const fussy = infer(extractFeatures(input({ species: FICUS })));
    expect(fussy.probability).toBeLessThan(easy.probability);
  });

  it("keeps the probability inside (0, 1) for absurd inputs", () => {
    for (const windowHours of [0, 14, 24]) {
      for (const wateringDays of [0.5, 30, 90]) {
        const result = infer(
          extractFeatures(input({ windowHours, wateringDays, careLevel: "forgetful" })),
        );
        expect(result.probability).toBeGreaterThanOrEqual(0);
        expect(result.probability).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("evaluate", () => {
  const verdict = evaluate({
    species: FICUS,
    windowHours: 2,
    wateringDays: 21,
    careLevel: "forgetful",
    sky: sky(-6, 4),
    horizonDays: 90,
  });

  it("stamps the engine and model versions", () => {
    expect(verdict.engineVersion).toBe(ENGINE_VERSION);
    expect(verdict.modelVersion).toBe(MODEL_CARD.version);
  });

  it("ends the projection path at exactly the headline probability", () => {
    const last = verdict.path[verdict.path.length - 1];
    expect(last.survival).toBeCloseTo(verdict.model.probability, 4);
  });

  it("walks the path in date order and chains previousSurvival", () => {
    for (let i = 1; i < verdict.path.length; i += 1) {
      expect(verdict.path[i].previousSurvival).toBeCloseTo(verdict.path[i - 1].survival, 4);
      expect(verdict.path[i].date > verdict.path[i - 1].date).toBe(true);
    }
  });

  it("finds the alert crossing for a hopeless placement", () => {
    expect(verdict.model.probability).toBeLessThan(ALERT_THRESHOLD);
    expect(verdict.breakingPoint.date).not.toBeNull();
    expect(verdict.breakingPoint.dayIndex).not.toBeNull();
    const crossing = verdict.breakingPoint.dayIndex as number;
    expect(verdict.path[crossing].survival).toBeLessThan(ALERT_THRESHOLD);
  });

  it("produces an actionable recommendation and never recommends the top risk as good news", () => {
    expect(verdict.recommendation.length).toBeGreaterThan(20);
    expect(verdict.recommendationDetail.length).toBeGreaterThan(20);
    if (verdict.model.probability < 0.35) {
      expect(verdict.recommendation.startsWith("Do not gift")).toBe(true);
    }
  });

  it("warns about toxicity for a toxic species", () => {
    expect(verdict.alerts.some((a) => a.toLowerCase().includes("toxic"))).toBe(true);
  });

  it("flags a sealed fallback sky as low confidence and warns about it", () => {
    const sealed = evaluate({
      species: POTHOS,
      windowHours: 4,
      wateringDays: 8,
      careLevel: "weekly",
      sky: { ...sky(12, 18), origin: "fallback" },
      horizonDays: 90,
    });
    expect(sealed.confidence).toBe("low");
    expect(sealed.alerts.some((a) => a.includes("sealed offline sample"))).toBe(true);
  });

  it("does not invent a failing week for an easy plant in a mild window", () => {
    const easy = evaluate({
      species: POTHOS,
      windowHours: 5,
      wateringDays: 8,
      careLevel: "diligent",
      sky: sky(16, 22),
      horizonDays: 90,
    });
    expect(easy.model.probability).toBeGreaterThan(0.5);
    expect(easy.breakingPoint.date).toBeNull();
  });

  it("survives an empty forecast with a defined answer", () => {
    const empty = evaluate({
      species: POTHOS,
      windowHours: 4,
      wateringDays: 8,
      careLevel: "weekly",
      sky: { ...sky(12, 18), forecast: [] },
      horizonDays: 90,
    });
    expect(empty.path).toHaveLength(0);
    expect(Number.isFinite(empty.model.probability)).toBe(true);
    expect(empty.breakingPoint.date).toBeNull();
  });

  it("is deterministic across repeated calls", () => {
    const again = evaluate({
      species: FICUS,
      windowHours: 2,
      wateringDays: 21,
      careLevel: "forgetful",
      sky: sky(-6, 4),
      horizonDays: 90,
    });
    expect(again.model.probability).toBe(verdict.model.probability);
    expect(again.breakingPoint).toEqual(verdict.breakingPoint);
  });
});

describe("care levels move the answer in the documented direction", () => {
  it("ranks diligent above weekly above forgetful for a fussy species", () => {
    const levels: CareLevel[] = ["forgetful", "weekly", "diligent"];
    const scores = levels.map(
      (careLevel) =>
        infer(extractFeatures(input({ species: FICUS, careLevel, windowHours: 6 }))).probability,
    );
    expect(scores[0]).toBeLessThan(scores[1]);
    expect(scores[1]).toBeLessThan(scores[2]);
  });
});