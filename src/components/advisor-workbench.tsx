"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EngineVerdict, SkyBundle, SpeciesProfile, TaxonomyMatch } from "@/lib/types";
import { FEATURE_LABELS } from "@/lib/model/features";
import { ALERT_THRESHOLD } from "@/lib/engine/verdict";
import { Button, ErrorState, Field, OriginBadge, inputClass } from "./ui";
import { FactorLedger } from "./factor-ledger";
import { VerdictDial } from "./verdict-dial";

/**
 * The placement workbench.
 *
 * This is the product's signature interaction: two rails that describe the sill
 * (light hours and watering gap) which re-score the placement against live
 * weather on every change. Nothing here is a preview of a stored value - each
 * drag is a real POST to /api/score, which runs the same engine the commit and
 * the MCP tools use.
 */

interface ScoreResponse {
  verdict: EngineVerdict;
  species: SpeciesProfile;
  sky: SkyBundle;
}

interface Props {
  species: SpeciesProfile[];
  cities: { label: string; latitude: number; longitude: number }[];
  defaultCityIndex: number;
}

type Status = "idle" | "loading" | "ready" | "error";

function Rail({
  label,
  value,
  min,
  max,
  step,
  unit,
  hint,
  band,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint: string;
  /** [from, to] region of the track that is comfortable, when known. */
  band?: [number, number];
  onChange: (next: number) => void;
  testId: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const bandStyle = band
    ? {
        left: `${((band[0] - min) / (max - min)) * 100}%`,
        width: `${((band[1] - band[0]) / (max - min)) * 100}%`,
      }
    : undefined;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="label-mono" htmlFor={testId}>
          {label}
        </label>
        <span className="num text-sm text-loam" data-testid={`${testId}-value`}>
          {value.toFixed(step < 1 ? 1 : 0)}
          <span className="ml-0.5 text-loam-faint">{unit}</span>
        </span>
      </div>

      <div className="relative mt-2 h-8">
        <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-edge" aria-hidden="true" />
        {bandStyle ? (
          <div
            className="absolute top-3 h-2 rounded-full bg-leaf/35"
            style={bandStyle}
            aria-hidden="true"
            data-testid={`${testId}-band`}
          />
        ) : null}
        <div
          className="absolute top-3 h-2 rounded-full bg-clay"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          aria-hidden="true"
        />
        <input
          id={testId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="relative z-10 h-8 w-full cursor-grab appearance-none bg-transparent accent-clay focus:outline-none focus-visible:outline-2 focus-visible:outline-clay focus-visible:outline-offset-2"
          aria-describedby={`${testId}-hint`}
        />
      </div>
      <p id={`${testId}-hint`} className="text-xs leading-relaxed text-loam-faint">
        {hint}
      </p>
    </div>
  );
}

export function AdvisorWorkbench({ species, cities, defaultCityIndex }: Props) {
  const router = useRouter();
  const [speciesSlug, setSpeciesSlug] = useState(species[0]?.slug ?? "");
  const [plantLabel, setPlantLabel] = useState("the office one");
  const [friendName, setFriendName] = useState("");
  const [cityIndex, setCityIndex] = useState(defaultCityIndex);
  const [windowLabel, setWindowLabel] = useState("front room window");
  const [aspect, setAspect] = useState("unknown");
  const [windowHours, setWindowHours] = useState(4);
  const [wateringDays, setWateringDays] = useState(9);
  const [careLevel, setCareLevel] = useState("weekly");
  const [petsPresent, setPetsPresent] = useState(false);
  const [commitmentDays, setCommitmentDays] = useState(90);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<EngineVerdict | null>(null);
  const [sky, setSky] = useState<SkyBundle | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const [taxQuery, setTaxQuery] = useState("");
  const [taxResult, setTaxResult] = useState<TaxonomyMatch | null>(null);
  const [taxSearching, setTaxSearching] = useState(false);

  // Generated lazily on the first commit rather than during render, so a retry
  // of the same submission reuses one key and cannot create a second pact.
  const idempotencyKey = useRef<string | null>(null);

  const selected = useMemo(
    () => species.find((s) => s.slug === speciesSlug) ?? species[0],
    [species, speciesSlug],
  );
  const city = cities[cityIndex] ?? cities[0];

  const payload = useMemo(
    () => ({
      speciesSlug,
      plantLabel: plantLabel.trim() || "unnamed plant",
      friendName: friendName.trim() || "a friend",
      placeLabel: city.label,
      latitude: city.latitude,
      longitude: city.longitude,
      windowLabel: windowLabel.trim() || "a window",
      windowAspect: aspect,
      windowHours,
      wateringDays,
      careLevel,
      petsPresent,
      commitmentDays,
    }),
    [
      speciesSlug,
      plantLabel,
      friendName,
      city,
      windowLabel,
      aspect,
      windowHours,
      wateringDays,
      careLevel,
      petsPresent,
      commitmentDays,
    ],
  );

  const runScore = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as ScoreResponse & { error?: { message: string } };
      if (!response.ok) {
        setStatus("error");
        setError(body.error?.message ?? "The placement could not be scored.");
        return;
      }
      setVerdict(body.verdict);
      setSky(body.sky);
      setStatus("ready");
    } catch {
      setStatus("error");
      setError("Could not reach the scoring endpoint. Check your connection and try again.");
    }
  }, [payload]);

  // Debounced live re-score. Every slider move hits the real engine.
  useEffect(() => {
    const timer = setTimeout(() => {
      void runScore();
    }, 300);
    return () => clearTimeout(timer);
  }, [runScore]);

  async function commit() {
    setCommitting(true);
    setCommitError(null);
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    try {
      const response = await fetch("/api/pacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as {
        pact?: { id: string };
        created?: boolean;
        error?: { message: string };
      };
      if (!response.ok || !body.pact) {
        setCommitError(body.error?.message ?? "The pact could not be committed.");
        setCommitting(false);
        return;
      }
      router.push(`/pacts/${body.pact.id}?committed=${body.created ? "1" : "0"}`);
    } catch {
      setCommitError("Could not reach the server. The pact was not committed.");
      setCommitting(false);
    }
  }

  async function searchTaxonomy() {
    const query = taxQuery.trim();
    if (query.length < 2) return;
    setTaxSearching(true);
    setTaxResult(null);
    try {
      const response = await fetch(`/api/species?q=${encodeURIComponent(query)}`);
      const body = (await response.json()) as { match: TaxonomyMatch | null };
      if (body.match) {
        setTaxResult(body.match);
        const hit = species.find(
          (s) => s.scientificName.toLowerCase() === body.match!.canonicalName.toLowerCase(),
        );
        if (hit) setSpeciesSlug(hit.slug);
      } else {
        setTaxResult(null);
      }
    } finally {
      setTaxSearching(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      {/* ---------------- inputs ---------------- */}
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
        aria-label="Placement inputs"
      >
        <div className="tag p-4">
          <p className="label-mono">1 · The plant</p>
          <div className="mt-2.5 space-y-3">
            <Field label="Species" htmlFor="species" hint={selected?.note}>
              <select
                id="species"
                className={inputClass}
                value={speciesSlug}
                onChange={(event) => setSpeciesSlug(event.target.value)}
              >
                {species.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.commonName} — {item.scientificName}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="What you call it"
              htmlFor="plant-label"
              hint="This is the name on the pact and on the care card."
            >
              <input
                id="plant-label"
                className={inputClass}
                value={plantLabel}
                onChange={(event) => setPlantLabel(event.target.value)}
                placeholder="the office one"
                maxLength={60}
              />
            </Field>

            {selected ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {[
                  ["Light band", `${selected.minLightHours}–${selected.maxLightHours} h`],
                  ["Comfort", `${selected.minTempC}–${selected.maxTempC} °C`],
                  ["Watering", `every ${selected.waterDays} d`],
                  ["Difficulty", selected.difficulty],
                  ["Family", selected.family],
                  ["Toxic", selected.toxic ? "yes — keep out of reach" : "no flag"],
                ].map(([term, definition]) => (
                  <div key={term} className="flex justify-between gap-2 border-b border-edge-soft pb-1">
                    <dt className="text-loam-faint">{term}</dt>
                    <dd className="num text-right text-loam-soft">{definition}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </div>

        <div className="tag p-4">
          <p className="label-mono">2 · Who is looking after it</p>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
            <Field label="Friend" htmlFor="friend">
              <input
                id="friend"
                className={inputClass}
                value={friendName}
                onChange={(event) => setFriendName(event.target.value)}
                placeholder="Maya"
                maxLength={60}
              />
            </Field>
            <Field label="Their city" htmlFor="city">
              <select
                id="city"
                className={inputClass}
                value={cityIndex}
                onChange={(event) => setCityIndex(Number(event.target.value))}
              >
                {cities.map((item, index) => (
                  <option key={item.label} value={index}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="The window" htmlFor="windowLabel">
              <input
                id="windowLabel"
                className={inputClass}
                value={windowLabel}
                onChange={(event) => setWindowLabel(event.target.value)}
                placeholder="bedroom, first floor"
                maxLength={60}
              />
            </Field>
            <Field label="Facing" htmlFor="aspect">
              <select
                id="aspect"
                className={inputClass}
                value={aspect}
                onChange={(event) => setAspect(event.target.value)}
              >
                {["unknown", "north", "east", "south", "west"].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Care routine" htmlFor="care">
              <select
                id="care"
                className={inputClass}
                value={careLevel}
                onChange={(event) => setCareLevel(event.target.value)}
              >
                <option value="forgetful">forgetful — weeks go by</option>
                <option value="weekly">weekly — a proper routine</option>
                <option value="diligent">diligent — checked constantly</option>
              </select>
            </Field>
            <Field label="Commit for" htmlFor="commitment">
              <select
                id="commitment"
                className={inputClass}
                value={commitmentDays}
                onChange={(event) => setCommitmentDays(Number(event.target.value))}
              >
                {[30, 60, 90, 120, 180].map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={petsPresent}
                onChange={(event) => setPetsPresent(event.target.checked)}
                className="h-4 w-4 accent-clay"
              />
              Pets or small children live there
            </label>
          </div>
        </div>

        <div className="tag p-4">
          <p className="label-mono">3 · The sill profile</p>
          <div className="mt-3 space-y-5">
            <Rail
              testId="window-hours"
              label="Direct light on the sill"
              value={windowHours}
              min={0}
              max={14}
              step={0.5}
              unit="h/day"
              hint={
                selected
                  ? `Drag to match the window. The green band is this species' ${selected.minLightHours}–${selected.maxLightHours} h range.`
                  : "Drag to match the window."
              }
              band={selected ? [selected.minLightHours, selected.maxLightHours] : undefined}
              onChange={setWindowHours}
            />
            <Rail
              testId="watering-days"
              label="Days between waterings"
              value={wateringDays}
              min={1}
              max={30}
              step={1}
              unit="days"
              hint={
                selected
                  ? `What the recipient will really do, not what the plant wants (${selected.waterDays} d).`
                  : "How often they will really water."
              }
              band={selected ? [selected.waterDays - selected.waterToleranceDays, selected.waterDays + selected.waterToleranceDays] : undefined}
              onChange={setWateringDays}
            />
          </div>
        </div>

        <div className="tag p-4">
          <p className="label-mono">4 · Not in the catalogue?</p>
          <div className="mt-2.5 flex gap-2">
            <input
              className={inputClass}
              value={taxQuery}
              onChange={(event) => setTaxQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void searchTaxonomy();
                }
              }}
              placeholder="Scientific or common name"
              aria-label="Search the GBIF Backbone Taxonomy"
              maxLength={120}
            />
            <Button type="button" variant="secondary" onClick={() => void searchTaxonomy()}>
              {taxSearching ? "Looking…" : "Resolve"}
            </Button>
          </div>
          {taxResult ? (
            <div className="mt-3 rounded-[3px] border border-edge bg-shell p-3 text-xs leading-relaxed">
              <div className="flex items-center justify-between gap-2">
                <span className="num text-sm italic">{taxResult.scientificName}</span>
                <OriginBadge origin={taxResult.origin} />
              </div>
              <p className="mt-1 text-loam-soft">
                {taxResult.family ?? "family unknown"} · {taxResult.rank ?? "rank unknown"} ·{" "}
                {taxResult.status ?? "status unknown"}
                {taxResult.usageKey ? ` · GBIF ${taxResult.usageKey}` : ""}
              </p>
              {taxResult.note ? <p className="mt-1 text-warn">{taxResult.note}</p> : null}
            </div>
          ) : null}
        </div>

        {commitError ? <ErrorState body={commitError} /> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={committing || status === "loading"}>
            {committing ? "Committing…" : "Commit this pact"}
          </Button>
          {status === "loading" ? (
            <span className="label-mono" data-testid="advisor-loading">
              scoring against live weather…
            </span>
          ) : (
            <span className="label-mono" data-testid="advisor-status">
              {status === "ready" ? "live score" : status}
            </span>
          )}
        </div>
      </form>

      {/* ---------------- live verdict ---------------- */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        {status === "error" && error ? (
          <ErrorState
            title="The placement could not be scored"
            body={error}
            action={
              <Button type="button" variant="secondary" onClick={() => void runScore()}>
                Try again
              </Button>
            }
          />
        ) : !verdict ? (
          <div className="tag px-5 py-8" role="status" aria-live="polite" data-testid="advisor-empty">
            <p className="label-mono">Waiting for the first score</p>
            <p className="mt-2 text-sm leading-relaxed text-loam-soft">
              As soon as you move a rail, this panel shows the survival odds, the single
              largest risk factor and the date the projection turns.
            </p>
          </div>
        ) : (
          <div className="space-y-4" data-testid="advisor-verdict">
            <VerdictDial verdict={verdict} />

            <div className="tag p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="label-mono">Weather behind this score</p>
                {sky ? <OriginBadge origin={sky.origin} /> : null}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-loam-soft">
                {verdict.recommendation}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-loam-soft">
                {verdict.recommendationDetail}
              </p>
              {sky?.origin !== "live" && sky?.note ? (
                <p className="mt-2 rounded-[3px] bg-warn-wash px-2.5 py-2 font-mono text-[11px] leading-relaxed text-warn">
                  {sky.note}
                </p>
              ) : null}
            </div>

            <FactorLedger verdict={verdict} compact />

            {verdict.alerts.length > 0 ? (
              <ul className="space-y-2" data-testid="advisor-alerts">
                {verdict.alerts.map((alert) => (
                  <li
                    key={alert}
                    className="rounded-[3px] border border-warn/40 bg-warn-wash px-3 py-2 text-xs leading-relaxed text-loam-soft"
                  >
                    {alert}
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="text-xs leading-relaxed text-loam-faint">
              Alert threshold {Math.round(ALERT_THRESHOLD * 100)}% survival. Engine{" "}
              <span className="num">{verdict.engineVersion}</span>, model{" "}
              <span className="num">{verdict.modelVersion}</span>.{" "}
              {FEATURE_LABELS[verdict.model.killer]} is the largest risk below.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}