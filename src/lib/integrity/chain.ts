import type { AuditEvent, AuditEventType, ReplayReport } from "../types";

/**
 * Per-entity append-only seal chain.
 *
 * Every create, update, decision and outcome is appended as an event and
 * sealed:
 *
 *     seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )
 *
 * `canonicalJson` recursively sorts object keys, preserves array order, and
 * emits numbers and strings without locale or float-formatting surprises, so
 * the same logical event always produces the same digest. Chain values are
 * lowercase hex, 96 characters for SHA-384.
 *
 * Deleting a pact never removes its events. The row is tombstoned instead, so
 * the chain for a deleted pact still replays and a deletion is itself provable.
 */

export const GENESIS_SEAL = "0".repeat(96);
export const SEAL_ALGORITHM = "SHA-384";

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    // Normalise -0 and integral floats so 1 and 1.0 hash identically.
    return value === 0 ? 0 : value;
  }
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: { [key: string]: CanonicalValue } = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return String(value);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

const encoder = new TextEncoder();

export async function computeSeal(
  prevSeal: string,
  event: Omit<AuditEvent, "seal">,
): Promise<string> {
  const material = encoder.encode(prevSeal).buffer as ArrayBuffer;
  const digest = await crypto.subtle.digest(
    "SHA-384",
    new Uint8Array([...new Uint8Array(material), ...encoder.encode(canonicalJson(event))]),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface AppendInput {
  entityId: string;
  eventType: AuditEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export async function appendEvent(
  existing: AuditEvent[],
  input: AppendInput,
): Promise<AuditEvent> {
  const previous = existing.length > 0 ? existing[existing.length - 1] : null;
  const prevSeal = previous ? previous.seal : GENESIS_SEAL;
  const seq = existing.length + 1;
  const unsigned: Omit<AuditEvent, "seal"> = {
    entityId: input.entityId,
    seq,
    eventType: input.eventType,
    payload: input.payload,
    prevSeal,
    createdAt: input.createdAt,
  };
  const seal = await computeSeal(prevSeal, unsigned);
  return { ...unsigned, seal };
}

/**
 * Replay an entity's chain. Reports the first sequence number whose stored
 * seal does not match a freshly computed seal, which is the first place the
 * record was altered, reordered, inserted or removed.
 */
export async function replayChain(
  entityId: string,
  events: AuditEvent[],
): Promise<ReplayReport> {
  const verifiedAt = new Date().toISOString();

  if (events.length === 0) {
    return {
      entityId,
      events: 0,
      ok: false,
      brokenAtSeq: 1,
      reason: "no events recorded for this pact",
      headSeal: null,
      verifiedAt,
    };
  }

  const ordered = events.slice().sort((a, b) => a.seq - b.seq);
  let prevSeal = GENESIS_SEAL;

  for (let i = 0; i < ordered.length; i += 1) {
    const event = ordered[i];
    const expectedSeq = i + 1;

    if (event.seq !== expectedSeq) {
      return {
        entityId,
        events: ordered.length,
        ok: false,
        brokenAtSeq: event.seq,
        reason: `expected sequence ${expectedSeq} but found ${event.seq}`,
        headSeal: prevSeal,
        verifiedAt,
      };
    }
    if (event.prevSeal !== prevSeal) {
      return {
        entityId,
        events: ordered.length,
        ok: false,
        brokenAtSeq: event.seq,
        reason: "previous-seal mismatch: this event does not follow the one before it",
        headSeal: prevSeal,
        verifiedAt,
      };
    }
    const expected = await computeSeal(prevSeal, {
      entityId: event.entityId,
      seq: event.seq,
      eventType: event.eventType,
      payload: event.payload,
      prevSeal: event.prevSeal,
      createdAt: event.createdAt,
    });
    if (expected !== event.seal) {
      return {
        entityId,
        events: ordered.length,
        ok: false,
        brokenAtSeq: event.seq,
        reason: "stored seal does not match a freshly computed seal for this event",
        headSeal: prevSeal,
        verifiedAt,
      };
    }
    prevSeal = event.seal;
  }

  return {
    entityId,
    events: ordered.length,
    ok: true,
    brokenAtSeq: null,
    reason: null,
    headSeal: prevSeal,
    verifiedAt,
  };
}