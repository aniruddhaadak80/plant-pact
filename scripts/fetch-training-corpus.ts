/**
 * Fetches the training corpus: real Open-Meteo forecasts and real ERA5 climate
 * normals for 24 cities spanning subarctic to tropical, humid to arid.
 *
 * The corpus is checked in as training/cities.json so that retraining is
 * reproducible offline. Re-run with:  node scripts/fetch-training-corpus.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DayWeather, MonthNormal } from "../src/lib/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "training", "cities.json");

const CITIES = [
  { label: "Reykjavik, Iceland", latitude: 64.1466, longitude: -21.9426 },
  { label: "Tromso, Norway", latitude: 69.6496, longitude: 18.956 },
  { label: "London, United Kingdom", latitude: 51.5074, longitude: -0.1278 },
  { label: "Berlin, Germany", latitude: 52.52, longitude: 13.405 },
  { label: "Warsaw, Poland", latitude: 52.2297, longitude: 21.0122 },
  { label: "Toronto, Canada", latitude: 43.6532, longitude: -79.3832 },
  { label: "Chicago, United States", latitude: 41.8781, longitude: -87.6298 },
  { label: "New York, United States", latitude: 40.7128, longitude: -74.006 },
  { label: "Mexico City, Mexico", latitude: 19.4326, longitude: -99.1332 },
  { label: "Bogota, Colombia", latitude: 4.711, longitude: -74.0721 },
  { label: "Sao Paulo, Brazil", latitude: -23.5505, longitude: -46.6333 },
  { label: "Ushuaia, Argentina", latitude: -54.8019, longitude: -68.303 },
  { label: "Lagos, Nigeria", latitude: 6.5244, longitude: 3.3792 },
  { label: "Nairobi, Kenya", latitude: -1.2921, longitude: 36.8219 },
  { label: "Cairo, Egypt", latitude: 30.0444, longitude: 31.2357 },
  { label: "Dubai, United Arab Emirates", latitude: 25.2048, longitude: 55.2708 },
  { label: "Kathmandu, Nepal", latitude: 27.7172, longitude: 85.324 },
  { label: "Jaipur, India", latitude: 26.9124, longitude: 75.7873 },
  { label: "Bengaluru, India", latitude: 12.9716, longitude: 77.5946 },
  { label: "Singapore", latitude: 1.3521, longitude: 103.8198 },
  { label: "Bangkok, Thailand", latitude: 13.7563, longitude: 100.5018 },
  { label: "Tokyo, Japan", latitude: 35.6762, longitude: 139.6503 },
  { label: "Sydney, Australia", latitude: -33.8688, longitude: 151.2093 },
  { label: "Christchurch, New Zealand", latitude: -43.5321, longitude: 172.6362 },
];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function getJson(url: string, attempt = 0): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "plant-pact-training/1.0 (open-source model corpus build)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } catch (err) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return getJson(url, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

interface ForecastPayload {
  daily: {
    time: string[];
    temperature_2m_min: number[];
    temperature_2m_max: number[];
    precipitation_probability_max: (number | null)[];
  };
}

interface ArchivePayload {
  daily: {
    time: string[];
    temperature_2m_mean: number[];
    temperature_2m_min: number[];
    temperature_2m_max: number[];
  };
}

function isoDay(offsetDays: number): string {
  const d = new Date(Date.UTC(2026, 8, 20) + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function fetchCity(city: { label: string; latitude: number; longitude: number }) {
  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}` +
    `&daily=temperature_2m_min,temperature_2m_max,precipitation_probability_max&forecast_days=14&timezone=UTC`;
  const archiveUrl =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${city.latitude}&longitude=${city.longitude}` +
    `&start_date=${isoDay(-364)}&end_date=${isoDay(-10)}&daily=temperature_2m_mean,temperature_2m_min,temperature_2m_max&timezone=UTC`;

  const [f, a] = (await Promise.all([getJson(forecastUrl), getJson(archiveUrl)])) as [
    ForecastPayload,
    ArchivePayload,
  ];

  const forecast: DayWeather[] = f.daily.time.map((date, i) => {
    const minC = f.daily.temperature_2m_min[i];
    const maxC = f.daily.temperature_2m_max[i];
    const pp = f.daily.precipitation_probability_max[i];
    return {
      date,
      minC,
      maxC,
      meanC: Math.round(((minC + maxC) / 2) * 100) / 100,
      precipitationProbabilityMax: pp === null ? 0 : pp,
    };
  });

  const buckets = new Map<number, { means: number[]; mins: number[]; maxs: number[] }>();
  a.daily.time.forEach((date, i) => {
    const month = Number(date.slice(5, 7));
    const bucket = buckets.get(month) ?? { means: [], mins: [], maxs: [] };
    bucket.means.push(a.daily.temperature_2m_mean[i]);
    bucket.mins.push(a.daily.temperature_2m_min[i]);
    bucket.maxs.push(a.daily.temperature_2m_max[i]);
    buckets.set(month, bucket);
  });

  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const normals: MonthNormal[] = [...buckets.entries()]
    .map(([month, b]) => ({
      month,
      meanC: Math.round(mean(b.means) * 100) / 100,
      minC: Math.round(Math.min(...b.mins) * 100) / 100,
      maxC: Math.round(Math.max(...b.maxs) * 100) / 100,
      frostDays: b.mins.filter((x) => x <= 0).length,
      hotDays: b.maxs.filter((x) => x >= 30).length,
      samples: b.mins.length,
    }))
    .sort((x, y) => x.month - y.month);

  const covered = normals.map((n) => MONTH_NAMES[n.month - 1]).join(", ");
  console.log(
    `${city.label.padEnd(32)} ${forecast.length}d forecast, ${normals.length} normals (${covered})`,
  );

  return { ...city, forecast, normals };
}

async function main(): Promise<void> {
  console.log(`Fetching ${CITIES.length} cities from Open-Meteo...`);
  const results = [];
  for (const city of CITIES) {
    results.push(await fetchCity(city));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    description:
      "Real Open-Meteo 14-day forecasts plus ERA5 reanalysis normals for 24 cities, used to fit the Plant Pact survival model. Regenerate with scripts/fetch-training-corpus.ts.",
    forecastSource: {
      name: "Open-Meteo Forecast API",
      url: "https://open-meteo.com/",
      endpoint: "https://api.open-meteo.com/v1/forecast",
    },
    archiveSource: {
      name: "Open-Meteo Archive API (ERA5 reanalysis)",
      url: "https://open-meteo.com/en/docs/historical-weather-api",
      endpoint: "https://archive-api.open-meteo.com/v1/archive",
      window: { start: isoDay(-364), end: isoDay(-10) },
    },
    cities: results,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});