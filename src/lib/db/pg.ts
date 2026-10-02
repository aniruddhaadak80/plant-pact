import { createSqlRepository } from "./sql";
import { resolveSchema } from "./schema";
import type { Repository, SqlClient } from "./repository";

/**
 * Hosted production adapter.
 *
 * Connects to the Postgres instance supplied by DATABASE_URL (Neon through the
 * Vercel Marketplace integration, or any other provider). This is the only
 * adapter allowed in production: the selector in ./index.ts refuses to start a
 * production build without it rather than quietly writing to ephemeral storage.
 */

export async function createPgRepository(databaseUrl: string): Promise<Repository> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Neon and most hosted providers require TLS.
    ssl: databaseUrl.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
  });
  pool.on("error", () => {
    // A pooled connection dropped in serverless is recoverable: the pool
    // replaces it on the next query. Never crash the function for this.
  });

  const client: SqlClient = {
    query: async <T,>(text: string, params?: unknown[]) => {
      const result = await pool.query(text, params as never[]);
      return { rows: result.rows as T[] };
    },
  };

  return createSqlRepository(client, "postgres", resolveSchema());
}