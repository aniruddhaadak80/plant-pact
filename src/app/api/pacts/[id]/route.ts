import type { NextRequest } from "next/server";
import { handleError, jsonOk, meta, readJson, ServiceError } from "@/lib/api-helpers";
import { getSessionId, isUuid } from "@/lib/session";
import { deletePact, getPactDetail, updatePact } from "@/lib/service";
import { checkRate } from "@/lib/rate-limit";
import { parsePlacementPatch } from "@/lib/validation";

export const dynamic = "force-dynamic";

async function requireId(id: string): Promise<string> {
  if (!isUuid(id)) {
    throw new ServiceError("invalid_id", "That pact id is not a valid identifier.", 400);
  }
  return id;
}

/** GET /api/pacts/[id] - pact, live weather, fresh verdict and chain replay. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const sessionId = await getSessionId();
    const { id } = await context.params;
    const detail = await getPactDetail(sessionId, await requireId(id));
    return jsonOk({ ...detail, meta: meta() });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * PATCH /api/pacts/[id] - change the placement.
 *
 * Any change to the placement re-scores the pact with the same engine, updates
 * the stored probability and projected date, and appends an "updated" event.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const sessionId = await getSessionId();
    const { id } = await context.params;
    const rate = checkRate(`write:${sessionId}`, 20);
    if (!rate.allowed) {
      throw new ServiceError(
        "rate_limited",
        `Too many writes from this session. Retry in ${rate.retryAfterSeconds}s.`,
        429,
      );
    }

    const patch = parsePlacementPatch(await readJson(request));
    const { pact, verdict, sky } = await updatePact(sessionId, await requireId(id), patch);
    return jsonOk({ pact: { ...pact, sky, verdict }, verdict, sky, meta: meta() });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * DELETE /api/pacts/[id] - tombstone.
 *
 * The row is flagged deleted and stops appearing in every read, but its audit
 * chain is retained and stays replayable, so the deletion itself is provable
 * rather than hidden.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const sessionId = await getSessionId();
    const { id } = await context.params;
    const rate = checkRate(`write:${sessionId}`, 20);
    if (!rate.allowed) {
      throw new ServiceError(
        "rate_limited",
        `Too many writes from this session. Retry in ${rate.retryAfterSeconds}s.`,
        429,
      );
    }
    const pactId = await requireId(id);
    const { pact, replay } = await deletePact(sessionId, pactId);
    return jsonOk({
      deleted: true,
      tombstone: { id: pact.id, deletedAt: pact.deletedAt, seal: pact.seal },
      replay,
      note: "The row is tombstoned and its seal chain is retained; replay still verifies.",
      meta: meta(),
    });
  } catch (error) {
    return handleError(error);
  }
}