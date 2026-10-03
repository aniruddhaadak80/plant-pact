"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Pact, PactOutcome, ReplayReport } from "@/lib/types";
import { Button, ErrorState, Field, inputClass } from "./ui";

/**
 * Every mutating control on a pact, in one place: adjust the placement,
 * record the outcome, delete the pact, and re-verify the chain.
 *
 * Each control calls the REST API, which calls the same service layer as the MCP
 * tools, and each reports the real failure. Nothing is optimistic: the UI only
 * reflects a change after the server confirms it, so a rollback is unnecessary
 * by construction.
 */

const OUTCOMES: { value: PactOutcome; label: string }[] = [
  { value: "survived", label: "Survived" },
  { value: "struggled", label: "Struggled but alive" },
  { value: "died", label: "Died" },
];

export function PactActions({
  pact,
  replay,
  committed,
}: {
  pact: Pact;
  replay: ReplayReport;
  committed?: boolean;
}) {
  const router = useRouter();
  const [windowHours, setWindowHours] = useState(pact.windowHours);
  const [wateringDays, setWateringDays] = useState(pact.wateringDays);
  const [outcome, setOutcome] = useState<PactOutcome>("survived");
  const [day, setDay] = useState<string>(String(pact.commitmentDays));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"adjust" | "outcome" | "delete" | "verify" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const closed = pact.status !== "committed";

  async function adjust() {
    setBusy("adjust");
    setMessage(null);
    try {
      const response = await fetch(`/api/pacts/${pact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowHours, wateringDays }),
      });
      const body = (await response.json()) as {
        pact?: { probability: number };
        error?: { message: string };
      };
      if (!response.ok || !body.pact) {
        setMessage({ tone: "bad", text: body.error?.message ?? "The change was not saved." });
        return;
      }
      setMessage({
        tone: "ok",
        text: `Placement re-scored and saved. Probability is now ${Math.round(body.pact.probability * 100)}%.`,
      });
      router.refresh();
    } catch {
      setMessage({ tone: "bad", text: "Could not reach the server. Nothing was changed." });
    } finally {
      setBusy(null);
    }
  }

  async function record() {
    setBusy("outcome");
    setMessage(null);
    try {
      const response = await fetch(`/api/pacts/${pact.id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, day: Number(day) || null, note: note.trim() || null }),
      });
      const body = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setMessage({ tone: "bad", text: body.error?.message ?? "The outcome was not recorded." });
        return;
      }
      setMessage({ tone: "ok", text: "Outcome recorded and the pact is closed." });
      router.refresh();
    } catch {
      setMessage({ tone: "bad", text: "Could not reach the server. Nothing was recorded." });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setMessage(null);
    try {
      const response = await fetch(`/api/pacts/${pact.id}`, { method: "DELETE" });
      const body = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setMessage({ tone: "bad", text: body.error?.message ?? "The pact was not deleted." });
        return;
      }
      router.push("/pacts");
    } catch {
      setMessage({ tone: "bad", text: "Could not reach the server. Nothing was deleted." });
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setBusy("verify");
    setMessage(null);
    try {
      const response = await fetch(`/api/pacts/${pact.id}/verify`);
      const body = (await response.json()) as {
        replay?: ReplayReport;
        error?: { message: string };
      };
      if (!response.ok || !body.replay) {
        setMessage({ tone: "bad", text: body.error?.message ?? "Verification failed." });
        return;
      }
      setMessage({
        tone: body.replay.ok ? "ok" : "bad",
        text: body.replay.ok
          ? `Chain verified: ${body.replay.events} events replay clean.`
          : `Chain broken at sequence ${body.replay.brokenAtSeq}: ${body.replay.reason}`,
      });
    } catch {
      setMessage({ tone: "bad", text: "Could not reach the verification endpoint." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      {committed ? (
        <div
          className="rounded-[3px] border border-leaf/40 bg-leaf-wash px-4 py-3"
          role="status"
          data-testid="commit-confirmation"
        >
          <p className="text-sm text-leaf-deep">
            Pact committed. The row and its seal were written together, and the care card is
            ready to send.
          </p>
        </div>
      ) : null}

      {/* Adjust */}
      <section className="tag p-4">
        <p className="label-mono">Change the placement</p>
        {closed ? (
          <p className="mt-2 text-sm leading-relaxed text-loam-soft">
            This pact is closed as <strong>{pact.status}</strong>, so the placement is frozen.
            That is deliberate: a prediction you keep editing after the fact is not a
            prediction.
          </p>
        ) : (
          <>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Light hours" htmlFor="adjust-light">
                <input
                  id="adjust-light"
                  type="range"
                  min={0}
                  max={14}
                  step={0.5}
                  value={windowHours}
                  onChange={(event) => setWindowHours(Number(event.target.value))}
                  className="w-full accent-clay"
                />
                <span className="num text-xs text-loam-soft">{windowHours.toFixed(1)} h/day</span>
              </Field>
              <Field label="Days between waterings" htmlFor="adjust-water">
                <input
                  id="adjust-water"
                  type="range"
                  min={1}
                  max={30}
                  step={1}
                  value={wateringDays}
                  onChange={(event) => setWateringDays(Number(event.target.value))}
                  className="w-full accent-clay"
                />
                <span className="num text-xs text-loam-soft">every {wateringDays} d</span>
              </Field>
            </div>
            <div className="mt-3">
              <Button onClick={() => void adjust()} disabled={busy === "adjust"}>
                {busy === "adjust" ? "Re-scoring…" : "Re-score and save"}
              </Button>
            </div>
          </>
        )}
      </section>

      {/* Outcome */}
      <section className="tag p-4">
        <p className="label-mono">Close the loop</p>
        {closed ? (
          <p className="mt-2 text-sm leading-relaxed text-loam-soft" data-testid="outcome-recorded">
            Recorded as <strong>{pact.outcome}</strong>
            {pact.outcomeDay !== null ? ` on day ${pact.outcomeDay}` : ""}.
            {pact.outcomeNote ? ` “${pact.outcomeNote}”` : ""}
          </p>
        ) : (
          <>
            <p className="mt-1.5 text-xs leading-relaxed text-loam-faint">
              You predicted {Math.round(pact.probability * 100)}% survival for{" "}
              {pact.commitmentDays} days. What actually happened?
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_6rem]">
              <Field label="Outcome" htmlFor="outcome">
                <select
                  id="outcome"
                  className={inputClass}
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value as PactOutcome)}
                >
                  {OUTCOMES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="On day" htmlFor="outcome-day">
                <input
                  id="outcome-day"
                  type="number"
                  min={0}
                  max={730}
                  className={inputClass}
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Note (optional)" htmlFor="outcome-note">
                <input
                  id="outcome-note"
                  className={inputClass}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="moved it off the radiator in week three"
                  maxLength={600}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Button onClick={() => void record()} disabled={busy === "outcome"}>
                {busy === "outcome" ? "Recording…" : "Record outcome"}
              </Button>
            </div>
          </>
        )}
      </section>

      {/* Takeaway */}
      <section className="tag p-4">
        <p className="label-mono">Take it away</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`/api/pacts/${pact.id}/card`}
            className="inline-flex items-center rounded-[4px] border border-clay bg-clay px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-plaster no-underline hover:bg-clay-deep"
            data-testid="card-download"
          >
            Download care card (md)
          </a>
          <a
            href={`/api/pacts/${pact.id}/card?format=html`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-[4px] border border-edge bg-plaster px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-loam no-underline hover:border-clay hover:text-clay"
            data-testid="card-html"
          >
            Open printable card
          </a>
        </div>
      </section>

      {/* Integrity + delete */}
      <section className="tag p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-mono">Seal chain</p>
            <p className="mt-1 text-xs text-loam-soft">
              {replay.events} event{replay.events === 1 ? "" : "s"} ·{" "}
              {replay.ok ? "replays clean" : `broken at seq ${replay.brokenAtSeq}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => void verify()}
              disabled={busy === "verify"}
              data-testid="verify-button"
            >
              {busy === "verify" ? "Verifying…" : "Verify chain"}
            </Button>
            <Button variant="danger" onClick={() => void remove()} disabled={busy === "delete"}>
              {busy === "delete" ? "Deleting…" : "Delete pact"}
            </Button>
          </div>
        </div>
        {pact.deletedAt ? (
          <p className="mt-2 text-xs text-loam-faint">
            Tombstoned {pact.deletedAt.slice(0, 10)}. The chain is retained and still
            verifiable.
          </p>
        ) : null}
      </section>

      {message ? (
        message.tone === "ok" ? (
          <p
            className="rounded-[3px] border border-leaf/40 bg-leaf-wash px-3 py-2 text-sm text-leaf-deep"
            role="status"
            data-testid="action-message"
          >
            {message.text}
          </p>
        ) : (
          <ErrorState body={message.text} />
        )
      ) : null}

      <p className="text-xs leading-relaxed text-loam-faint">
        Prefer an agent? The same operations are exposed as{" "}
        <Link href="/agent" className="underline decoration-edge underline-offset-2 hover:text-clay">
          MCP tools
        </Link>{" "}
        over JSON-RPC, scoped to this same session.
      </p>
    </div>
  );
}