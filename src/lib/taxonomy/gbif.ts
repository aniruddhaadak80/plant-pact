import type { TaxonomyMatch } from "../types";
import { CATALOGUE, searchCatalogue } from "../species";

/**
 * Live taxonomy ingestion from the GBIF Backbone Taxonomy.
 *
 * A public, keyless endpoint that lets someone type any plant name and get the
 * accepted scientific name, family and nomenclatural status. It is what makes
 * the species list extensible rather than a hardcoded list of 29 rows, and it
 * is a genuinely different upstream from the weather service, so the app is not
 * resting on a single provider.
 */

const ENDPOINT = "https://api.gbif.org/v1/species";
const ALLOWED_HOSTS = new Set(["api.gbif.org"]);
const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;
const CACHE_SECONDS = 60 * 60 * 24;

interface GbifMatch {
  usageKey?: number;
  scientificName?: string;
  canonicalName?: string;
  authName?: string;
  family?: string;
  rank?: string;
  status?: string;
  confidence?: number;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

async function fetchJson(url: URL): Promise<unknown> {
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing to request a non-allowlisted taxonomy origin: ${url.hostname}`);
  }
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Accept: "application/json",
          "User-Agent": "plant-pact/1.0 (+https://github.com/aniruddhaadak80/plant-pact)",
        },
        next: { revalidate: CACHE_SECONDS },
      });
      if (!response.ok) throw new Error(`GBIF responded ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Taxonomy request failed");
}

/**
 * Resolve a plant name against GBIF. Falls back to the bundled catalogue when
 * the upstream is unreachable, and labels that fallback honestly: a catalogue
 * hit is a local reference lookup, not a live taxonomy result.
 */
export async function matchTaxon(query: string): Promise<TaxonomyMatch | null> {
  const trimmed = query.trim().slice(0, 120);
  if (trimmed.length < 2) return null;

  const url = new URL(`${ENDPOINT}/match`);
  url.searchParams.set("name", trimmed);
  url.searchParams.set("strict", "false");

  try {
    const raw = (await fetchJson(url)) as GbifMatch;
    const scientificName = raw.canonicalName ?? raw.scientificName;
    if (!scientificName) throw new Error("GBIF returned no canonical name");

    return {
      origin: "live",
      fetchedAt: new Date().toISOString(),
      sourceName: "GBIF Backbone Taxonomy",
      sourceUrl: "https://www.gbif.org/",
      query: trimmed,
      scientificName: raw.scientificName ?? scientificName,
      canonicalName: scientificName,
      authName: raw.authName ?? null,
      family: raw.family ?? null,
      rank: raw.rank ?? null,
      status: raw.status ?? null,
      usageKey: typeof raw.usageKey === "number" ? raw.usageKey : null,
      confidence: typeof raw.confidence === "number" ? round4(raw.confidence) : null,
    };
  } catch (error) {
    const local = searchCatalogue(trimmed)[0];
    if (!local) return null;
    return {
      origin: "local-catalog",
      fetchedAt: new Date().toISOString(),
      sourceName: "Bundled species catalogue",
      sourceUrl: "https://github.com/aniruddhaadak80/plant-pact/blob/main/src/lib/species.ts",
      query: trimmed,
      scientificName: local.scientificName,
      canonicalName: local.scientificName,
      authName: null,
      family: local.family,
      rank: "SPECIES",
      status: local.gbifStatus,
      usageKey: local.gbifUsageKey,
      confidence: null,
      note: `The GBIF Backbone Taxonomy could not be reached (${error instanceof Error ? error.message : "upstream unavailable"}), so this name was matched against the bundled ${CATALOGUE.length}-species catalogue instead.`,
    };
  }
}