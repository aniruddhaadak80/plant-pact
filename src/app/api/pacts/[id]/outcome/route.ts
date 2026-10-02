import type { NextRequest } from "next/server";
import { handleError, jsonOk, meta, readJson, ServiceError } from "@/lib/api-helpers";
import { getSessionId, isUuid } from "@/lib/session";
import { recordOutcome } from "@/lib/service";
import { parseOutcome } from "@/lib/validation";
import { checkRate } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/pacts/[id]/outcome - close the loop.
 *
 * Records what actually happened to the plant, which is the only way the
 * product's predictions ever get tested. Writes an "outcome_recorded" event,
 * closes the pact (fulfilled for survived, called for struggled or died), and
 * returns the refreshed chain replay so the caller sees the new head seal.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const sessionId = await getSessionId();
    const { id } = await context.params;
    if (!isUuid(id)) throw new ServiceError("invalid_id", "That pact id is not valid.", 400);

    const rate = checkRate(`write:${sessionId}`, 20);
    if (!rate.allowed) {
      throw new ServiceError(
        "rate_limited",
        `Too many writes from this session. Retry in ${rate.retryAfterSeconds}s.`,
        429,
      );
    }

    const { outcome, day, note } = parseOutcome(await readJson(request));
    const { pact, replay } = await recordOutcome(sessionId, id, outcome, day, note);
    return jsonOk({ pact, replay, meta: meta() });
  } catch (error) {
    return handleError(error);
  }
}