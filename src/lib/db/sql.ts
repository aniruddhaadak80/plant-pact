import type { AuditEvent, PactRow, SpeciesProfile } from "../types";
import type {
  NewPactRecord,
  PactPatch,
  PactQuery,
  Repository,
  SqlClient,
  StoreKind,
} from "./repository";
import { applySchema, seedSpecies } from "./schema";

/**
 * One SQL implementation, two adapters.
 *
 * node-postgres and PGlite both expose query(text, params) -> { rows }, so every
 * query, mapping and transaction below is written once. The only difference
 * between local development and production is which client is handed in, which
 * is what makes "the same typed repository interface and domain logic for both"
 * true rather than aspirational.
 */

const PACT_COLUMNS = `
  p.id, p.session_id, p.species_slug, p.plant_label, p.friend_name, p.place_label,
  p.latitude, p.longitude, p.window_label, p.window_aspect, p.window_hours,
  p.watering_days, p.care_level, p.pets_present, p.commitment_days, p.probability,
  p.killer, p.killer_note, p.projected_fail_date, p.status, p.outcome,
  p.outcome_day, p.outcome_note, p.due_date, p.seal, p.created_at, p.updated_at, p.deleted_at
`;

const SPECIES_COLUMNS = `
  s.slug, s.common_name, s.scientific_name, s.family, s.min_light_hours, s.max_light_hours,
  s.min_temp_c, s.max_temp_c, s.water_days, s.water_tolerance_days, s.difficulty, s.toxic,
  s.note, s.care_source, s.gbif_usage_key, s.gbif_family, s.gbif_status, s.taxonomy_fetched_at
`;

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    // Postgres timestamptz without a zone suffix means UTC.
    const normalised = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
    const parsed = new Date(normalised);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return String(value);
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return value === "t" || value === "true" || value === 1 || value === "1";
}

function mapSpecies(row: Record<string, unknown>): SpeciesProfile {
  return {
    slug: String(row.slug),
    commonName: String(row.common_name),
    scientificName: String(row.scientific_name),
    family: String(row.family),
    minLightHours: asNumber(row.min_light_hours),
    maxLightHours: asNumber(row.max_light_hours),
    minTempC: asNumber(row.min_temp_c),
    maxTempC: asNumber(row.max_temp_c),
    waterDays: asNumber(row.water_days),
    waterToleranceDays: asNumber(row.water_tolerance_days),
    difficulty: row.difficulty as SpeciesProfile["difficulty"],
    toxic: asBoolean(row.toxic),
    note: String(row.note),
    careSource: String(row.care_source),
    gbifUsageKey: row.gbif_usage_key === null ? null : asNumber(row.gbif_usage_key),
    gbifFamily: row.gbif_family === null ? null : String(row.gbif_family),
    gbifStatus: row.gbif_status === null ? null : String(row.gbif_status),
    taxonomyFetchedAt: row.taxonomy_fetched_at ? asIso(row.taxonomy_fetched_at) : null,
  };
}

function mapPact(row: Record<string, unknown>): PactRow {
  return {
    id: String(row.id),
    speciesSlug: String(row.species_slug),
    plantLabel: String(row.plant_label),
    friendName: String(row.friend_name),
    placeLabel: String(row.place_label),
    latitude: asNumber(row.latitude),
    longitude: asNumber(row.longitude),
    windowLabel: String(row.window_label),
    windowAspect: row.window_aspect as PactRow["windowAspect"],
    windowHours: asNumber(row.window_hours),
    wateringDays: asNumber(row.watering_days),
    careLevel: row.care_level as PactRow["careLevel"],
    petsPresent: asBoolean(row.pets_present),
    commitmentDays: asNumber(row.commitment_days),
    probability: asNumber(row.probability),
    killer: row.killer as PactRow["killer"],
    killerNote: String(row.killer_note),
    projectedFailDate: asText(row.projected_fail_date),
    status: row.status as PactRow["status"],
    outcome: row.outcome as PactRow["outcome"],
    outcomeDay: row.outcome_day === null ? null : asNumber(row.outcome_day),
    outcomeNote: row.outcome_note === null ? null : String(row.outcome_note),
    dueDate: String(row.due_date),
    seal: String(row.seal),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    deletedAt: row.deleted_at ? asIso(row.deleted_at) : null,
    species: row.common_name === undefined ? null : mapSpecies(row),
  };
}

function mapEvent(row: Record<string, unknown>): AuditEvent {
  const raw = row.payload;
  const payload = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
  return {
    entityId: String(row.entity_id),
    seq: asNumber(row.seq),
    eventType: row.event_type as AuditEvent["eventType"],
    payload: payload ?? {},
    prevSeal: String(row.prev_seal),
    seal: String(row.seal),
    createdAt: asIso(row.created_at),
  };
}

const PATCH_COLUMNS: Record<keyof PactPatch, string> = {
  plantLabel: "plant_label",
  friendName: "friend_name",
  placeLabel: "place_label",
  latitude: "latitude",
  longitude: "longitude",
  windowLabel: "window_label",
  windowAspect: "window_aspect",
  windowHours: "window_hours",
  wateringDays: "watering_days",
  careLevel: "care_level",
  petsPresent: "pets_present",
  commitmentDays: "commitment_days",
  probability: "probability",
  killer: "killer",
  killerNote: "killer_note",
  projectedFailDate: "projected_fail_date",
  status: "status",
  outcome: "outcome",
  outcomeDay: "outcome_day",
  outcomeNote: "outcome_note",
  dueDate: "due_date",
  seal: "seal",
};

export async function withTransaction<T>(
  client: SqlClient,
  run: () => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    const result = await run();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function insertEvents(
  client: SqlClient,
  schema: string,
  sessionId: string,
  events: AuditEvent[],
): Promise<void> {
  for (const event of events) {
    await client.query(
      `insert into ${schema}.audit_events
         (entity_id, entity_kind, session_id, seq, event_type, payload, prev_seal, seal, created_at)
       values ($1,'pact',$2,$3,$4,$5,$6,$7,$8)`,
      [
        event.entityId,
        sessionId,
        event.seq,
        event.eventType,
        JSON.stringify(event.payload),
        event.prevSeal,
        event.seal,
        event.createdAt,
      ],
    );
  }
}

export async function readPact(
  client: SqlClient,
  schema: string,
  sessionId: string,
  id: string,
  includeDeleted = false,
): Promise<PactRow | null> {
  const deletedFilter = includeDeleted ? "" : " and p.deleted_at is null";
  const result = await client.query<Record<string, unknown>>(
    `select ${PACT_COLUMNS}, ${SPECIES_COLUMNS}
       from ${schema}.pacts p
       join ${schema}.species_profiles s on s.slug = p.species_slug
      where p.id = $1 and p.session_id = $2${deletedFilter}`,
    [id, sessionId],
  );
  return result.rows[0] ? mapPact(result.rows[0]) : null;
}

export function createSqlRepository(client: SqlClient, kind: StoreKind, schema: string): Repository {
  let ready = false;

  const repository: Repository = {
    kind,
    schema,

    async init() {
      if (ready) return;
      await applySchema(client, schema);
      await seedSpecies(client, schema);
      ready = true;
    },

    async healthCheck() {
      const checkedAt = new Date().toISOString();
      try {
        const probe = await client.query<{ n: number }>("select 1 as n");
        const rows = probe.rows[0];
        if (!rows || rows.n !== 1) {
          return { ok: false, detail: "SELECT 1 did not return 1", checkedAt };
        }
        const species = await client.query<{ n: number }>(
          `select count(*)::int as n from ${schema}.species_profiles`,
        );
        const pactCount = await client.query<{ n: number }>(
          `select count(*)::int as n from ${schema}.pacts`,
        );
        return {
          ok: true,
          detail: `SELECT 1 succeeded; ${species.rows[0]?.n ?? 0} species seeded; ${pactCount.rows[0]?.n ?? 0} pacts stored`,
          checkedAt,
        };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : "database probe failed",
          checkedAt,
        };
      }
    },

    async listSpecies() {
      const result = await client.query<Record<string, unknown>>(
        `select ${SPECIES_COLUMNS} from ${schema}.species_profiles s order by s.common_name asc`,
      );
      return result.rows.map(mapSpecies);
    },

    async getSpecies(slug) {
      const result = await client.query<Record<string, unknown>>(
        `select ${SPECIES_COLUMNS} from ${schema}.species_profiles s where s.slug = $1`,
        [slug],
      );
      return result.rows[0] ? mapSpecies(result.rows[0]) : null;
    },

    async saveTaxonomy(slug, data) {
      await client.query(
        `update ${schema}.species_profiles
            set gbif_usage_key = $2, gbif_family = $3, gbif_status = $4, taxonomy_fetched_at = now()
          where slug = $1`,
        [slug, data.gbifUsageKey, data.gbifFamily, data.gbifStatus],
      );
    },

    async countPacts(sessionId) {
      const result = await client.query<{ n: number }>(
        `select count(*)::int as n from ${schema}.pacts where session_id = $1 and deleted_at is null`,
        [sessionId],
      );
      return result.rows[0]?.n ?? 0;
    },

    async listPacts(sessionId, query: PactQuery) {
      const filters = ["p.session_id = $1"];
      const params: unknown[] = [sessionId];
      if (!query.includeDeleted) filters.push("p.deleted_at is null");
      if (query.status) {
        params.push(query.status);
        filters.push(`p.status = $${params.length}`);
      }
      if (query.speciesSlug) {
        params.push(query.speciesSlug);
        filters.push(`p.species_slug = $${params.length}`);
      }
      params.push(query.limit, query.offset);
      const result = await client.query<Record<string, unknown>>(
        `select ${PACT_COLUMNS}, ${SPECIES_COLUMNS}
           from ${schema}.pacts p
           join ${schema}.species_profiles s on s.slug = p.species_slug
          where ${filters.join(" and ")}
          order by p.created_at desc
          limit $${params.length - 1} offset $${params.length}`,
        params,
      );
      return result.rows.map(mapPact);
    },

    async getPact(sessionId, id) {
      return readPact(client, schema, sessionId, id);
    },

    async findByIdempotencyKey(sessionId, key) {
      const result = await client.query<Record<string, unknown>>(
        `select ${PACT_COLUMNS}, ${SPECIES_COLUMNS}
           from ${schema}.pacts p
           join ${schema}.species_profiles s on s.slug = p.species_slug
          where p.session_id = $1 and p.idempotency_key = $2 and p.deleted_at is null
          limit 1`,
        [sessionId, key],
      );
      return result.rows[0] ? mapPact(result.rows[0]) : null;
    },

    async createPact(record: NewPactRecord, events: AuditEvent[]) {
      return withTransaction(client, async () => {
        await client.query(
          `insert into ${schema}.pacts (
             id, session_id, idempotency_key, species_slug, plant_label, friend_name,
             place_label, latitude, longitude, window_label, window_aspect, window_hours,
             watering_days, care_level, pets_present, commitment_days, probability,
             killer, killer_note, projected_fail_date, due_date, seal
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
          [
            record.id,
            record.sessionId,
            record.idempotencyKey,
            record.speciesSlug,
            record.plantLabel,
            record.friendName,
            record.placeLabel,
            record.latitude,
            record.longitude,
            record.windowLabel,
            record.windowAspect,
            record.windowHours,
            record.wateringDays,
            record.careLevel,
            record.petsPresent,
            record.commitmentDays,
            record.probability,
            record.killer,
            record.killerNote,
            record.projectedFailDate,
            record.dueDate,
            record.seal,
          ],
        );
        await insertEvents(client, schema, record.sessionId, events);
        const stored = await readPact(client, schema, record.sessionId, record.id);
        if (!stored) throw new Error("Pact insert did not return a readable row");
        return stored;
      });
    },

    async updatePact(sessionId, id, patch: PactPatch, events: AuditEvent[]) {
      const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
      if (entries.length === 0) return readPact(client, schema, sessionId, id);

      return withTransaction(client, async () => {
        const assignments: string[] = [];
        const params: unknown[] = [id, sessionId];
        for (const [key, value] of entries) {
          const column = PATCH_COLUMNS[key as keyof PactPatch];
          if (!column) continue;
          params.push(value);
          assignments.push(`${column} = $${params.length}`);
        }
        if (assignments.length === 0) return readPact(client, schema, sessionId, id);
        assignments.push("updated_at = now()");
        const result = await client.query(
          `update ${schema}.pacts set ${assignments.join(", ")}
            where id = $1 and session_id = $2 and deleted_at is null
            returning id`,
          params,
        );
        if (result.rows.length === 0) return null;
        await insertEvents(client, schema, sessionId, events);
        return readPact(client, schema, sessionId, id);
      });
    },

    async deletePact(sessionId, id, events: AuditEvent[]) {
      return withTransaction(client, async () => {
        const result = await client.query(
          `update ${schema}.pacts set deleted_at = now(), updated_at = now()
            where id = $1 and session_id = $2 and deleted_at is null
            returning id`,
          [id, sessionId],
        );
        if (result.rows.length === 0) return null;
        await insertEvents(client, schema, sessionId, events);
        // The row is tombstoned now, so it must be read back WITHOUT the
        // deleted_at filter; otherwise a successful deletion reports itself missing.
        return readPact(client, schema, sessionId, id, true);
      });
    },

    async listEvents(entityId) {
      const result = await client.query<Record<string, unknown>>(
        `select entity_id, seq, event_type, payload, prev_seal, seal, created_at
           from ${schema}.audit_events
          where entity_id = $1
          order by seq asc`,
        [entityId],
      );
      return result.rows.map(mapEvent);
    },

    async listEventHeads(entityIds) {
      const heads = new Map<string, AuditEvent>();
      if (entityIds.length === 0) return heads;
      const result = await client.query<Record<string, unknown>>(
        `select distinct on (entity_id)
           entity_id, seq, event_type, payload, prev_seal, seal, created_at
           from ${schema}.audit_events
          where entity_id = any($1::uuid[])
          order by entity_id, seq desc`,
        [entityIds],
      );
      for (const row of result.rows) {
        const event = mapEvent(row);
        heads.set(event.entityId, event);
      }
      return heads;
    },
  };

  return repository;
}