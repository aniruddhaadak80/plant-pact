import type { DayWeather, MonthNormal, SkyBundle } from "../types";

/**
 * Sealed offline sample.
 *
 * A real Open-Meteo payload for London captured on 2026-10-02, embedded so the
 * app still builds, paints and scores when the upstream weather service is
 * unreachable. It is deliberately NOT presented as current: every response that
 * uses it carries origin="fallback", the capture date, and a note naming the
 * place the sample actually describes.
 *
 * The sample is never written to the database and never overwrites user data.
 */

const CAPTURED_AT = "2026-10-02T08:08:40.884Z";
const SAMPLE_PLACE = "London, United Kingdom";
const SAMPLE_LAT = 51.5074;
const SAMPLE_LON = -0.1278;

const SAMPLE_FORECAST: DayWeather[] = [
  { date: "2026-10-02", minC: 13.1, maxC: 19.9, meanC: 16.5, precipitationProbabilityMax: 4 },
  { date: "2026-10-03", minC: 14.2, maxC: 20.2, meanC: 17.2, precipitationProbabilityMax: 20 },
  { date: "2026-10-04", minC: 13.2, maxC: 20.8, meanC: 17, precipitationProbabilityMax: 2 },
  { date: "2026-10-05", minC: 15, maxC: 21.5, meanC: 18.25, precipitationProbabilityMax: 0 },
  { date: "2026-10-06", minC: 14.4, maxC: 19, meanC: 16.7, precipitationProbabilityMax: 17 },
  { date: "2026-10-07", minC: 11.1, maxC: 14.7, meanC: 12.9, precipitationProbabilityMax: 43 },
  { date: "2026-10-08", minC: 9, maxC: 14.3, meanC: 11.65, precipitationProbabilityMax: 8 },
  { date: "2026-10-09", minC: 8, maxC: 16, meanC: 12, precipitationProbabilityMax: 14 },
  { date: "2026-10-10", minC: 10.6, maxC: 15.6, meanC: 13.1, precipitationProbabilityMax: 14 },
  { date: "2026-10-11", minC: 9, maxC: 14.3, meanC: 11.65, precipitationProbabilityMax: 16 },
  { date: "2026-10-12", minC: 9.5, maxC: 14.6, meanC: 12.05, precipitationProbabilityMax: 24 },
  { date: "2026-10-13", minC: 11.2, maxC: 17.1, meanC: 14.15, precipitationProbabilityMax: 22 },
  { date: "2026-10-14", minC: 13.2, maxC: 18.4, meanC: 15.8, precipitationProbabilityMax: 0 },
  { date: "2026-10-15", minC: 13.1, maxC: 21.1, meanC: 17.1, precipitationProbabilityMax: 0 },
];

const SAMPLE_NORMALS: MonthNormal[] = [
  { month: 1, meanC: 5.25, minC: -5.2, maxC: 11.1, frostDays: 9, hotDays: 0, samples: 31 },
  { month: 2, meanC: 7.98, minC: 1.3, maxC: 16.8, frostDays: 0, hotDays: 0, samples: 28 },
  { month: 3, meanC: 8.89, minC: 1.2, maxC: 17.3, frostDays: 0, hotDays: 0, samples: 31 },
  { month: 4, meanC: 12.09, minC: 3.1, maxC: 25.9, frostDays: 0, hotDays: 0, samples: 30 },
  { month: 5, meanC: 16.37, minC: 4.2, maxC: 34.5, frostDays: 0, hotDays: 6, samples: 31 },
  { month: 6, meanC: 19.38, minC: 9, maxC: 36, frostDays: 0, hotDays: 6, samples: 30 },
  { month: 7, meanC: 22.54, minC: 12.6, maxC: 34.7, frostDays: 0, hotDays: 6, samples: 31 },
  { month: 8, meanC: 21.08, minC: 11.4, maxC: 36.2, frostDays: 0, hotDays: 5, samples: 31 },
  { month: 9, meanC: 15.41, minC: 7.2, maxC: 26.4, frostDays: 0, hotDays: 0, samples: 20 },
  { month: 10, meanC: 12.31, minC: 4.9, maxC: 18.6, frostDays: 0, hotDays: 0, samples: 31 },
  { month: 11, meanC: 9.4, minC: -1.4, maxC: 17.2, frostDays: 3, hotDays: 0, samples: 30 },
  { month: 12, meanC: 7.73, minC: -1.3, maxC: 14.4, frostDays: 2, hotDays: 0, samples: 31 },
];

export const SAMPLE_CAPTURED_AT = CAPTURED_AT;
export const SAMPLE_PLACE_LABEL = SAMPLE_PLACE;

export function fallbackBundle(requestedPlace: string): SkyBundle {
  return {
    origin: "fallback",
    fetchedAt: CAPTURED_AT,
    sourceName: "Sealed offline sample (captured from Open-Meteo)",
    sourceUrl: "https://open-meteo.com/",
    attribution: `Open-Meteo, captured ${CAPTURED_AT} for ${SAMPLE_PLACE}. Sealed sample, not a live forecast.`,
    upstream: {},
    latitude: SAMPLE_LAT,
    longitude: SAMPLE_LON,
    placeLabel: SAMPLE_PLACE,
    forecast: SAMPLE_FORECAST,
    normals: SAMPLE_NORMALS,
    note: `The weather service could not be reached, so this is the sealed sample recorded for ${SAMPLE_PLACE} on ${CAPTURED_AT.slice(0, 10)}. It is not a forecast for ${requestedPlace}, and no projection on this page is a live forecast.`,
  };
}