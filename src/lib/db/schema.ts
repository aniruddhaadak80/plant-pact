import { CATALOGUE } from "../species";
import type { SqlClient } from "./repository";

/**
 * Schema and idempotent first-run seeding, shared verbatim by the hosted
 * Postgres adapter and the embedded PGlite adapter.
 *
 * The species catalogue is seeded with origin='catalogue' and is referenced by
 * every pact through a foreign key, so a pact can never point at a species that
 * does not exist. Seeds use fixed slugs and are upserted, so they never collide
 * with a user record: pacts and their audit events carry generated UUIDs.
 */

const SCHEMA_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function resolveSchema(): string {
  const requested = process.env.DATABASE_SCHEMA?.trim();
  if (!requested) return "public";
  if (!SCHEMA_NAME_RE.test(requested)) {
    throw new Error(
      `DATABASE_SCHEMA must be a simple SQL identifier (letters, digits, underscore). Received: ${requested}`,
    );
  }
  return requested;
}

function ddl(schema: string): string[] {
  const s = schema;
  return [
    `create schema if not exists ${s}`,
    `create table if not exists ${s}.species_profiles (
      slug text primary key,
      common_name text not null,
      scientific_name text not null unique,
      family text not null,
      min_light_hours real not null,
      max_light_hours real not null,
      min_temp_c real not null,
      max_temp_c real not null,
      water_days real not null,
      water_tolerance_days real not null,
      difficulty text not null check (difficulty in ('easy','moderate','fussy')),
      toxic boolean not null default false,
      note text not null,
      care_source text not null,
      gbif_usage_key integer,
      gbif_family text,
      gbif_status text,
      taxonomy_fetched_at timestamptz,
      origin text not null default 'catalogue' check (origin in ('catalogue','user-import')),
      curated_at timestamptz not null default now()
    )`,
    `create table if not exists ${s}.pacts (
      id uuid primary key,
      session_id uuid not null,
      idempotency_key text,
      species_slug text not null references ${s}.species_profiles(slug),
      plant_label text not null,
      friend_name text not null,
      place_label text not null,
      latitude real not null check (latitude between -90 and 90),
      longitude real not null check (longitude between -180 and 180),
      window_label text not null,
      window_aspect text not null check (window_aspect in ('north','east','south','west','unknown')),
      window_hours real not null check (window_hours between 0 and 24),
      watering_days real not null check (watering_days between 0.5 and 90),
      care_level text not null check (care_level in ('forgetful','weekly','diligent')),
      pets_present boolean not null default false,
      commitment_days integer not null check (commitment_days between 7 and 730),
      probability real not null check (probability between 0 and 1),
      killer text not null,
      killer_note text not null,
      projected_fail_date text,
      status text not null default 'committed' check (status in ('committed','fulfilled','called')),
      outcome text not null default 'pending' check (outcome in ('survived','struggled','died','pending')),
      outcome_day integer,
      outcome_note text,
      due_date text not null,
      seal text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    )`,
    `create unique index if not exists pacts_session_idempotency
       on ${s}.pacts (session_id, idempotency_key)
       where idempotency_key is not null`,
    `create index if not exists pacts_session_recent on ${s}.pacts (session_id, created_at desc)`,
    `create index if not exists pacts_session_status on ${s}.pacts (session_id, status)`,
    `create index if not exists pacts_species on ${s}.pacts (species_slug)`,
    `create table if not exists ${s}.audit_events (
      id bigserial primary key,
      entity_id uuid not null,
      entity_kind text not null default 'pact',
      session_id uuid not null,
      seq integer not null,
      event_type text not null check (event_type in ('created','updated','outcome_recorded','deleted')),
      payload jsonb not null,
      prev_seal text not null,
      seal text not null,
      created_at timestamptz not null,
      unique (entity_id, seq)
    )`,
    `create index if not exists audit_entity_seq on ${s}.audit_events (entity_id, seq)`,
    `create index if not exists audit_session on ${s}.audit_events (session_id, created_at desc)`,
  ];
}

export async function applySchema(client: SqlClient, schema: string): Promise<void> {
  for (const statement of ddl(schema)) {
    await client.query(statement);
  }
}

/**
 * Idempotent catalogue seeding. Fixed slugs, upsert semantics: re-running
 * refreshes reference data without touching a single user pact, because user
 * records live in other tables and carry generated UUIDs.
 */
export async function seedSpecies(client: SqlClient, schema: string): Promise<number> {
  for (const species of CATALOGUE) {
    await client.query(
      `insert into ${schema}.species_profiles (
         slug, common_name, scientific_name, family,
         min_light_hours, max_light_hours, min_temp_c, max_temp_c,
         water_days, water_tolerance_days, difficulty, toxic,
         note, care_source, gbif_usage_key, gbif_family, gbif_status, origin
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'catalogue')
       on conflict (slug) do update set
         common_name = excluded.common_name,
         scientific_name = excluded.scientific_name,
         family = excluded.family,
         min_light_hours = excluded.min_light_hours,
         max_light_hours = excluded.max_light_hours,
         min_temp_c = excluded.min_temp_c,
         max_temp_c = excluded.max_temp_c,
         water_days = excluded.water_days,
         water_tolerance_days = excluded.water_tolerance_days,
         difficulty = excluded.difficulty,
         toxic = excluded.toxic,
         note = excluded.note,
         care_source = excluded.care_source,
         gbif_usage_key = excluded.gbif_usage_key,
         gbif_family = excluded.gbif_family,
         gbif_status = excluded.gbif_status`,
      [
        species.slug,
        species.commonName,
        species.scientificName,
        species.family,
        species.minLightHours,
        species.maxLightHours,
        species.minTempC,
        species.maxTempC,
        species.waterDays,
        species.waterToleranceDays,
        species.difficulty,
        species.toxic,
        species.note,
        species.careSource,
        species.gbifUsageKey,
        species.gbifFamily,
        species.gbifStatus,
      ],
    );
  }
  return CATALOGUE.length;
}