import type { AuditEvent, PactRow, SpeciesProfile } from "../types";

/** Minimal query surface satisfied by both node-postgres Pool and PGlite. */
export interface SqlClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export type StoreKind = "postgres" | "pglite";

export interface NewPactRecord {
  id: string;
  sessionId: string;
  idempotencyKey: string | null;
  speciesSlug: string;
  plantLabel: string;
  friendName: string;
  placeLabel: string;
  latitude: number;
  longitude: number;
  windowLabel: string;
  windowAspect: PactRow["windowAspect"];
  windowHours: number;
  wateringDays: number;
  careLevel: PactRow["careLevel"];
  petsPresent: boolean;
  commitmentDays: number;
  probability: number;
  killer: string;
  killerNote: string;
  projectedFailDate: string | null;
  dueDate: string;
  seal: string;
}

export type PactPatch = Partial<
  Pick<
    PactRow,
    | "plantLabel"
    | "friendName"
    | "placeLabel"
    | "latitude"
    | "longitude"
    | "windowLabel"
    | "windowAspect"
    | "windowHours"
    | "wateringDays"
    | "careLevel"
    | "petsPresent"
    | "commitmentDays"
    | "probability"
    | "killer"
    | "killerNote"
    | "projectedFailDate"
    | "status"
    | "outcome"
    | "outcomeDay"
    | "outcomeNote"
    | "dueDate"
    | "seal"
  >
>;

export interface PactQuery {
  limit: number;
  offset: number;
  status?: PactRow["status"];
  speciesSlug?: string;
  includeDeleted: boolean;
}

export interface Repository {
  readonly kind: StoreKind;
  readonly schema: string;
  init(): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; detail: string; checkedAt: string }>;
  listSpecies(): Promise<SpeciesProfile[]>;
  getSpecies(slug: string): Promise<SpeciesProfile | null>;
  saveTaxonomy(
    slug: string,
    data: { gbifUsageKey: number | null; gbifFamily: string | null; gbifStatus: string | null },
  ): Promise<void>;
  countPacts(sessionId: string): Promise<number>;
  listPacts(sessionId: string, query: PactQuery): Promise<PactRow[]>;
  getPact(sessionId: string, id: string): Promise<PactRow | null>;
  findByIdempotencyKey(sessionId: string, key: string): Promise<PactRow | null>;
  createPact(record: NewPactRecord, events: AuditEvent[]): Promise<PactRow>;
  updatePact(
    sessionId: string,
    id: string,
    patch: PactPatch,
    events: AuditEvent[],
  ): Promise<PactRow | null>;
  deletePact(sessionId: string, id: string, events: AuditEvent[]): Promise<PactRow | null>;
  listEvents(entityId: string): Promise<AuditEvent[]>;
  listEventHeads(entityIds: string[]): Promise<Map<string, AuditEvent>>;
}