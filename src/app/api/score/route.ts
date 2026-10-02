import type { NextRequest } from "next/server";
import { handleError, jsonOk, meta, readJson, ServiceError } from "@/lib/api-helpers";
import { getSessionId } from "@/lib/session";
import { scorePlacement } from "@/lib/service";
import { parsePlacement } from "@/lib/validation";
import { checkRate } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/score - analysis without persistence.
 *
 * This is the endpoint the advisor screen calls while a visitor drags the
 * window slider. It runs the same engine, the same feature extractor and the
 * same weights as the pact commit path, and the same function as the MCP
 * `score_placement` tool. It writes nothing, which is why it is safe to call on
 * every slider move.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const sessionId = await getSessionId();
    const rate = checkRate(`score:${sessionId}`, 240);
    if (!rate.allowed) {
      throw new ServiceError(
        "rate_limited",
        `Too many scoring requests from this session. Retry in ${rate.retryAfterSeconds}s.`,
        429,
      );
    }

    const placement = parsePlacement(await readJson(request));
    const { verdict, species, sky } = await scorePlacement(placement);
    return jsonOk({ verdict, species, sky, persisted: false, meta: meta() });
  } catch (error) {
    return handleError(error);
  }
}