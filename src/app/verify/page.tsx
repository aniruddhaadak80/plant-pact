import type { Metadata } from "next";
import { listPacts } from "@/lib/service";
import { getSessionId } from "@/lib/session";
import { VerifyPanel } from "@/components/verify-panel";
import { SectionHeading } from "@/components/ui";
import { GENESIS_SEAL, SEAL_ALGORITHM } from "@/lib/integrity/chain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify",
  description:
    "Replay any pact's SHA-384 seal chain from its genesis value and find the first sequence that fails to verify, including on deleted pacts.",
  alternates: { canonical: "/verify" },
};

export default async function VerifyPage() {
  const sessionId = await getSessionId();
  const { pacts } = await listPacts(sessionId, {
    limit: 20,
    offset: 0,
    includeDeleted: false,
  });

  return (
    <div className="pb-8">
      <SectionHeading
        label="Integrity"
        title="Replay a seal chain"
        lede={`Every pact carries an append-only chain sealed with ${SEAL_ALGORITHM}, beginning from a fixed genesis value. Replaying it recomputes each digest and names the first sequence that does not match.`}
      />
      <VerifyPanel
        recent={pacts.map((pact) => ({
          id: pact.id,
          label: `${pact.plantLabel} · ${pact.friendName}`,
        }))}
      />
      <p className="mt-8 max-w-3xl text-xs leading-relaxed text-loam-faint">
        Genesis value <span className="num">{GENESIS_SEAL}</span>. A chain with no events is
        reported as broken rather than vacuously valid, so an empty audit trail can never be
        mistaken for a verified one.
      </p>
    </div>
  );
}