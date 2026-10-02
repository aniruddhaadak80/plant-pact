import { describe, expect, it } from "vitest";
import {
  GENESIS_SEAL,
  SEAL_ALGORITHM,
  appendEvent,
  canonicalJson,
  computeSeal,
  replayChain,
} from "@/lib/integrity/chain";
import type { AuditEvent } from "@/lib/types";

const ENTITY = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const FIRST_PAYLOAD = {
  speciesSlug: "golden-pothos",
  friendName: "Maya",
  windowHours: 4,
  wateringDays: 9,
  probability: 0.61,
  killer: "waterDry",
};

/**
 * Known-answer vectors.
 *
 * These pin the wire format. If canonicalJson changes how it sorts keys or
 * formats numbers, or if the seal construction changes, these two digests stop
 * matching and the test fails - which is the point. A hash chain is only worth
 * anything if the same logical event always produces the same digest.
 */
const FIRST_CANONICAL =
  '{"createdAt":"2026-01-01T00:00:00.000Z","entityId":"3f2504e0-4f89-41d3-9a0c-0305e82c3301","eventType":"created","payload":{"friendName":"Maya","killer":"waterDry","probability":0.61,"speciesSlug":"golden-pothos","wateringDays":9,"windowHours":4},"prevSeal":"' +
  "0".repeat(96) +
  '","seq":1}';

const FIRST_SEAL =
  "9cd79faab63aa160a00dcdd8918d5117a20452900a1eede2fee78e408dfb47336e50daa28c16eb76216a44493c7a418f";

const SECOND_SEAL =
  "8cab84314cd532aa802dba3a26059479f3600fc3c52ff50df547c116a76e3dda1764b87dc77d3fd5fcfaff9b27cb10c3";

function firstEvent(): Omit<AuditEvent, "seal"> {
  return {
    entityId: ENTITY,
    seq: 1,
    eventType: "created",
    payload: FIRST_PAYLOAD,
    prevSeal: GENESIS_SEAL,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("normalises negative zero and undefined", () => {
    expect(canonicalJson({ z: -0, a: 1 })).toBe('{"a":1,"z":0}');
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });

  it("serialises null rather than dropping it", () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  it("is order-independent for objects but not for arrays", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("matches the pinned vector for the first event", () => {
    expect(canonicalJson(firstEvent())).toBe(FIRST_CANONICAL);
  });
});

describe("seal construction", () => {
  it("uses SHA-384 and a 96-character hex digest", async () => {
    expect(SEAL_ALGORITHM).toBe("SHA-384");
    const seal = await computeSeal(GENESIS_SEAL, firstEvent());
    expect(seal).toHaveLength(96);
    expect(seal).toMatch(/^[0-9a-f]{96}$/);
  });

  it("matches the pinned first-vector digest", async () => {
    expect(await computeSeal(GENESIS_SEAL, firstEvent())).toBe(FIRST_SEAL);
  });

  it("matches the pinned second-vector digest, which proves the chaining", async () => {
    const second = {
      entityId: ENTITY,
      seq: 2,
      eventType: "updated" as const,
      payload: { probabilityBefore: 0.61, probabilityAfter: 0.72, windowHours: 6 },
      prevSeal: FIRST_SEAL,
      createdAt: "2026-01-02T00:00:00.000Z",
    };
    expect(await computeSeal(FIRST_SEAL, second)).toBe(SECOND_SEAL);
  });

  it("changes when any single field changes", async () => {
    const original = await computeSeal(GENESIS_SEAL, firstEvent());
    const altered = await computeSeal(GENESIS_SEAL, {
      ...firstEvent(),
      payload: { ...FIRST_PAYLOAD, windowHours: 5 },
    });
    expect(altered).not.toBe(original);
  });

  it("changes when the previous seal changes, so a reordering is detectable", async () => {
    const a = await computeSeal(FIRST_SEAL, firstEvent());
    const b = await computeSeal(SECOND_SEAL, firstEvent());
    expect(a).not.toBe(b);
  });
});

describe("appendEvent", () => {
  it("starts at sequence 1 from genesis", async () => {
    const event = await appendEvent([], {
      entityId: ENTITY,
      eventType: "created",
      payload: FIRST_PAYLOAD,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(event.seq).toBe(1);
    expect(event.prevSeal).toBe(GENESIS_SEAL);
    expect(event.seal).toBe(FIRST_SEAL);
  });

  it("links each event to the previous head", async () => {
    const first = await appendEvent([], {
      entityId: ENTITY,
      eventType: "created",
      payload: FIRST_PAYLOAD,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const second = await appendEvent([first], {
      entityId: ENTITY,
      eventType: "updated",
      payload: { windowHours: 6 },
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    expect(second.seq).toBe(2);
    expect(second.prevSeal).toBe(first.seal);
  });
});

describe("replayChain", () => {
  async function buildChain(): Promise<AuditEvent[]> {
    let events: AuditEvent[] = [];
    events = [
      await appendEvent(events, {
        entityId: ENTITY,
        eventType: "created",
        payload: FIRST_PAYLOAD,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    events = [
      ...events,
      await appendEvent(events, {
        entityId: ENTITY,
        eventType: "updated",
        payload: { windowHours: 6 },
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
    ];
    events = [
      ...events,
      await appendEvent(events, {
        entityId: ENTITY,
        eventType: "deleted",
        payload: { plantLabel: "the desk one" },
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
    ];
    return events;
  }

  it("passes on an untouched chain and reports the head seal", async () => {
    const events = await buildChain();
    const report = await replayChain(ENTITY, events);
    expect(report.ok).toBe(true);
    expect(report.events).toBe(3);
    expect(report.brokenAtSeq).toBeNull();
    expect(report.headSeal).toBe(events[2].seal);
  });

  it("is order-independent because it sorts by sequence first", async () => {
    const events = await buildChain();
    const shuffled = [events[2], events[0], events[1]];
    expect((await replayChain(ENTITY, shuffled)).ok).toBe(true);
  });

  it("detects a modified payload and names the first broken sequence", async () => {
    const events = await buildChain();
    const tampered = events.map((event, index) =>
      index === 1
        ? { ...event, payload: { windowHours: 99 } }
        : event,
    ) as AuditEvent[];
    const report = await replayChain(ENTITY, tampered);
    expect(report.ok).toBe(false);
    expect(report.brokenAtSeq).toBe(2);
    expect(report.reason).toContain("seal");
  });

  it("detects a removed event through the sequence gap", async () => {
    const events = await buildChain();
    const report = await replayChain(ENTITY, [events[0], events[2]]);
    expect(report.ok).toBe(false);
    expect(report.brokenAtSeq).toBe(3);
    expect(report.reason).toContain("sequence");
  });

  it("detects a reordered chain through the prevSeal mismatch", async () => {
    const events = await buildChain();
    // Sequence numbers and array order are irrelevant (replay sorts by seq), so a
    // real reordering attack swaps the payloads between two sealed events while
    // leaving the sequence numbers alone. The digest must catch it.
    const swapped: AuditEvent[] = [events[0], { ...events[1], payload: events[2].payload }, events[2]];
    const report = await replayChain(ENTITY, swapped);
    expect(report.ok).toBe(false);
    expect(report.brokenAtSeq).toBe(2);
  });

  it("treats an empty chain as broken rather than vacuously valid", async () => {
    const report = await replayChain(ENTITY, []);
    expect(report.ok).toBe(false);
    expect(report.reason).toContain("no events");
  });

  it("still replays a chain whose pact was deleted, which is what makes deletion provable", async () => {
    const events = await buildChain();
    expect(events[2].eventType).toBe("deleted");
    expect((await replayChain(ENTITY, events)).ok).toBe(true);
  });
});