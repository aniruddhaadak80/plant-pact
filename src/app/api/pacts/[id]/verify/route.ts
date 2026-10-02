import type { NextRequest } from "next/server";
import { handleError, jsonOk, meta, ServiceError } from "@/lib/api-helpers";
import { getSessionId, isUuid } from "@/lib/session";
import { verifyPact } from "@/lib/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/pacts/[id]/verify - integrity replay.
 *
 * Recomputes every SHA-384 seal in the pact's chain from the genesis value and
 * reports the first sequence number that fails to verify, or a clean pass with
 * the head seal. Replays work on tombstoned pacts too, which is how a deletion
 * stays provable.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const sessionId = await getSessionId();
    const { id } = await context.params;
    if (!isUuid(id)) throw new ServiceError("invalid_id", "That pact id is not valid.", 400);

    const replay = await verifyPact(sessionId, id);
    return jsonOk({ replay, meta: meta() });
  } catch (error) {
    return handleError(error);
  }
}