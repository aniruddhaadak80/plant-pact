import { beforeAll, describe, expect, it } from "vitest";

// Deterministic and offline: an embedded in-memory Postgres and the sealed
// weather sample. No network, no environment variables required.
process.env.PLANT_PACT_OFFLINE = "1";
process.env.PGLITE_DIR = ":memory:";

import { getRepository } from "@/lib/db";
import {
  commitPact,
  deletePact,
  getPactDetail,
  listPacts,
  recordOutcome,
  scorePlacement,
  updatePact,
  verifyPact,
  MAX_PACTS_PER_SESSION,
} from "@/lib/service";
import { ServiceError } from "@/lib/api-helpers";
import type { PlacementInput } from "@/lib/validation";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";

function placement(overrides: Partial<PlacementInput> = {}): PlacementInput {
  return {
    speciesSlug: "golden-pothos",
    plantLabel: "the desk one",
    friendName: "Ada",
    placeLabel: "Berlin, Germany",
    latitude: 52.52,
    longitude: 13.405,
    windowLabel: "study window",
    windowAspect: "east",
    windowHours: 4.5,
    wateringDays: 9,
    careLevel: "weekly",
    petsPresent: true,
    commitmentDays: 90,
    ...overrides,
  };
}

beforeAll(async () => {
  const repo = await getRepository();
  expect(repo.kind).toBe("pglite");
  await repo.init();
});

describe("adapter selection", () => {
  it("uses the embedded adapter when DATABASE_URL is unset outside production", async () => {
    expect(process.env.DATABASE_URL).toBeUndefined();
    const repo = await getRepository();
    expect(repo.kind).toBe("pglite");
  });

  it("reports a healthy store that actually answers queries", async () => {
    const repo = await getRepository();
    const health = await repo.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.detail).toContain("SELECT 1 succeeded");
  });

  it("seeds the species catalogue idempotently", async () => {
    const repo = await getRepository();
    const first = await repo.listSpecies();
    expect(first.length).toBeGreaterThan(20);
    await repo.init();
    const second = await repo.listSpecies();
    expect(second.length).toBe(first.length);
  });

  it("seeds reference data without touching user records", async () => {
    const repo = await getRepository();
    const before = await repo.countPacts(SESSION_A);
    await repo.init();
    const after = await repo.countPacts(SESSION_A);
    expect(after).toBe(before);
  });
});

describe("species lookup", () => {
  it("returns a seeded profile with real taxonomy columns", async () => {
    const repo = await getRepository();
    const profile = await repo.getSpecies("golden-pothos");
    expect(profile).not.toBeNull();
    expect(profile!.scientificName).toBe("Epipremnum aureum");
    expect(profile!.gbifUsageKey).toBe(2868323);
    expect(profile!.family).toBe("Araceae");
  });

  it("returns null for an unknown slug", async () => {
    const repo = await getRepository();
    expect(await repo.getSpecies("not-a-plant")).toBeNull();
  });
});

describe("scoring without persistence", () => {
  it("scores a placement and writes nothing", async () => {
    const repo = await getRepository();
    const before = await repo.countPacts(SESSION_A);
    const { verdict, species, sky } = await scorePlacement(placement());
    expect(verdict.model.probability).toBeGreaterThanOrEqual(0);
    expect(verdict.model.probability).toBeLessThanOrEqual(1);
    expect(species.slug).toBe("golden-pothos");
    expect(sky.forecast.length).toBeGreaterThan(0);
    expect(await repo.countPacts(SESSION_A)).toBe(before);
  });

  it("raises a typed 404 for an unknown species", async () => {
    await expect(scorePlacement(placement({ speciesSlug: "nope" }))).rejects.toMatchObject({
      code: "unknown_species",
      status: 404,
    });
  });

  it("labels the sealed sample honestly when offline", async () => {
    const { sky } = await scorePlacement(placement());
    expect(sky.origin).toBe("fallback");
    expect(sky.note).toBeTruthy();
  });
});

describe("CRUD loop", () => {
  it("creates, reads back, updates, closes and tombstones a pact", async () => {
    const created = await commitPact(SESSION_A, placement(), null);
    expect(created.created).toBe(true);
    const id = created.pact.id;
    expect(created.pact.probability).toBeGreaterThan(0);
    expect(created.pact.seal).toHaveLength(96);
    expect(created.pact.dueDate > new Date().toISOString().slice(0, 10)).toBe(true);

    // read back through the UI-facing read path
    const detail = await getPactDetail(SESSION_A, id);
    expect(detail.pact.plantLabel).toBe("the desk one");
    expect(detail.pact.species?.slug).toBe("golden-pothos");
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0].eventType).toBe("created");
    expect(detail.replay.ok).toBe(true);

    // update re-scores and appends
    const updated = await updatePact(SESSION_A, id, { windowHours: 8 });
    expect(updated.pact.windowHours).toBe(8);
    expect(updated.pact.seal).not.toBe(created.pact.seal);

    const afterUpdate = await getPactDetail(SESSION_A, id);
    expect(afterUpdate.events).toHaveLength(2);
    expect(afterUpdate.events[1].eventType).toBe("updated");
    expect(afterUpdate.replay.ok).toBe(true);

    // close the loop
    const closed = await recordOutcome(SESSION_A, id, "survived", 90, "kept it");
    expect(closed.pact.status).toBe("fulfilled");
    expect(closed.pact.outcome).toBe("survived");
    expect(closed.replay.ok).toBe(true);
    expect(closed.replay.events).toBe(3);

    // tombstone
    const removed = await deletePact(SESSION_A, id);
    expect(removed.pact.deletedAt).not.toBeNull();
    expect(removed.replay.ok).toBe(true);
    expect(removed.replay.events).toBe(4);

    // gone from every read
    await expect(getPactDetail(SESSION_A, id)).rejects.toMatchObject({ status: 404 });
  });

  it("keeps the chain replayable after a deletion", async () => {
    const created = await commitPact(SESSION_A, placement({ plantLabel: "tombstone test" }), null);
    const id = created.pact.id;
    await deletePact(SESSION_A, id);

    const repo = await getRepository();
    const events = await repo.listEvents(id);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1].eventType).toBe("deleted");

    const replay = await replayFromRepo(id);
    expect(replay.ok).toBe(true);
  });

  it("never exposes another session's records", async () => {
    const created = await commitPact(SESSION_A, placement({ plantLabel: "private" }), null);
    await expect(getPactDetail(SESSION_B, created.pact.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(verifyPact(SESSION_B, created.pact.id)).rejects.toMatchObject({ status: 404 });
    const listB = await listPacts(SESSION_B, { limit: 50, offset: 0, includeDeleted: false });
    expect(listB.pacts.find((p) => p.id === created.pact.id)).toBeUndefined();
  });

  it("refuses to delete a pact owned by another session", async () => {
    const created = await commitPact(SESSION_A, placement({ plantLabel: "owned" }), null);
    await expect(deletePact(SESSION_B, created.pact.id)).rejects.toMatchObject({ status: 404 });
    const still = await getPactDetail(SESSION_A, created.pact.id);
    expect(still.pact.deletedAt).toBeNull();
  });
});

describe("idempotency", () => {
  it("returns the original pact instead of creating a second one", async () => {
    const key = `test-key-${Date.now()}`;
    const first = await commitPact(SESSION_A, placement({ plantLabel: "retry me" }), key);
    const second = await commitPact(SESSION_A, placement({ plantLabel: "retry me" }), key);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.pact.id).toBe(first.pact.id);

    const listed = await listPacts(SESSION_A, { limit: 50, offset: 0, includeDeleted: false });
    const matches = listed.pacts.filter((p) => p.plantLabel === "retry me");
    expect(matches).toHaveLength(1);
  });
});

describe("conflict handling", () => {
  it("refuses to edit a pact that has already been closed", async () => {
    const created = await commitPact(SESSION_A, placement({ plantLabel: "closed one" }), null);
    await recordOutcome(SESSION_A, created.pact.id, "died", 40, "cold snap");
    await expect(updatePact(SESSION_A, created.pact.id, { windowHours: 9 })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses to record a second outcome", async () => {
    const created = await commitPact(SESSION_A, placement({ plantLabel: "twice" }), null);
    await recordOutcome(SESSION_A, created.pact.id, "survived", 90, null);
    await expect(
      recordOutcome(SESSION_A, created.pact.id, "died", 95, null),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("enforces the per-session quota", async () => {
    const session = "33333333-3333-4333-8333-333333333333";
    for (let i = 0; i < MAX_PACTS_PER_SESSION; i += 1) {
      await commitPact(session, placement({ plantLabel: `bulk ${i}` }), null);
    }
    await expect(commitPact(session, placement(), null)).rejects.toMatchObject({
      status: 429,
      code: "quota_exceeded",
    });
  });
});

describe("listing", () => {
  it("filters by status and honours the limit", async () => {
    const session = "44444444-4444-4444-8444-444444444444";
    await commitPact(session, placement({ plantLabel: "live pact" }), null);
    const doomed = await commitPact(session, placement({ plantLabel: "doomed pact" }), null);
    await recordOutcome(session, doomed.pact.id, "died", 30, null);

    const all = await listPacts(session, { limit: 50, offset: 0, includeDeleted: false });
    expect(all.pacts).toHaveLength(2);
    expect(all.total).toBe(2);

    const called = await listPacts(session, {
      limit: 50,
      offset: 0,
      status: "called",
      includeDeleted: false,
    });
    expect(called.pacts).toHaveLength(1);
    expect(called.pacts[0].plantLabel).toBe("doomed pact");

    const bounded = await listPacts(session, { limit: 1, offset: 0, includeDeleted: false });
    expect(bounded.pacts).toHaveLength(1);
  });

  it("hides tombstoned rows unless explicitly requested", async () => {
    const session = "55555555-5555-4555-8555-555555555555";
    const created = await commitPact(session, placement({ plantLabel: "vanishing" }), null);
    await deletePact(session, created.pact.id);

    const visible = await listPacts(session, { limit: 50, offset: 0, includeDeleted: false });
    expect(visible.pacts).toHaveLength(0);
  });
});

async function replayFromRepo(id: string) {
  const { replayChain } = await import("@/lib/integrity/chain");
  const repo = await getRepository();
  return replayChain(id, await repo.listEvents(id));
}

describe("service errors", () => {
  it("uses the shared ServiceError type with a code and a status", async () => {
    try {
      await getPactDetail(SESSION_A, "00000000-0000-4000-8000-000000000000");
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).status).toBe(404);
      expect((error as ServiceError).code).toBe("not_found");
    }
  });
});