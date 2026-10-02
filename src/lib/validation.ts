import { ServiceError } from "./api-helpers";
import type { CareLevel, PactOutcome, WindowAspect } from "./types";

export const ASPECTS: WindowAspect[] = ["north", "east", "south", "west", "unknown"];
export const CARE_LEVELS: CareLevel[] = ["forgetful", "weekly", "diligent"];
export const OUTCOMES: PactOutcome[] = ["survived", "struggled", "died", "pending"];

export interface PlacementInput {
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
}

export const DEFAULT_COMMITMENT_DAYS = 90;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ServiceError("invalid_body", "Expected a JSON object.", 400);
  }
  return value as Record<string, unknown>;
}

function requireString(
  source: Record<string, unknown>,
  key: string,
  { min, max, field }: { min: number; max: number; field: string },
): string {
  const raw = source[key];
  if (typeof raw !== "string") {
    throw new ServiceError("invalid_field", `${field} is required and must be a string.`, 400, { field });
  }
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length < min || trimmed.length > max) {
    throw new ServiceError(
      "invalid_field",
      `${field} must be between ${min} and ${max} characters.`,
      400,
      { field, length: trimmed.length },
    );
  }
  return trimmed;
}

function requireNumber(
  source: Record<string, unknown>,
  key: string,
  { min, max, field }: { min: number; max: number; field: string },
): number {
  const raw = source[key];
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ServiceError("invalid_field", `${field} must be a number.`, 400, { field });
  }
  if (value < min || value > max) {
    throw new ServiceError("invalid_field", `${field} must be between ${min} and ${max}.`, 400, {
      field,
      value,
    });
  }
  return Math.round(value * 100) / 100;
}

function requireEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: T[],
  field: string,
  fallback?: T,
): T {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new ServiceError("invalid_field", `${field} is required.`, 400, { field, allowed });
  }
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    throw new ServiceError(
      "invalid_field",
      `${field} must be one of: ${allowed.join(", ")}.`,
      400,
      { field, allowed },
    );
  }
  return raw as T;
}

function optionalNumber(
  source: Record<string, unknown>,
  key: string,
  { min, max, field, fallback }: { min: number; max: number; field: string; fallback: number },
): number {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return requireNumber(source, key, { min, max, field });
}

function requireBoolean(source: Record<string, unknown>, key: string, fallback = false): boolean {
  const raw = source[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === "1" || raw === 1) return true;
  if (raw === "false" || raw === "0" || raw === 0) return false;
  throw new ServiceError("invalid_field", `${key} must be true or false.`, 400, { field: key });
}

export function parsePlacement(body: unknown): PlacementInput {
  const source = asRecord(body);
  const speciesSlug = requireString(source, "speciesSlug", { min: 1, max: 80, field: "speciesSlug" });
  return {
    speciesSlug,
    plantLabel: requireString(source, "plantLabel", { min: 1, max: 60, field: "plantLabel" }),
    friendName: requireString(source, "friendName", { min: 1, max: 60, field: "friendName" }),
    placeLabel: requireString(source, "placeLabel", { min: 1, max: 80, field: "placeLabel" }),
    latitude: requireNumber(source, "latitude", { min: -90, max: 90, field: "latitude" }),
    longitude: requireNumber(source, "longitude", { min: -180, max: 180, field: "longitude" }),
    windowLabel: requireString(source, "windowLabel", { min: 1, max: 60, field: "windowLabel" }),
    windowAspect: requireEnum(source, "windowAspect", ASPECTS, "windowAspect", "unknown"),
    windowHours: requireNumber(source, "windowHours", { min: 0, max: 24, field: "windowHours" }),
    wateringDays: requireNumber(source, "wateringDays", { min: 0.5, max: 90, field: "wateringDays" }),
    careLevel: requireEnum(source, "careLevel", CARE_LEVELS, "careLevel", "weekly"),
    petsPresent: requireBoolean(source, "petsPresent"),
    commitmentDays: optionalNumber(source, "commitmentDays", {
      min: 7,
      max: 730,
      field: "commitmentDays",
      fallback: DEFAULT_COMMITMENT_DAYS,
    }),
  };
}

/**
 * Validate a partial update. Only the fields actually present are checked and
 * returned, so a caller can change the window hours without resending the
 * whole placement. An unknown key is rejected rather than ignored, which stops a
 * typo silently doing nothing.
 */
const PATCHABLE_KEYS = new Set([
  "speciesSlug",
  "plantLabel",
  "friendName",
  "placeLabel",
  "latitude",
  "longitude",
  "windowLabel",
  "windowAspect",
  "windowHours",
  "wateringDays",
  "careLevel",
  "petsPresent",
  "commitmentDays",
]);

export function parsePlacementPatch(body: unknown): Partial<PlacementInput> {
  const source = asRecord(body);
  const unknownKeys = Object.keys(source).filter((key) => !PATCHABLE_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new ServiceError(
      "invalid_field",
      `Unrecognised field(s): ${unknownKeys.join(", ")}. Patch accepts: ${[...PATCHABLE_KEYS].join(", ")}.`,
      400,
      { unknown: unknownKeys },
    );
  }

  const patch: Partial<PlacementInput> = {};
  if (source.plantLabel !== undefined) patch.plantLabel = requireString(source, "plantLabel", { min: 1, max: 60, field: "plantLabel" });
  if (source.friendName !== undefined) patch.friendName = requireString(source, "friendName", { min: 1, max: 60, field: "friendName" });
  if (source.placeLabel !== undefined) patch.placeLabel = requireString(source, "placeLabel", { min: 1, max: 80, field: "placeLabel" });
  if (source.windowLabel !== undefined) patch.windowLabel = requireString(source, "windowLabel", { min: 1, max: 60, field: "windowLabel" });
  if (source.speciesSlug !== undefined) patch.speciesSlug = requireString(source, "speciesSlug", { min: 1, max: 80, field: "speciesSlug" });
  if (source.latitude !== undefined) patch.latitude = requireNumber(source, "latitude", { min: -90, max: 90, field: "latitude" });
  if (source.longitude !== undefined) patch.longitude = requireNumber(source, "longitude", { min: -180, max: 180, field: "longitude" });
  if (source.windowHours !== undefined) patch.windowHours = requireNumber(source, "windowHours", { min: 0, max: 24, field: "windowHours" });
  if (source.wateringDays !== undefined) patch.wateringDays = requireNumber(source, "wateringDays", { min: 0.5, max: 90, field: "wateringDays" });
  if (source.commitmentDays !== undefined) patch.commitmentDays = requireNumber(source, "commitmentDays", { min: 7, max: 730, field: "commitmentDays" });
  if (source.windowAspect !== undefined) patch.windowAspect = requireEnum(source, "windowAspect", ASPECTS, "windowAspect", "unknown");
  if (source.careLevel !== undefined) patch.careLevel = requireEnum(source, "careLevel", CARE_LEVELS, "careLevel", "weekly");
  if (source.petsPresent !== undefined) patch.petsPresent = requireBoolean(source, "petsPresent");

  if (Object.keys(patch).length === 0) {
    throw new ServiceError(
      "invalid_body",
      "Send at least one field to update. Patching an empty object is rejected rather than silently ignored.",
      400,
    );
  }
  return patch;
}

export function parseOutcome(body: unknown): { outcome: PactOutcome; day: number | null; note: string | null } {
  const source = asRecord(body);
  const outcome = requireEnum(source, "outcome", OUTCOMES, "outcome", "pending");
  const rawDay = source.day;
  let day: number | null = null;
  if (rawDay !== undefined && rawDay !== null && rawDay !== "") {
    day = requireNumber({ day: rawDay }, "day", { min: 0, max: 730, field: "day" });
  }
  let note: string | null = null;
  if (source.note !== undefined && source.note !== null && source.note !== "") {
    note = requireString(source, "note", { min: 1, max: 600, field: "note" });
  }
  return { outcome, day, note };
}

export function parseIdempotencyKey(request: Request, body: unknown): string | null {
  const header = request.headers.get("idempotency-key") ?? request.headers.get("x-idempotency-key");
  const fromHeader = header?.trim();
  if (fromHeader) {
    if (fromHeader.length > 120) {
      throw new ServiceError("invalid_field", "Idempotency-Key must be 120 characters or fewer.", 400);
    }
    return fromHeader;
  }
  if (typeof body === "object" && body !== null) {
    const value = (body as Record<string, unknown>).idempotencyKey;
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
  }
  return null;
}

export function parseSpeciesQuery(value: string | null): string {
  const query = (value ?? "").trim();
  if (query.length < 2) {
    throw new ServiceError("invalid_field", "Provide a plant name of at least 2 characters.", 400, {
      field: "q",
    });
  }
  return query.slice(0, 120);
}