import { getRepository } from "./db";
import { ServiceError } from "./api-helpers";
import { appendEvent, replayChain } from "./integrity/chain";
import { evaluate, killerNote } from "./engine/verdict";
import { ENGINE_VERSION } from "./engine/verdict";
import { fetchSky } from "./weather/open-meteo";
import type {
  AuditEvent,
  EngineVerdict,
  Pact,
  PactOutcome,
  PactRow,
  ReplayReport,
  SpeciesProfile,
  SkyBundle,
} from "./types";
import type { PactQuery } from "./db/repository";
import type { PlacementInput } from "./validation";

/**
 * The service layer.
 *
 * Every mutation in the application goes through exactly one of these functions:
 * the REST routes, the MCP tools and the browser UI all call here. That is what
 * makes the claim "the agent mutating tool and the UI share one path" checkable
 * rather than aspirational - there is only one implementation.
 *
 * Ownership is enforced by scoping every read and write to the anonymous
 * session id, and every mutation appends to the pact's seal chain in the same
 * transaction as the row change.
 */

export const MAX_PACTS_PER_SESSION = 40;

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function roundProbability(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export async function listSpecies(): Promise<SpeciesProfile[]> {
  const repo = await getRepository();
  return repo.listSpecies();
}

export async function getSpecies(slug: string): Promise<SpeciesProfile | null> {
  const repo = await getRepository();
  return repo.getSpecies(slug);
}

/**
 * Score a placement without writing anything. This is the function the advisor
 * screen, the REST endpoint and the MCP analysis tool all call, so the number
 * a visitor drags a slider towards is the number an agent gets.
 */
export async function scorePlacement(input: PlacementInput): Promise<{
  verdict: EngineVerdict;
  species: SpeciesProfile;
  sky: SkyBundle;
}> {
  const repo = await getRepository();
  const species = await repo.getSpecies(input.speciesSlug);
  if (!species) {
    throw new ServiceError(
      "unknown_species",
      `No species with slug "${input.speciesSlug}" in the catalogue.`,
      404,
      { field: "speciesSlug" },
    );
  }
  const sky = await fetchSky({
    latitude: input.latitude,
    longitude: input.longitude,
    placeLabel: input.placeLabel,
  });
  const verdict = evaluate({
    species,
    windowHours: input.windowHours,
    wateringDays: input.wateringDays,
    careLevel: input.careLevel,
    sky,
    horizonDays: input.commitmentDays,
  });
  return { verdict, species, sky };
}

export async function listPacts(
  sessionId: string,
  query: PactQuery,
): Promise<{ pacts: PactRow[]; total: number }> {
  const repo = await getRepository();
  const [pacts, total] = await Promise.all([
    repo.listPacts(sessionId, query),
    repo.countPacts(sessionId),
  ]);
  return { pacts, total };
}

export interface PactDetail {
  pact: Pact;
  sky: SkyBundle | null;
  verdict: EngineVerdict | null;
  replay: ReplayReport;
  events: AuditEvent[];
}

export async function getPactDetail(sessionId: string, id: string): Promise<PactDetail> {
  const repo = await getRepository();
  const row = await repo.getPact(sessionId, id);
  if (!row) {
    throw new ServiceError("not_found", "No pact with that id exists in this session.", 404);
  }
  const events = await repo.listEvents(id);
  const replay = await replayChain(id, events);

  let sky: SkyBundle | null = null;
  let verdict: EngineVerdict | null = null;
  if (row.species) {
    sky = await fetchSky({
      latitude: row.latitude,
      longitude: row.longitude,
      placeLabel: row.placeLabel,
    });
    verdict = evaluate({
      species: row.species,
      windowHours: row.windowHours,
      wateringDays: row.wateringDays,
      careLevel: row.careLevel,
      sky,
      horizonDays: row.commitmentDays,
    });
  }

  return {
    pact: { ...row, sky, verdict },
    sky,
    verdict,
    replay,
    events,
  };
}

/** Commit a pact: score it, persist it, and seal the creation event. */
export async function commitPact(
  sessionId: string,
  input: PlacementInput,
  idempotencyKey: string | null,
): Promise<{ pact: PactRow; created: boolean; verdict: EngineVerdict; sky: SkyBundle }> {
  const repo = await getRepository();

  if (idempotencyKey) {
    const existing = await repo.findByIdempotencyKey(sessionId, idempotencyKey);
    if (existing) {
      const sky = await fetchSky({
        latitude: existing.latitude,
        longitude: existing.longitude,
        placeLabel: existing.placeLabel,
      });
      const verdict = evaluate({
        species: existing.species as SpeciesProfile,
        windowHours: existing.windowHours,
        wateringDays: existing.wateringDays,
        careLevel: existing.careLevel,
        sky,
        horizonDays: existing.commitmentDays,
      });
      return { pact: existing, created: false, verdict, sky };
    }
  }

  const total = await repo.countPacts(sessionId);
  if (total >= MAX_PACTS_PER_SESSION) {
    throw new ServiceError(
      "quota_exceeded",
      `This session already holds ${total} pacts, which is the anonymous limit. Delete one before committing another.`,
      429,
      { limit: MAX_PACTS_PER_SESSION },
    );
  }

  const { verdict, species, sky } = await scorePlacement(input);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const dueDate = isoDate(input.commitmentDays);
  const projectedFailDate = verdict.breakingPoint.projectedDate ?? verdict.breakingPoint.date;
  const sealHolder = {
    entityId: id,
    eventType: "created" as const,
    payload: {
      speciesSlug: input.speciesSlug,
      scientificName: species.scientificName,
      friendName: input.friendName,
      placeLabel: input.placeLabel,
      windowHours: input.windowHours,
      wateringDays: input.wateringDays,
      careLevel: input.careLevel,
      commitmentDays: input.commitmentDays,
      probability: roundProbability(verdict.model.probability),
      killer: verdict.model.killer,
      projectedFailDate,
      engineVersion: ENGINE_VERSION,
      modelVersion: verdict.modelVersion,
      weatherOrigin: sky.origin,
      weatherFetchedAt: sky.fetchedAt,
    },
    createdAt: now,
  };
  const event = await appendEvent([], sealHolder);
  const sealedProbability = roundProbability(verdict.model.probability);

  const stored = await repo.createPact(
    {
      id,
      sessionId,
      idempotencyKey,
      speciesSlug: input.speciesSlug,
      plantLabel: input.plantLabel,
      friendName: input.friendName,
      placeLabel: input.placeLabel,
      latitude: input.latitude,
      longitude: input.longitude,
      windowLabel: input.windowLabel,
      windowAspect: input.windowAspect,
      windowHours: input.windowHours,
      wateringDays: input.wateringDays,
      careLevel: input.careLevel,
      petsPresent: input.petsPresent,
      commitmentDays: input.commitmentDays,
      probability: sealedProbability,
      killer: verdict.model.killer,
      killerNote: killerNote(verdict.model.killer),
      projectedFailDate,
      dueDate,
      seal: event.seal,
    },
    [event],
  );

  return {
    pact: { ...stored, sky, verdict },
    created: true,
    verdict,
    sky,
  };
}

export async function updatePact(
  sessionId: string,
  id: string,
  patch: Partial<PlacementInput>,
): Promise<{ pact: PactRow; verdict: EngineVerdict; sky: SkyBundle }> {
  const repo = await getRepository();
  const existing = await repo.getPact(sessionId, id);
  if (!existing) {
    throw new ServiceError("not_found", "No pact with that id exists in this session.", 404);
  }
  if (existing.status !== "committed") {
    throw new ServiceError(
      "conflict",
      `This pact is already closed as "${existing.status}" and cannot be edited.`,
      409,
    );
  }

  const merged: PlacementInput = {
    speciesSlug: patch.speciesSlug ?? existing.speciesSlug,
    plantLabel: patch.plantLabel ?? existing.plantLabel,
    friendName: patch.friendName ?? existing.friendName,
    placeLabel: patch.placeLabel ?? existing.placeLabel,
    latitude: patch.latitude ?? existing.latitude,
    longitude: patch.longitude ?? existing.longitude,
    windowLabel: patch.windowLabel ?? existing.windowLabel,
    windowAspect: patch.windowAspect ?? existing.windowAspect,
    windowHours: patch.windowHours ?? existing.windowHours,
    wateringDays: patch.wateringDays ?? existing.wateringDays,
    careLevel: patch.careLevel ?? existing.careLevel,
    petsPresent: patch.petsPresent ?? existing.petsPresent,
    commitmentDays: patch.commitmentDays ?? existing.commitmentDays,
  };

  const { verdict, sky } = await scorePlacement(merged);
  const projectedFailDate = verdict.breakingPoint.projectedDate ?? verdict.breakingPoint.date;
  const now = new Date().toISOString();
  const events = await repo.listEvents(id);
  const event = await appendEvent(events, {
    entityId: id,
    eventType: "updated",
    payload: {
      changed: {
        windowHours: merged.windowHours,
        wateringDays: merged.wateringDays,
        careLevel: merged.careLevel,
        placeLabel: merged.placeLabel,
      },
      probabilityBefore: existing.probability,
      probabilityAfter: roundProbability(verdict.model.probability),
      killer: verdict.model.killer,
      projectedFailDate,
      engineVersion: ENGINE_VERSION,
      weatherOrigin: sky.origin,
    },
    createdAt: now,
  });

  const stored = await repo.updatePact(
    sessionId,
    id,
    {
      plantLabel: merged.plantLabel,
      friendName: merged.friendName,
      placeLabel: merged.placeLabel,
      latitude: merged.latitude,
      longitude: merged.longitude,
      windowLabel: merged.windowLabel,
      windowAspect: merged.windowAspect,
      windowHours: merged.windowHours,
      wateringDays: merged.wateringDays,
      careLevel: merged.careLevel,
      petsPresent: merged.petsPresent,
      commitmentDays: merged.commitmentDays,
      probability: roundProbability(verdict.model.probability),
      killer: verdict.model.killer,
      killerNote: killerNote(verdict.model.killer),
      projectedFailDate,
      dueDate: isoDate(merged.commitmentDays),
      seal: event.seal,
    },
    [event],
  );

  if (!stored) {
    throw new ServiceError("conflict", "The pact changed or was deleted while it was being edited.", 409);
  }
  return { pact: { ...stored, sky, verdict }, verdict, sky };
}

/**
 * Close the loop: record what actually happened. This is the action that makes
 * the product honest over time, and it is append-only.
 */
export async function recordOutcome(
  sessionId: string,
  id: string,
  outcome: PactOutcome,
  day: number | null,
  note: string | null,
): Promise<{ pact: PactRow; replay: ReplayReport }> {
  const repo = await getRepository();
  const existing = await repo.getPact(sessionId, id);
  if (!existing) {
    throw new ServiceError("not_found", "No pact with that id exists in this session.", 404);
  }
  if (existing.status !== "committed") {
    throw new ServiceError(
      "conflict",
      `This pact is already closed as "${existing.status}".`,
      409,
      { status: existing.status },
    );
  }

  const now = new Date().toISOString();
  const events = await repo.listEvents(id);
  const event = await appendEvent(events, {
    entityId: id,
    eventType: "outcome_recorded",
    payload: {
      outcome,
      day,
      note,
      predictedProbability: existing.probability,
      predictedKiller: existing.killer,
      predictedFailDate: existing.projectedFailDate,
      engineVersion: ENGINE_VERSION,
    },
    createdAt: now,
  });

  const status = outcome === "pending" ? "committed" : outcome === "survived" ? "fulfilled" : "called";
  const stored = await repo.updatePact(
    sessionId,
    id,
    { outcome, outcomeDay: day, outcomeNote: note, status, seal: event.seal },
    [event],
  );
  if (!stored) {
    throw new ServiceError("conflict", "The pact changed while the outcome was being recorded.", 409);
  }

  const refreshedEvents = await repo.listEvents(id);
  return { pact: stored, replay: await replayChain(id, refreshedEvents) };
}

/**
 * Tombstone, never erase. The row is flagged deleted_at and its chain stays
 * intact and replayable, so a deletion is provable rather than invisible.
 */
export async function deletePact(
  sessionId: string,
  id: string,
): Promise<{ pact: PactRow; replay: ReplayReport }> {
  const repo = await getRepository();
  const existing = await repo.getPact(sessionId, id);
  if (!existing) {
    throw new ServiceError("not_found", "No pact with that id exists in this session.", 404);
  }

  const now = new Date().toISOString();
  const events = await repo.listEvents(id);
  const event = await appendEvent(events, {
    entityId: id,
    eventType: "deleted",
    payload: {
      plantLabel: existing.plantLabel,
      friendName: existing.friendName,
      predictedProbability: existing.probability,
      predictedKiller: existing.killer,
      sealBeforeDelete: existing.seal,
    },
    createdAt: now,
  });

  const stored = await repo.deletePact(sessionId, id, [event]);
  if (!stored) {
    throw new ServiceError("conflict", "The pact was already deleted.", 409);
  }

  const refreshedEvents = await repo.listEvents(id);
  return { pact: stored, replay: await replayChain(id, refreshedEvents) };
}

export async function verifyPact(sessionId: string, id: string): Promise<ReplayReport> {
  const repo = await getRepository();
  const pact = await repo.getPact(sessionId, id);
  if (!pact) {
    throw new ServiceError("not_found", "No pact with that id exists in this session.", 404);
  }
  return replayChain(id, await repo.listEvents(id));
}