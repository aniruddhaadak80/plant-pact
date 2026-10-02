export const SITE = {
  name: "Plant Pact",
  shortName: "Plant Pact",
  tagline: "See the week a gifted plant dies. Then find out if you were right.",
  description:
    "Plant Pact forecasts how long a houseplant will survive in a specific friend's flat using live Open-Meteo weather, ERA5 climate normals and a trained survival model, then collects the real outcome 90 days later.",
  repositoryUrl: "https://github.com/aniruddhaadak80/plant-pact",
  repositorySlug: "aniruddhaadak80/plant-pact",
  issuesUrl: "https://github.com/aniruddhaadak80/plant-pact/issues",
  newIssueUrl: "https://github.com/aniruddhaadak80/plant-pact/issues/new",
  licenseUrl: "https://github.com/aniruddhaadak80/plant-pact/blob/main/LICENSE",
  apiUrl: "https://github.com/aniruddhaadak80/plant-pact/blob/main/src/app/api",
  license: "MIT",
  author: "aniruddhaadak80",
  defaultCity: {
    label: "London, United Kingdom",
    latitude: 51.5074,
    longitude: -0.1278,
  },
} as const;

export const NAV = [
  { href: "/pacts", label: "The Ledge" },
  { href: "/advisor", label: "Place a plant" },
  { href: "/cards", label: "Care cards" },
  { href: "/agent", label: "Agent" },
  { href: "/method", label: "Method" },
] as const;

export function absoluteUrl(path: string): string {
  const base = siteOrigin();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Canonical origin resolution order:
 *   1. NEXT_PUBLIC_SITE_URL (documented production variable)
 *   2. Vercel production URL injected by the platform
 *   3. http://localhost:3000 for local development
 */
export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod.replace(/\/+$/, "")}`;
  const url = process.env.VERCEL_URL?.trim();
  if (url) return `https://${url.replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export const CITIES = [
  { label: "London, United Kingdom", latitude: 51.5074, longitude: -0.1278 },
  { label: "Bengaluru, India", latitude: 12.9716, longitude: 77.5946 },
  { label: "New York, United States", latitude: 40.7128, longitude: -74.006 },
  { label: "Berlin, Germany", latitude: 52.52, longitude: 13.405 },
  { label: "Toronto, Canada", latitude: 43.6532, longitude: -79.3832 },
  { label: "Singapore", latitude: 1.3521, longitude: 103.8198 },
  { label: "Nairobi, Kenya", latitude: -1.2921, longitude: 36.8219 },
  { label: "São Paulo, Brazil", latitude: -23.5505, longitude: -46.6333 },
  { label: "Sydney, Australia", latitude: -33.8688, longitude: 151.2093 },
  { label: "Reykjavík, Iceland", latitude: 64.1466, longitude: -21.9426 },
  { label: "Ushuaia, Argentina", latitude: -54.8019, longitude: -68.303 },
  { label: "Jaipur, India", latitude: 26.9124, longitude: 75.7873 },
] as const;

export type CityOption = (typeof CITIES)[number];