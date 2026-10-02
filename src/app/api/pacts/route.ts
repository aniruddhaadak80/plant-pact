import type { NextRequest } from "next/server";
import { handleError, jsonCreated, jsonOk, meta, readJson, ServiceError } from "@/lib/api-helpers";
import { getSessionId } from "@/lib/session";
import { commitPact, listPacts } from "@/lib/service";
import { parseIdempotencyKey, parsePlacement } from "@/lib/validation";
import { checkRate, pruneRateStore } from "@/lib/rate-limit";
import type { PactStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;

function parseQuery(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limitRaw = Number(params.get("limit") ?? 20);
  const offsetRaw = Number(params.get("offset") ?? 0);
  const limit = Number.isFinite(limitRaw) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw))) : 20;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

  const statusParam = params.get("status");
  let status: PactStatus | undefined;
  if (statusParam && statusParam !== "all") {
    if (!["committed", "fulfilled", "called"].includes(statusParam)) {
      throw new ServiceError(
        "invalid_field",
        "status must be one of: committed, fulfilled, called, all.",
        400,
      );
    }
    status = statusParam as PactStatus;
  }

  const species = params.get("species");
  return {
    limit,
    offset,
    status,
    speciesSlug: species && species.length <= 80 ? species : undefined,
    includeDeleted: false,
  };
}

/** GET /api/pacts - the caller's own pacts, newest first, bounded and filtered. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const sessionId = await getSessionId();
    const query = parseQuery(request);
    const { pacts, total } = await listPacts(sessionId, query);
    return jsonOk({ pacts, total, limit: query.limit, offset: query.offset, meta: meta() });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/pacts - commit a pact.
 *
 * Scores the placement against live weather, persists it, and appends the
 * creation event to the seal chain in the same transaction. Supplying an
 * Idempotency-Key header (or body field) makes the call safe to retry: the
 * stored pact is returned with created=false instead of a second pact.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const sessionId = await getSessionId();
    pruneRateStore();
    const rate = checkRate(`write:${sessionId}`, 20);
    if (!rate.allowed) {
      throw new ServiceError(
        "rate_limited",
        `Too many writes from this session. Retry in ${rate.retryAfterSeconds}s.`,
        429,
      );
    }

    const body = await readJson(request);
    const placement = parsePlacement(body);
    const idempotencyKey = parseIdempotencyKey(request, body);
    const result = await commitPact(sessionId, placement, idempotencyKey);

    if (!result.created) return jsonOk({ ...result, meta: meta() });
    return jsonCreated({ ...result, meta: meta() });
  } catch (error) {
    return handleError(error);
  }
}