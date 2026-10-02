import { ImageResponse } from "next/og";
import { SITE, siteOrigin } from "@/lib/config";
import { MODEL_CARD } from "@/lib/model/infer";

export const runtime = "nodejs";
export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * OpenGraph card.
 *
 * Drawn with the product's own palette: plaster and putty, terracotta for the
 * headline number, and the dawn-to-dusk band from the sky strip that runs across
 * every page of the app.
 */
export default async function OpenGraphImage() {
  const origin = siteOrigin();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#e7ebe3",
          padding: 72,
          fontFamily: "Georgia, serif",
          color: "#1e2419",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: "#6b7364" }}>
            FOR THE PLANT YOU ARE ABOUT TO GIVE AWAY
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 76,
              lineHeight: 1.06,
              letterSpacing: -2,
              maxWidth: 940,
            }}
          >
            Most gifted plants do not die of neglect.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 8,
              fontSize: 76,
              lineHeight: 1.06,
              letterSpacing: -2,
              color: "#b4502a",
              maxWidth: 940,
            }}
          >
            They die of a bad window.
          </div>
        </div>

        <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden" }}>
          <div style={{ flex: 4, background: "#f2c879" }} />
          <div style={{ flex: 4, background: "#7fa8bd" }} />
          <div style={{ flex: 3, background: "#2f3c58" }} />
          <div style={{ flex: 2, background: "#3f7d57" }} />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 30 }}>{SITE.name}</div>
            <div style={{ display: "flex", marginTop: 6, fontSize: 20, color: "#454c3e" }}>
              Live Open-Meteo weather · trained model · MIT licensed
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              fontSize: 18,
              color: "#454c3e",
            }}
          >
            <div style={{ display: "flex" }}>
              {MODEL_CARD.corpus.cities} cities · {MODEL_CARD.corpus.rows.toLocaleString("en-GB")} placements
            </div>
            <div style={{ display: "flex", marginTop: 4, color: "#6b7364" }}>
              {origin.replace(/^https?:\/\//, "")}
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}