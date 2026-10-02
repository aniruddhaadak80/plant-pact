"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReplayReport } from "@/lib/types";
import { Button, Field, inputClass, ErrorState } from "./ui";
import { GENESIS_SEAL, SEAL_ALGORITHM } from "@/lib/integrity/chain";
import { canonicalJson } from "@/lib/integrity/chain";

/**
 * Integrity replay UI.
 *
 * Takes a pact id and replays its chain from the genesis value, reporting the
 * first sequence that fails to verify. It works on tombstoned pacts, which is
 * how a deletion stays provable.
 */
export function VerifyPanel({ recent }: { recent: { id: string; label: string }[] }) {
  const [pactId, setPactId] = useState(recent[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ReplayReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    const id = pactId.trim();
    if (!id) {
      setError("Paste a pact id to replay its chain.");
      return;
    }
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const response = await fetch(`/api/pacts/${id}/verify`);
      const body = (await response.json()) as {
        replay?: ReplayReport;
        error?: { message: string };
      };
      if (!response.ok || !body.replay) {
        setError(body.error?.message ?? "That pact could not be read in this session.");
        return;
      }
      setReport(body.replay);
    } catch {
      setError("Could not reach the verification endpoint.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <form
          className="tag p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
        >
          <p className="label-mono">Replay a chain</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <Field label="Pact id" htmlFor="pact-id">
                <input
                  id="pact-id"
                  className={inputClass}
                  value={pactId}
                  onChange={(event) => setPactId(event.target.value)}
                  placeholder="00000000-0000-4000-8000-000000000000"
                />
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Replaying…" : "Verify"}
            </Button>
          </div>
        </form>

        {error ? <ErrorState body={error} /> : null}

        {report ? (
          <section className="tag p-5" data-testid="verify-report" data-ok={report.ok}>
            <div className="flex items-center justify-between gap-3">
              <p className="label-mono">Replay result</p>
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                  report.ok
                    ? "border-leaf/40 bg-leaf-wash text-leaf-deep"
                    : "border-risk/40 bg-risk-wash text-risk"
                }`}
              >
                {report.ok ? "chain intact" : "chain broken"}
              </span>
            </div>
            <p className="mt-2.5 text-sm leading-relaxed text-loam-soft">
              {report.ok ? (
                <>
                  All {report.events} events recomputed to the same{" "}
                  {SEAL_ALGORITHM} digest. Nothing has been altered, reordered, inserted or
                  removed since the pact was committed.
                </>
              ) : (
                <>
                  Replay stopped at sequence{" "}
                  <strong className="num text-risk">{report.brokenAtSeq}</strong>: {report.reason}.
                </>
              )}
            </p>
            <dl className="mt-3">
              {[
                ["events", report.events],
                ["verified at", report.verifiedAt.slice(0, 19).replace("T", " ") + " utc"],
                ["genesis", `${GENESIS_SEAL.slice(0, 24)}…`],
                ["head seal", report.headSeal ? `${report.headSeal.slice(0, 24)}…` : "—"],
              ].map(([term, definition]) => (
                <div
                  key={term as string}
                  className="flex justify-between gap-3 border-b border-edge-soft py-1.5"
                >
                  <dt className="label-mono pt-0.5">{term}</dt>
                  <dd className="num text-right text-xs text-loam-soft">{definition}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : (
          <section className="tag px-5 py-8" data-testid="verify-empty">
            <p className="label-mono">No replay run yet</p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-loam-soft">
              Verification is scoped to your session, so paste the id of one of your own pacts.
              Each seal is <span className="num">{SEAL_ALGORITHM}</span> over key-sorted JSON,
              chained from a fixed genesis value.
            </p>
          </section>
        )}

        <section className="tag p-4">
          <p className="label-mono">Canonical form</p>
          <p className="mt-2 text-xs leading-relaxed text-loam-soft">
            Keys are sorted recursively, array order is preserved,{" "}
            <span className="num">-0</span> is normalised to <span className="num">0</span>, and
            every value is serialised as UTF-8. That is what makes the digest reproducible rather
            than dependent on object construction order.
          </p>
          <pre className="num mt-2 overflow-x-auto rounded-[3px] border border-edge bg-shell px-3 py-2 text-[11px]">
{`${canonicalJson({
  seq: 1,
  eventType: "created",
  payload: { killer: "waterDry", probability: 0.42 },
  prevSeal: GENESIS_SEAL,
})}`}
          </pre>
        </section>
      </div>

      <aside className="tag h-fit p-4">
        <p className="label-mono">Your pacts</p>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed text-loam-soft">
            No pacts in this session yet.{" "}
            <Link href="/advisor" className="underline decoration-edge underline-offset-2 hover:text-clay">
              Commit one
            </Link>{" "}
            and it will appear here.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {recent.map((pact) => (
              <li key={pact.id}>
                <button
                  type="button"
                  onClick={() => setPactId(pact.id)}
                  className="w-full rounded-[3px] border border-transparent px-2 py-1.5 text-left text-sm text-loam-soft hover:border-edge hover:bg-shell"
                >
                  {pact.label}
                  <span className="num block text-[10px] text-loam-faint">{pact.id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}