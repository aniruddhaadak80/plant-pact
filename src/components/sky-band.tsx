"use client";

import { useEffect, useState } from "react";
import type { SkyBundle } from "@/lib/types";
import { sillTemperature } from "@/lib/model/features";

/**
 * The sky band: a full-width dawn-to-dusk strip showing the 14-day outlook for a
 * location, each day drawn as a bar between its modelled sill minimum and
 * maximum.
 *
 * It fetches client-side on purpose. A server-side weather fetch inside the root
 * layout would make every page depend on an external network call, which turns a
 * slow or unreachable Open-Meteo into 30-second page loads and puts a live call
 * inside the build. Fetching here keeps pages fast and static, lets the band
 * refresh on each visit, and gives the loading and failure states somewhere
 * honest to live.
 *
 * The numbers are the same normalized forecast the model reads, the bars use the
 * same sill thermal model as the engine, and the caption always states whether
 * the payload is live or the sealed sample.
 */

interface SkyBandProps {
  latitude: number;
  longitude: number;
  placeLabel: string;
  tone?: "page" | "inline";
}

const WEEKDAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function weekday(date: string): string {
  return WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";
}

export function SkyBand({ latitude, longitude, placeLabel, tone = "page" }: SkyBandProps) {
  const [sky, setSky] = useState<SkyBundle | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const query = new URLSearchParams({
          lat: String(latitude),
          lon: String(longitude),
          place: placeLabel,
        });
        const response = await fetch(`/api/sky?${query}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`weather request failed: ${response.status}`);
        const body = (await response.json()) as { sky: SkyBundle };
        if (cancelled) return;
        setSky(body.sky);
        setState("ready");
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setState("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [latitude, longitude, placeLabel]);

  const compact = tone === "inline";

  if (state === "loading") {
    return (
      <section
        aria-label={`Weather outlook for ${placeLabel}`}
        data-testid="sky-band"
        data-origin="loading"
        className={compact ? "w-full" : "w-full border-b border-edge"}
      >
        <div className={compact ? "px-1" : "px-4 pt-3 sm:px-6"}>
          <p className="label-mono" role="status" aria-live="polite">
            reading the 14-day outlook for {placeLabel}…
          </p>
        </div>
        <div className={`sky-band mt-1.5 h-12 ${compact ? "rounded-[3px]" : ""}`} />
      </section>
    );
  }

  if (state === "error" || !sky) {
    return (
      <section
        aria-label={`Weather outlook for ${placeLabel}`}
        data-testid="sky-band"
        data-origin="error"
        className={compact ? "w-full" : "w-full border-b border-edge"}
      >
        <div className={compact ? "px-1 py-2" : "px-4 py-3 sm:px-6"}>
          <p className="label-mono text-warn">weather unavailable</p>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-loam-soft">
            The forecast service could not be reached, so this page has no weather strip.
            Pacts are still scored using the sealed sample and every result says so.
          </p>
        </div>
      </section>
    );
  }

  const lows = sky.forecast.map((d) => sillTemperature(d.minC, "cold"));
  const highs = sky.forecast.map((d) => sillTemperature(d.maxC, "heat"));
  const floor = Math.min(...lows) - 2;
  const ceiling = Math.max(...highs) + 2;
  const span = Math.max(1, ceiling - floor);

  return (
    <section
      aria-label={`Weather outlook for ${placeLabel}`}
      data-testid="sky-band"
      data-origin={sky.origin}
      className={compact ? "w-full" : "w-full border-b border-edge"}
    >
      <div className={compact ? "px-1" : "px-4 pt-3 sm:px-6"}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="label-mono">14-day sill outlook · {placeLabel}</p>
          <p className="label-mono" data-testid="sky-source" data-origin={sky.origin}>
            {sky.origin === "live" ? (
              <>
                live · open-meteo · {new Date(sky.fetchedAt).toISOString().slice(11, 16)} utc
              </>
            ) : (
              <>sealed sample · {sky.fetchedAt.slice(0, 10)} · not a live forecast</>
            )}
          </p>
        </div>
      </div>

      <div className={`sky-band mt-1.5 ${compact ? "rounded-[3px]" : ""}`}>
        <ol className={`grid grid-cols-7 gap-px px-px sm:grid-cols-14 ${compact ? "py-1" : "py-1.5"}`}>
          {sky.forecast.map((day, index) => {
            const bottom = ((lows[index] - floor) / span) * 100;
            const top = ((highs[index] - floor) / span) * 100;
            const height = Math.max(6, top - bottom);
            return (
              <li
                key={day.date}
                className="relative flex flex-col items-center justify-end px-0.5"
                title={`${day.date}: ${lows[index].toFixed(1)} to ${highs[index].toFixed(1)} °C on the sill (${day.minC.toFixed(0)}–${day.maxC.toFixed(0)} °C outside)`}
              >
                <span
                  className="num w-full rounded-t-[2px] bg-plaster/80"
                  style={{ height: `${height}%`, minHeight: "3px" }}
                />
                <span
                  className="absolute inset-x-0 h-px bg-plaster/45"
                  style={{ bottom: `${bottom}%` }}
                />
              </li>
            );
          })}
        </ol>
      </div>

      <div className={compact ? "mt-1" : "px-4 pb-3 sm:px-6"}>
        <ol className="grid grid-cols-7 gap-px sm:grid-cols-14">
          {sky.forecast.map((day, index) => (
            <li key={day.date} className="flex flex-col items-center gap-0.5">
              <span className="num text-[10px] leading-tight text-loam-soft">
                {Math.round(lows[index])}°
              </span>
              <span className="hidden font-mono text-[9px] uppercase tracking-[0.1em] text-loam-faint sm:block">
                {weekday(day.date)}
              </span>
              <span className="num text-[10px] leading-tight text-loam-faint">
                {day.date.slice(8, 10)}
              </span>
            </li>
          ))}
        </ol>
        {sky.origin !== "live" && sky.note ? (
          <p className="mt-2 max-w-prose font-mono text-[10px] leading-relaxed text-warn">
            {sky.note}
          </p>
        ) : null}
      </div>
    </section>
  );
}