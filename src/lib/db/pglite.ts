import { createSqlRepository } from "./sql";
import { resolveSchema } from "./schema";
import type { Repository, SqlClient } from "./repository";

/**
 * Embedded zero-configuration adapter for local development and tests.
 *
 * PGlite is real Postgres compiled to WebAssembly, so the schema, foreign
 * keys, check constraints, partial unique indexes and transactions exercised
 * locally are the same ones that run in production. The only difference is
 * durability: the data lives in a directory (or in memory for tests) rather
 * than in a hosted instance, which is exactly why it is refused in production.
 */

export async function createPgliteRepository(directory?: string): Promise<Repository> {
  const { PGlite } = await import("@electric-sql/pglite");
  const target = directory ?? process.env.PGLITE_DIR ?? ".pglite";
  // A single embedded instance owns the data directory, so it is intentionally
  // never closed: closing would destroy the handle this repository needs.
  const client = target === ":memory:" ? new PGlite() : new PGlite(target);

  const sql: SqlClient = {
    query: async <T,>(text: string, params?: unknown[]) => {
      const result = await client.query<T>(text, params as never[]);
      return { rows: result.rows ?? [] };
    },
  };

  return createSqlRepository(sql, "pglite", resolveSchema());
}