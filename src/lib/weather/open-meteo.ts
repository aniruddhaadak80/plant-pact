import type { DayWeather, MonthNormal, SkyBundle } from "../types";
import { fallbackBundle } from "./fallback";

/**
 * Live weather ingestion.
 *
 * Two public, keyless Open-Meteo endpoints:
 *   - api.open-meteo.com       -> 14-day daily forecast, cached 15 minutes
 *   - archive-api.open-meteo.com -> ERA5 reanalysis normals for the trailing
 *     365 days, aggregated to 12 monthly normals and cached 30 days because a
 *     closed past year does not change.
 *
 * Every request is time-bounded, retried at most twice, and allowlisted to
 * these two hosts. If either fails the caller receives the sealed offline
 * sample with origin="fallback" rather than an exception, so the app never
 * paints a broken first screen and never silently presents stale numbers as
 * live.
 */

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_ENDPOINT = "https://archive-api.open-meteo.com/v1/archive";
const ALLOWED_HOSTS = new Set(["api.open-meteo.com", "archive-api.open-meteo.com"]);

const FORECAST_REVALIDATE_SECONDS = 900;
const ARCHIVE_REVALIDATE_SECONDS = 60 * 60 * 24 * 30;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;

export const FORECAST_DAYS = 14;

export interface SkyRequest {
  latitude: number;
  longitude: number;
  placeLabel: string;
}

function assertAllowed(url: URL): void {
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing to request a non-allowlisted weather origin: ${url.hostname}`);
  }
}

async function fetchJson(url: URL, revalidate: number): Promise<unknown> {
  assertAllowed(url);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Accept: "application/json",
          "User-Agent": "plant-pact/1.0 (+https://github.com/aniruddhaadak80/plant-pact)",
        },
        next: { revalidate },
      });
      if (!response.ok) throw new Error(`Open-Meteo responded ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Weather request failed");
}

interface ForecastPayload {
  daily?: {
    time?: string[];
    temperature_2m_min?: number[];
    temperature_2m_max?: number[];
    precipitation_probability_max?: (number | null)[];
  };
}

interface ArchivePayload {
  daily?: {
    time?: string[];
    temperature_2m_mean?: number[];
    temperature_2m_min?: number[];
    temperature_2m_max?: number[];
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function normaliseForecast(payload: ForecastPayload): DayWeather[] {
  const daily = payload.daily;
  if (!daily?.time || !daily.temperature_2m_min || !daily.temperature_2m_max) {
    throw new Error("Forecast payload missing daily temperature fields");
  }
  const out: DayWeather[] = [];
  for (let i = 0; i < daily.time.length; i += 1) {
    const minC = daily.temperature_2m_min[i];
    const maxC = daily.temperature_2m_max[i];
    if (!Number.isFinite(minC) || !Number.isFinite(maxC)) continue;
    const probability = daily.precipitation_probability_max?.[i];
    out.push({
      date: daily.time[i],
      minC: round1(minC),
      maxC: round1(maxC),
      meanC: round1((minC + maxC) / 2),
      precipitationProbabilityMax: Number.isFinite(probability ?? NaN) ? (probability as number) : 0,
    });
  }
  if (out.length === 0) throw new Error("Forecast payload contained no usable days");
  return out.slice(0, FORECAST_DAYS);
}

function normaliseNormals(payload: ArchivePayload): MonthNormal[] {
  const daily = payload.daily;
  if (!daily?.time || !daily.temperature_2m_mean || !daily.temperature_2m_min || !daily.temperature_2m_max) {
    throw new Error("Archive payload missing daily temperature fields");
  }
  const buckets = new Map<number, { means: number[]; mins: number[]; maxs: number[] }>();
  for (let i = 0; i < daily.time.length; i += 1) {
    const month = Number(daily.time[i].slice(5, 7));
    const mean = daily.temperature_2m_mean[i];
    const min = daily.temperature_2m_min[i];
    const max = daily.temperature_2m_max[i];
    if (!Number.isFinite(mean) || !Number.isFinite(min) || !Number.isFinite(max)) continue;
    const bucket = buckets.get(month) ?? { means: [], mins: [], maxs: [] };
    bucket.means.push(mean);
    bucket.mins.push(min);
    bucket.maxs.push(max);
    buckets.set(month, bucket);
  }
  const mean = (xs: number[]): number => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  return [...buckets.entries()]
    .map(([month, b]) => ({
      month,
      meanC: round1(mean(b.means)),
      minC: round1(Math.min(...b.mins)),
      maxC: round1(Math.max(...b.maxs)),
      frostDays: b.mins.filter((x) => x <= 0).length,
      hotDays: b.maxs.filter((x) => x >= 30).length,
      samples: b.mins.length,
    }))
    .sort((a, b) => a.month - b.month);
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Fetch live weather for a coordinate pair. Never throws: on total upstream
 * failure it returns the sealed offline sample, clearly labelled.
 *
 * PLANT_PACT_OFFLINE=1 short-circuits to the sealed sample without touching the
 * network. It exists so unit tests and local smoke runs are deterministic and
 * offline, and so a build never depends on an external feed being reachable.
 */
export async function fetchSky(request: SkyRequest): Promise<SkyBundle> {
  const { latitude, longitude, placeLabel } = request;

  if (process.env.PLANT_PACT_OFFLINE === "1") {
    const bundle = fallbackBundle(placeLabel);
    return {
      ...bundle,
      note: `${bundle.note} Reason: PLANT_PACT_OFFLINE=1 forces the sealed sample.`,
    };
  }

  const forecastUrl = new URL(FORECAST_ENDPOINT);
  forecastUrl.searchParams.set("latitude", latitude.toFixed(4));
  forecastUrl.searchParams.set("longitude", longitude.toFixed(4));
  forecastUrl.searchParams.set(
    "daily",
    "temperature_2m_min,temperature_2m_max,precipitation_probability_max",
  );
  forecastUrl.searchParams.set("forecast_days", String(FORECAST_DAYS));
  forecastUrl.searchParams.set("timezone", "UTC");

  const archiveUrl = new URL(ARCHIVE_ENDPOINT);
  archiveUrl.searchParams.set("latitude", latitude.toFixed(4));
  archiveUrl.searchParams.set("longitude", longitude.toFixed(4));
  archiveUrl.searchParams.set("start_date", isoDay(-374));
  archiveUrl.searchParams.set("end_date", isoDay(-10));
  archiveUrl.searchParams.set(
    "daily",
    "temperature_2m_mean,temperature_2m_min,temperature_2m_max",
  );
  archiveUrl.searchParams.set("timezone", "UTC");

  try {
    const [forecastRaw, archiveRaw] = (await Promise.all([
      fetchJson(forecastUrl, FORECAST_REVALIDATE_SECONDS),
      fetchJson(archiveUrl, ARCHIVE_REVALIDATE_SECONDS),
    ])) as [ForecastPayload, ArchivePayload];

    const forecast = normaliseForecast(forecastRaw);
    const normals = normaliseNormals(archiveRaw);

    return {
      origin: "live",
      fetchedAt: new Date().toISOString(),
      sourceName: "Open-Meteo forecast + ERA5 reanalysis",
      sourceUrl: "https://open-meteo.com/",
      attribution:
        "Weather data by Open-Meteo.com (CC BY 4.0). Climate normals from the Open-Meteo archive API (ERA5 reanalysis).",
      upstream: {
        forecastModel: "open-meteo best_match",
        climateModel: "ERA5 reanalysis",
      },
      latitude,
      longitude,
      placeLabel,
      forecast,
      normals,
    };
  } catch (error) {
    const bundle = fallbackBundle(placeLabel);
    return {
      ...bundle,
      note: `${bundle.note} Reason: ${error instanceof Error ? error.message : "upstream unavailable"}.`,
    };
  }
}