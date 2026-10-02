"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { PactRow } from "@/lib/types";
import { EmptyState, ErrorState, SectionHeading } from "./ui";
import { Button } from "./ui";

/**
 * The Ledge: every pact this session owns, as a horizontal rail of plant tags.
 *
 * Filter and status live in the URL, so a filtered view is shareable and
 * survives a refresh. Deletion goes through the API and then removes the row
 * from the rail; a failed delete leaves the row untouched and says why.
 */

const FILTERS = [
  { value: "all", label: "all" },
  { value: "committed", label: "live pacts" },
  { value: "fulfilled", label: "fulfilled" },
  { value: "called", label: "called" },
] as const;

function ProbabilityMark({ value }: { value: number }) {
  const tone =
    value >= 0.7
      ? "border-leaf/40 bg-leaf-wash text-leaf-deep"
      : value >= 0.35
        ? "border-warn/40 bg-warn-wash text-warn"
        : "border-risk/40 bg-risk-wash text-risk";
  return (
    <span
      className={`num inline-flex rounded-full border px-2 py-0.5 text-xs ${tone}`}
      title={`Predicted chance of surviving the full commitment`}
    >
      {Math.round(value * 100)}%
    </span>
  );
}

function DueLabel({ dueDate, status }: { dueDate: string; status: PactRow["status"] }) {
  if (status !== "committed") {
    return <span className="num text-[11px] uppercase tracking-[0.12em] text-loam-faint">{status}</span>;
  }
  const today = new Date().toISOString().slice(0, 10);
  const overdue = dueDate < today;
  return (
    <span
      className={`num text-[11px] uppercase tracking-[0.12em] ${overdue ? "text-clay" : "text-loam-faint"}`}
    >
      {overdue ? "check back · " : "due "}
      {dueDate}
    </span>
  );
}

export function PactsWorkspace({ initial, total }: { initial: PactRow[]; total: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get("status") ?? "all";
  const [rows, setRows] = useState<PactRow[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setStatus(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next === "all") query.delete("status");
    else query.set("status", next);
    router.replace(`/pacts${query.toString() ? `?${query}` : ""}`);
  }

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/pacts/${id}`, { method: "DELETE" });
      const body = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setError(body.error?.message ?? "The pact could not be deleted.");
        return;
      }
      setRows((current) => current.filter((row) => row.id !== id));
      router.refresh();
    } catch {
      setError("Could not reach the server. The pact was not deleted.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <SectionHeading
        label="The ledge"
        title="Pacts you have committed to"
        lede={`${rows.length} shown of ${total} in this session. Each tag is a prediction you agreed to test; the date is when you are asked how it went.`}
        action={
          <Link
            href="/advisor"
            className="inline-flex items-center rounded-[4px] border border-clay bg-clay px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-plaster no-underline hover:bg-clay-deep"
          >
            Commit another
          </Link>
        }
      />

      <div
        className="mb-5 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter pacts by status"
      >
        {FILTERS.map((filter) => {
          const active = status === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                active
                  ? "border-clay bg-clay-wash text-clay-deep"
                  : "border-edge bg-plaster text-loam-soft hover:border-loam-faint"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="mb-5">
          <ErrorState body={error} />
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title={status === "all" ? "Nothing committed yet" : `No ${status} pacts`}
          body={
            status === "all"
              ? "Pick a plant, name the window, and commit the first pact. It takes about ten seconds and it will be waiting here with its odds and its due date."
              : "Nothing matches this filter. Try another filter, or commit a new pact."
          }
          action={
            status === "all" ? (
              <Link
                href="/advisor"
                className="inline-flex items-center rounded-[4px] border border-clay bg-clay px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-plaster no-underline hover:bg-clay-deep"
              >
                Place a plant
              </Link>
            ) : (
              <Button variant="secondary" onClick={() => setStatus("all")}>
                Show everything
              </Button>
            )
          }
        />
      ) : (
        <ul
          className="flex snap-x gap-3 overflow-x-auto pb-3"
          data-testid="pact-rail"
        >
          {rows.map((pact) => (
            <li key={pact.id} className="w-[17rem] shrink-0 snap-start">
              <article className="tag focus-ring flex h-full flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[1.1rem] leading-tight">{pact.plantLabel}</p>
                    <p className="truncate text-xs italic text-loam-faint">
                      {pact.species?.scientificName}
                    </p>
                  </div>
                  <ProbabilityMark value={pact.probability} />
                </div>

                <dl className="mt-3 space-y-1 text-xs">
                  {[
                    ["For", pact.friendName],
                    ["Where", pact.placeLabel],
                    ["Sill", `${pact.windowLabel} · ${pact.windowHours} h · every ${pact.wateringDays} d`],
                  ].map(([term, definition]) => (
                    <div key={term} className="flex justify-between gap-2">
                      <dt className="shrink-0 text-loam-faint">{term}</dt>
                      <dd className="truncate text-right text-loam-soft">{definition}</dd>
                    </div>
                  ))}
                </dl>

                <p className="mt-3 border-l-2 border-clay/50 pl-2.5 text-xs leading-relaxed text-loam-soft">
                  {pact.killerNote}
                </p>

                <div className="mt-auto pt-4">
                  <DueLabel dueDate={pact.dueDate} status={pact.status} />
                  <div className="mt-2.5 flex items-center gap-2">
                    <Link
                      href={`/pacts/${pact.id}`}
                      className="inline-flex flex-1 items-center justify-center rounded-[3px] border border-edge bg-shell px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-loam no-underline hover:border-clay hover:text-clay"
                    >
                      Open
                    </Link>
                    <Button
                      variant="danger"
                      onClick={() => void remove(pact.id)}
                      disabled={busy === pact.id}
                      aria-label={`Delete the pact for ${pact.plantLabel}`}
                    >
                      {busy === pact.id ? "…" : "Delete"}
                    </Button>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-loam-faint">
          Deleting keeps the audit chain. The pact stops appearing here, but{" "}
          <Link href="/verify" className="underline decoration-edge underline-offset-2 hover:text-clay">
            its seal chain still replays
          </Link>
          , so the deletion is provable rather than invisible.
        </p>
      ) : null}
    </div>
  );
}