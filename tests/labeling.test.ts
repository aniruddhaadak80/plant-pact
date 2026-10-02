import { describe, expect, it } from "vitest";
import { HAZARD_THRESHOLD, HAZARD_WEIGHTS, LABELING_VERSION, hazardScore, labelFor } from "@/lib/engine/labeling";
import { extractFeatures, type FeatureInput } from "@/lib/model/features";
import type { DayWeather, MonthNormal } from "@/lib/types";

const traits = {
  minLightHours: 2,
  maxLightHours: 6,
  minTempC: 13,
  maxTempC: 30,
  waterDays: 8,
  waterToleranceDays: 4,
  difficulty: "easy" as const,
};

function forecast(days: [number, number][]): DayWeather[] {
  return days.map(([minC, maxC], i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    minC,
    maxC,
    meanC: (minC + maxC) / 2,
    precipitationProbabilityMax: 10,
  }));
}

function mildNormals(): MonthNormal[] {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    meanC: 18,
    minC: 12,
    maxC: 24,
    frostDays: 0,
    hotDays: 0,
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
      [15, 21],
      [16, 22],
      [15, 20],
    ]),
    normals: mildNormals(),
    ...overrides,
  };
}

describe("the published risk procedure", () => {
  it("declares a version and nine weighted terms", () => {
    expect(LABELING_VERSION).toMatch(/@/);
    expect(Object.keys(HAZARD_WEIGHTS)).toHaveLength(9);
    expect(HAZARD_THRESHOLD).toBeGreaterThan(0);
  });

  it("calls a well-placed, well-cared-for plant a survivor", () => {
    const result = hazardScore(base());
    expect(result.survives).toBe(true);
    expect(labelFor(base())).toBe(1);
    expect(result.total).toBeLessThan(HAZARD_THRESHOLD);
  });

  it("calls a dim, cold, neglected placement a failure", () => {
    const hopeless = base({
      windowHours: 0.5,
      wateringDays: 28,
      careLevel: "forgetful",
      forecast: forecast([
        [-8, 2],
        [-10, 0],
        [-6, 4],
      ]),
      normals: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        meanC: 2,
        minC: -12,
        maxC: 9,
        frostDays: 20,
        hotDays: 0,
        samples: 30,
      })),
    });
    expect(hazardScore(hopeless).survives).toBe(false);
    expect(labelFor(hopeless)).toBe(0);
  });

  it("is deterministic", () => {
    expect(hazardScore(base()).total).toBe(hazardScore(base()).total);
  });

  it("accumulates monotonically as light is removed", () => {
    let previous = -1;
    for (const windowHours of [6, 4, 3, 2, 1, 0.5]) {
      const total = hazardScore(base({ windowHours })).total;
      expect(total).toBeGreaterThanOrEqual(previous);
      previous = total;
    }
    // Once the window falls below the species minimum, hazard strictly increases.
    const belowMinimum = hazardScore(base({ windowHours: 0.5 })).total;
    expect(belowMinimum).toBeGreaterThan(hazardScore(base({ windowHours: 2 })).total);
  });

  it("punishes over-watering on a drought-adapted species more than under-watering", () => {
    const succulent = {
      ...traits,
      waterDays: 25,
      waterToleranceDays: 12,
    };
    const drowned = hazardScore(
      base({ species: succulent, wateringDays: 3 }),
    );
    const parched = hazardScore(
      base({ species: succulent, wateringDays: 45 }),
    );
    expect(drowned.survives).toBe(false);
    // Over-watering is the documented fatal route for this species.
    expect(drowned.total).toBeGreaterThan(parched.total);
  });

  it("returns itemised terms that sum to the reported total", () => {
    const result = hazardScore(base({ windowHours: 1, wateringDays: 20 }));
    const summed = result.terms.reduce((sum, term) => sum + term.contribution, 0);
    expect(summed).toBeCloseTo(result.total, 3);
    expect(result.terms.every((t) => t.contribution >= 0)).toBe(true);
  });

  it("names a dominant failure mode when hazard is non-zero", () => {
    expect(hazardScore(base({ windowHours: 0.5 })).dominant).toBe("light deficit");
    expect(hazardScore(base({ wateringDays: 30 })).dominant).toBe("too dry");
  });

  it("handles an empty forecast and empty normals without producing NaN", () => {
    const result = hazardScore(base({ forecast: [], normals: [] }));
    expect(Number.isFinite(result.total)).toBe(true);
    expect(result.survives).toBe(true);
  });

  it("agrees in direction with the trained model's ordering of the same scenarios", () => {
    const good = base({ windowHours: 6, wateringDays: 8 });
    const bad = base({ windowHours: 0.5, wateringDays: 28, careLevel: "forgetful" });
    expect(labelFor(good)).toBeGreaterThan(labelFor(bad));

    const goodFeatures = extractFeatures(good);
    const badFeatures = extractFeatures(bad);
    const goodRisk = goodFeatures.filter((f) => f.risk).reduce((s, f) => s + f.value, 0);
    const badRisk = badFeatures.filter((f) => f.risk).reduce((s, f) => s + f.value, 0);
    expect(badRisk).toBeGreaterThan(goodRisk);
  });
});