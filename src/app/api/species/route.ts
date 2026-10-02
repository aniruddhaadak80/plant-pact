import type { NextRequest } from "next/server";
import { jsonOk, handleError } from "@/lib/api-helpers";
import { parseSpeciesQuery } from "@/lib/validation";
import { listSpecies } from "@/lib/service";
import { matchTaxon } from "@/lib/taxonomy/gbif";

export const dynamic = "force-dynamic";

/**
 * Species lookup.
 *
 * GET /api/species            -> the seeded catalogue with its taxonomy columns
 * GET /api/species?q=pothos   -> a live GBIF Backbone Taxonomy match for any
 *                                name, falling back to the bundled catalogue
 *                                (labelled origin="local-catalog") when the
 *                                upstream is unreachable.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const query = request.nextUrl.searchParams.get("q");
    if (!query) {
      const species = await listSpecies();
      return jsonOk({ origin: "catalogue", count: species.length, species });
    }

    const name = parseSpeciesQuery(query);
    const match = await matchTaxon(name);
    if (!match) {
      return jsonOk(
        { origin: "local-catalog", query: name, match: null, note: `Nothing matched "${name}".` },
      );
    }
    return jsonOk({ origin: match.origin, query: name, match });
  } catch (error) {
    return handleError(error);
  }
}