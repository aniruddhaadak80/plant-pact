import { NextResponse } from "next/server";
import { getRepository, currentStoreKind } from "@/lib/db";
import { SITE, siteOrigin } from "@/lib/config";
import { listSpecies } from "@/lib/service";
import { ENGINE_VERSION, ALERT_THRESHOLD } from "@/lib/engine/verdict";
import { MODEL_VERSION, MODEL_CARD } from "@/lib/model/infer";

export const dynamic = "force-dynamic";

/**
 * Health check that verifies the real persistence path.
 *
 * It runs SELECT 1 against whichever adapter is active, counts seeded species
 * and stored pacts, and reports which adapter answered. A static success object
 * would defeat the purpose: this endpoint exists so a deployment with a broken
 * or missing database is visibly broken.
 */
export async function GET(): Promise<NextResponse> {
  const base = {
    status: "ok",
    checkedAt: new Date().toISOString(),
    adapter: currentStoreKind(),
    engineVersion: ENGINE_VERSION,
    modelVersion: MODEL_VERSION,
    alertThreshold: ALERT_THRESHOLD,
    origin: siteOrigin(),
    repository: SITE.repositoryUrl,
  };

  try {
    const repo = await getRepository();
    const probe = await repo.healthCheck();
    const species = await listSpecies();

    if (!probe.ok) {
      return NextResponse.json(
        {
          ...base,
          status: "degraded",
          persistence: { ok: false, adapter: repo.kind, detail: probe.detail, checkedAt: probe.checkedAt },
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        ...base,
        status: "ok",
        persistence: { ok: true, adapter: repo.kind, schema: repo.schema, detail: probe.detail, checkedAt: probe.checkedAt },
        speciesSeeded: species.length,
        model: {
          version: MODEL_VERSION,
          features: MODEL_CARD.features.length,
          corpusRows: MODEL_CARD.corpus.rows,
          holdoutAuc: MODEL_CARD.metrics.holdoutAuc,
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ...base,
        status: "unavailable",
        persistence: {
          ok: false,
          adapter: currentStoreKind(),
          detail: error instanceof Error ? error.message : "repository unavailable",
          checkedAt: new Date().toISOString(),
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}