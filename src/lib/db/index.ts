import type { Repository } from "./repository";

/**
 * Adapter selection.
 *
 * Production REQUIRES a hosted Postgres and fails loudly without one. Local
 * development and tests fall back to the embedded PGlite adapter so the project
 * runs with zero environment variables. A Vercel deployment without DATABASE_URL
 * therefore fails the health check rather than silently accepting writes into a
 * cold-start-volatile filesystem.
 */

const GLOBAL_KEY = "__plantPactRepository";

type GlobalWithRepo = typeof globalThis & { [GLOBAL_KEY]?: Repository };

let cached: Repository | null = null;
let initPromise: Promise<Repository> | null = null;

export async function getRepository(): Promise<Repository> {
  const g = globalThis as GlobalWithRepo;
  if (cached) return cached;
  if (g[GLOBAL_KEY]) {
    cached = g[GLOBAL_KEY];
    return cached;
  }
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const url = process.env.DATABASE_URL?.trim();
    if (url) {
      const { createPgRepository } = await import("./pg");
      const repo = await createPgRepository(url);
      await repo.init();
      cached = repo;
      g[GLOBAL_KEY] = repo;
      return repo;
    }
    if (process.env.NODE_ENV === "production") {
      // The one exception is an explicit opt-in, used by the local production
      // build in the browser smoke test. It is never set in a real deployment,
      // so a production deployment without a hosted database still fails loudly
      // rather than silently accepting writes into volatile storage.
      if (process.env.PLANT_PACT_ALLOW_EMBEDDED !== "1") {
        throw new Error(
          "DATABASE_URL is not set. Plant Pact requires a hosted Postgres database in production (see .env.example). Refusing to fall back to a non-durable store.",
        );
      }
      console.warn(
        "[plant-pact] PLANT_PACT_ALLOW_EMBEDDED=1 in a production build: using the embedded PGlite store. Data is not durable. Never do this in a real deployment.",
      );
    }
    const { createPgliteRepository } = await import("./pglite");
    const repo = await createPgliteRepository();
    await repo.init();
    cached = repo;
    g[GLOBAL_KEY] = repo;
    return repo;
  })();

  initPromise.catch(() => {
    initPromise = null;
  });
  return initPromise;
}

export function currentStoreKind(): "postgres" | "pglite" | "uninitialised" {
  return cached?.kind ?? (process.env.DATABASE_URL ? "postgres" : "uninitialised");
}