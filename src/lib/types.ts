/**
 * Normalized external + domain types.
 *
 * Every shape that crosses a process boundary (HTTP, database, agent tool)
 * is declared here so the UI, the REST layer and the MCP layer cannot drift.
 */

/* ------------------------------------------------------------------ */
/* Live data: weather (Open-Meteo forecast + ERA5 climate archive)      */
/* ------------------------------------------------------------------ */

export type DataOrigin = "live" | "fallback" | "local-catalog";

export interface DayWeather {
  /** ISO date, YYYY-MM-DD */
  date: string;
  minC: number;
  maxC: number;
  meanC: number;
  precipitationProbabilityMax: number;
}

export interface MonthNormal {
  /** 1-12 */
  month: number;
  meanC: number;
  minC: number;
  maxC: number;
  frostDays: number;
  hotDays: number;
  samples: number;
}

export interface SkyBundle {
  origin: DataOrigin;
  /** When the payload was produced (ISO). For fallbacks this is the sealed sample date. */
  fetchedAt: string;
  sourceName: string;
  sourceUrl: string;
  attribution: string;
  /** Upstream identifiers used for this payload. */
  upstream: { forecastModel?: string; climateModel?: string };
  latitude: number;
  longitude: number;
  placeLabel: string;
  forecast: DayWeather[];
  normals: MonthNormal[];
  /** Set when origin !== "live". */
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Live data: taxonomy (GBIF Backbone Taxonomy)                        */
/* ------------------------------------------------------------------ */

export interface TaxonomyMatch {
  origin: DataOrigin;
  fetchedAt: string;
  sourceName: string;
  sourceUrl: string;
  query: string;
  scientificName: string;
  canonicalName: string;
  authName: string | null;
  family: string | null;
  rank: string | null;
  status: string | null;
  usageKey: number | null;
  confidence: number | null;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Species reference catalogue (seeded rows, FK targets for pacts)     */
/* ------------------------------------------------------------------ */

export type CareLevel = "forgetful" | "weekly" | "diligent";
export type Difficulty = "easy" | "moderate" | "fussy";

export interface SpeciesProfile {
  slug: string;
  commonName: string;
  scientificName: string;
  family: string;
  /** Minimum and maximum comfortable daytime light hours per day. */
  minLightHours: number;
  maxLightHours: number;
  /** Comfortable air temperature band in degrees Celsius. */
  minTempC: number;
  maxTempC: number;
  /** Ideal number of days between waterings at room temperature. */
  waterDays: number;
  /** Tolerance in days either side of waterDays before stress begins. */
  waterToleranceDays: number;
  difficulty: Difficulty;
  /** Conservative pet/child toxicity flag. */
  toxic: boolean;
  note: string;
  careSource: string;
  /** GBIF enrichment, filled in opportunistically. */
  gbifUsageKey: number | null;
  gbifFamily: string | null;
  gbifStatus: string | null;
  taxonomyFetchedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* The model                                                           */
/* ------------------------------------------------------------------ */

export const FEATURE_KEYS = [
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
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface ModelFeature {
  key: FeatureKey;
  label: string;
  /** Observed, normalized value in roughly [-2, 2]. */
  value: number;
  weight: number;
  /** weight * value */
  contribution: number;
  /** Plain-language reading of the observed value. */
  evidence: string;
}

export interface ModelResult {
  modelVersion: string;
  /** Bias + sum(contributions) */
  logit: number;
  /** Logistic(logit), 0-1 */
  probability: number;
  label: "likely" | "uncertain" | "unlikely";
  features: ModelFeature[];
  /** The single largest negative contributor. */
  killer: FeatureKey;
  killerContribution: number;
}

export interface DayProjection {
  date: string;
  minC: number;
  maxC: number;
  /** Probability of surviving to this day, from the same weight vector. */
  survival: number;
  /** Probability of surviving to this day, one day earlier. */
  previousSurvival: number;
  /** Dominant negative factor for this specific day. */
  dayKiller: FeatureKey | null;
}

export interface BreakingPoint {
  /** Date the projection crosses the alert threshold, if it does inside the window. */
  date: string | null;
  /** Day index inside the forecast window where it crosses. */
  dayIndex: number | null;
  /** Linear projection beyond the window, when the window never crosses. */
  projectedDate: string | null;
  probabilityAtProjection: number;
}

export interface EngineVerdict {
  engineVersion: string;
  modelVersion: string;
  model: ModelResult;
  path: DayProjection[];
  breakingPoint: BreakingPoint;
  killerLabel: string;
  killerNote: string;
  recommendation: string;
  recommendationDetail: string;
  alerts: string[];
  horizonDays: number;
  confidence: "high" | "medium" | "low";
}

/* ------------------------------------------------------------------ */
/* The core entity: a Pact                                             */
/* ------------------------------------------------------------------ */

export type PactStatus = "committed" | "fulfilled" | "called";
export type PactOutcome = "survived" | "struggled" | "died" | "pending";
export type WindowAspect = "north" | "east" | "south" | "west" | "unknown";

export interface Pact {
  id: string;
  speciesSlug: string;
  plantLabel: string;
  friendName: string;
  placeLabel: string;
  latitude: number;
  longitude: number;
  windowLabel: string;
  windowAspect: WindowAspect;
  windowHours: number;
  wateringDays: number;
  careLevel: CareLevel;
  petsPresent: boolean;
  commitmentDays: number;
  probability: number;
  killer: FeatureKey;
  killerNote: string;
  projectedFailDate: string | null;
  status: PactStatus;
  outcome: PactOutcome;
  outcomeDay: number | null;
  outcomeNote: string | null;
  dueDate: string;
  seal: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  species: SpeciesProfile | null;
  /** Populated on detail reads. */
  sky?: SkyBundle | null;
  verdict?: EngineVerdict | null;
}

/** Same as Pact but without the optional hydration. */
export type PactRow = Pact & { species: SpeciesProfile | null };

/* ------------------------------------------------------------------ */
/* Audit / integrity                                                   */
/* ------------------------------------------------------------------ */

export type AuditEventType = "created" | "updated" | "outcome_recorded" | "deleted";

export interface AuditEvent {
  entityId: string;
  seq: number;
  eventType: AuditEventType;
  payload: Record<string, unknown>;
  prevSeal: string;
  seal: string;
  createdAt: string;
}

export interface ReplayReport {
  entityId: string;
  events: number;
  ok: boolean;
  /** Sequence number of the first event whose seal does not verify. */
  brokenAtSeq: number | null;
  reason: string | null;
  headSeal: string | null;
  verifiedAt: string;
}

export interface VerifiedPact extends PactRow {
  replay: ReplayReport | null;
}

/* ------------------------------------------------------------------ */
/* API envelopes                                                       */
/* ------------------------------------------------------------------ */

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ApiMeta {
  store: string;
  sessionScoped: boolean;
}