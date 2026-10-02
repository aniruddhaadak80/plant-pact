import { describe, expect, it } from "vitest";
import {
  clamp,
  extractFeatures,
  featuresToVector,
  rawTerms,
  sillTemperature,
  SILL_MODEL,
  type FeatureInput,
} from "@/lib/model/features";
import type { CareLevel, DayWeather, MonthNormal } from "@/lib/types";

const traits = {
  minLightHours: 2,
  maxLightHours: 6,
  minTempC: 13,
  maxTempC: 30,
  waterDays: 8,
  waterToleranceDays: 4,
  difficulty: "easy" as const,
};

function day(date: string, minC: number, maxC: number, pp = 10): DayWeather {
  return {
    date,
    minC,
    maxC,
    meanC: (minC + maxC) / 2,
    precipitationProbabilityMax: pp,
  };
}

function forecast(specs: [number, number][]): DayWeather[] {
  return specs.map(([minC, maxC], i) => day(`2026-01-${String(i + 1).padStart(2, "0")}`, minC, maxC));
}

function normals(specs: [number, number, number][]): MonthNormal[] {
  return specs.map(([minC, maxC, meanC], i) => ({
    month: i + 1,
    meanC,
    minC,
    maxC,
    frostDays: minC <= 0 ? 1 : 0,
    hotDays: maxC >= 30 ? 1 : 0,
    samples: 30,
  }));
}

function base(overrides: Partial<FeatureInput> = {}): FeatureInput {
  return {
    species: traits,
    windowHours: 4,
    wateringDays: 8,
    careLevel: "weekly",
    forecast: forecast([
      [12, 18],
      [13, 19],
      [11, 17],
      [14, 20],
    ]),
    normals: normals([
      [3, 12, 7],
      [4, 13, 8],
      [6, 18, 12],
      [8, 24, 16],
    ]),
    ...overrides,
  };
}

describe("clamp", () => {
  it("bounds values and survives non-finite input", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
    expect(clamp(Number.NaN, 0.2, 0.9)).toBe(0.2);
    expect(clamp(Number.POSITIVE_INFINITY, 0, 1)).toBe(1);
  });
});

describe("sill thermal model", () => {
  it("damps outdoor extremes toward the neutral indoor temperature", () => {
    expect(sillTemperature(SILL_MODEL.neutralC, "cold")).toBeCloseTo(SILL_MODEL.neutralC, 6);
    expect(sillTemperature(0, "cold")).toBeCloseTo(
      SILL_MODEL.neutralC + (0 - SILL_MODEL.neutralC) * SILL_MODEL.coldDamping,
      6,
    );
  });

  it("passes heat through more than cold, because a sunlit sill behind glass genuinely heats up", () => {
    const coldDrop = SILL_MODEL.neutralC - sillTemperature(0, "cold");
    const heatRise = sillTemperature(40, "heat") - SILL_MODEL.neutralC;
    expect(heatRise).toBeGreaterThan(coldDrop);
  });

  it("never reaches the outdoor extreme", () => {
    for (const side of ["cold", "heat"] as const) {
      expect(sillTemperature(-40, side)).toBeGreaterThan(-40);
      expect(sillTemperature(55, side)).toBeLessThan(55);
    }
  });
});

describe("extractFeatures", () => {
  it("returns exactly the ten declared features in a stable order", () => {
    const features = extractFeatures(base());
    expect(features).toHaveLength(10);
    expect(features.map((f) => f.key)).toEqual([
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
    ]);
  });

  it("produces a non-empty, numbers-first evidence string for every feature", () => {
    for (const feature of extractFeatures(base())) {
      expect(feature.evidence.length).toBeGreaterThan(12);
      expect(feature.evidence).toMatch(/\d/);
      expect(feature.risk === false || feature.value >= 0).toBe(true);
    }
  });

  it("is deterministic: identical input gives an identical vector", () => {
    expect(featuresToVector(extractFeatures(base()))).toEqual(
      featuresToVector(extractFeatures(base())),
    );
  });

  it("flags a light deficit below the species minimum and none inside the band", () => {
    const low = extractFeatures(base({ windowHours: 1 }));
    expect(low.find((f) => f.key === "lightDeficit")!.value).toBeGreaterThan(0);

    const inBand = extractFeatures(base({ windowHours: 4 }));
    expect(inBand.find((f) => f.key === "lightDeficit")!.value).toBe(0);
    expect(inBand.find((f) => f.key === "lightHeadroom")!.value).toBeCloseTo(0.5, 2);
  });

  it("flags overshoot past the ceiling", () => {
    const bright = extractFeatures(base({ windowHours: 12 }));
    expect(bright.find((f) => f.key === "lightOvershoot")!.value).toBeGreaterThan(0);
  });

  it("treats watering inside the tolerance band as free of risk", () => {
    const inside = extractFeatures(base({ wateringDays: 9 }));
    expect(inside.find((f) => f.key === "waterDry")!.value).toBe(0);
    expect(inside.find((f) => f.key === "waterWet")!.value).toBe(0);

    // One day beyond the stated tolerance does start to cost something.
    const outside = extractFeatures(base({ wateringDays: 13 }));
    expect(outside.find((f) => f.key === "waterDry")!.value).toBeGreaterThan(0);
  });

  it("penalises over-watering harder for a drought-adapted species", () => {
    const succulent = base({
      species: { ...traits, waterDays: 25, waterToleranceDays: 12, difficulty: "easy" },
      wateringDays: 5,
    });
    const thirsty = base({
      species: { ...traits, waterDays: 3, waterToleranceDays: 2, difficulty: "easy" },
      wateringDays: 1,
    });
    const succulentWet = succulent
      .forecast.length;
    expect(succulentWet).toBeGreaterThan(0);
    expect(
      extractFeatures(succulent).find((f) => f.key === "waterWet")!.value,
    ).toBeGreaterThan(extractFeatures(thirsty).find((f) => f.key === "waterWet")!.value);
  });

  it("handles an empty forecast without producing NaN", () => {
    const features = extractFeatures(base({ forecast: [] }));
    for (const feature of features) {
      expect(Number.isFinite(feature.value)).toBe(true);
    }
  });

  it("handles a missing climate normal set without producing NaN", () => {
    const features = extractFeatures(base({ normals: [] }));
    expect(features.find((f) => f.key === "climateStrain")!.value).toBe(0);
  });

  it("survives malformed weather values rather than propagating them", () => {
    const malformed = base({
      forecast: [
        { date: "2026-01-01", minC: Number.NaN, maxC: 20, meanC: Number.NaN, precipitationProbabilityMax: Number.NaN },
        { date: "2026-01-02", minC: 12, maxC: 18, meanC: 15, precipitationProbabilityMax: 10 },
      ],
    });
    for (const feature of extractFeatures(malformed)) {
      expect(Number.isFinite(feature.value)).toBe(true);
    }
  });

  it("re-evaluates the weather features on the forecast prefix", () => {
    const input = base({
      forecast: forecast([
        [2, 10],
        [3, 11],
        [1, 9],
        [16, 22],
      ]),
    });
    const first = extractFeatures(input, 0).find((f) => f.key === "coldShare")!.value;
    const all = extractFeatures(input, input.forecast.length - 1).find(
      (f) => f.key === "coldShare",
    )!.value;
    const full = extractFeatures(input).find((f) => f.key === "coldShare")!.value;
    expect(full).toBe(all);
    expect(first).toBeGreaterThan(0);
    expect(all).toBeGreaterThan(first);
  });

  it("exposes raw sub-terms for the labelling procedure", () => {
    const terms = rawTerms(base());
    expect(terms.light.deficit).toBeGreaterThanOrEqual(0);
    expect(terms.windowLength).toBe(4);
  });
});

describe("care level mapping", () => {
  it("produces a shortfall only when the species outranks the caretaker", () => {
    const levels: CareLevel[] = ["forgetful", "weekly", "diligent"];
    const fussy = { ...traits, difficulty: "fussy" as const };
    const shortfalls = levels.map((careLevel) =>
      extractFeatures(base({ species: fussy, careLevel })).find(
        (f) => f.key === "careShortfall",
      )!.value,
    );
    expect(shortfalls[0]).toBeCloseTo(1, 5);
    expect(shortfalls[1]).toBeCloseTo(0.5, 5);
    expect(shortfalls[2]).toBe(0);
  });
});