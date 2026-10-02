import type { Metadata } from "next";
import { Suspense } from "react";
import { listPacts } from "@/lib/service";
import { getSessionId } from "@/lib/session";
import { PactsWorkspace } from "@/components/pacts-workspace";
import { LoadingState } from "@/components/ui";
import type { PactStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Ledge",
  description:
    "Every plant pact you have committed: survival odds, largest risk factor, check-back date and one-click deletion with a retained audit chain.",
  alternates: { canonical: "/pacts" },
};

export default async function PactsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sessionId = await getSessionId();
  const { status } = await searchParams;
  const valid = status === "committed" || status === "fulfilled" || status === "called";
  const { pacts, total } = await listPacts(sessionId, {
    limit: 50,
    offset: 0,
    status: valid ? (status as PactStatus) : undefined,
    includeDeleted: false,
  });

  return (
    <div className="pb-8">
      <Suspense fallback={<LoadingState label="Loading your pacts" />}>
        <PactsWorkspace initial={pacts} total={total} />
      </Suspense>
    </div>
  );
}