import type { NextRequest } from "next/server";
import { handleError, ServiceError } from "@/lib/api-helpers";
import { getSessionId, isUuid } from "@/lib/session";
import { getPactDetail } from "@/lib/service";
import { renderCareCard, renderCareCardHtml } from "@/lib/export";

export const dynamic = "force-dynamic";

/**
 * GET /api/pacts/[id]/card - the takeaway artifact.
 *
 * Default response is the Markdown care card as a file download, which is the
 * form you paste into a message. ?format=html returns a standalone printable
 * page that anyone can open without this app.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const sessionId = await getSessionId();
    const { id } = await context.params;
    if (!isUuid(id)) throw new ServiceError("invalid_id", "That pact id is not valid.", 400);

    const detail = await getPactDetail(sessionId, id);
    if (!detail.verdict || !detail.sky) {
      throw new ServiceError(
        "unavailable",
        "The care card needs a scored verdict, which this pact does not have.",
        409,
      );
    }

    const slug = detail.pact.plantLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "plant";

    const format = request.nextUrl.searchParams.get("format") ?? "markdown";

    if (format === "html") {
      return new Response(renderCareCardHtml(detail.pact, detail.verdict, detail.sky), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Disposition": `inline; filename="care-card-${slug}.html"`,
        },
      });
    }

    const markdown = renderCareCard(detail.pact, detail.verdict, detail.sky);
    return new Response(markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="care-card-${slug}.md"`,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}