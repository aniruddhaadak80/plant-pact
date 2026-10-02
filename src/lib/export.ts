import { SITE } from "./config";
import { SILL_MODEL } from "./model/features";
import { ALERT_THRESHOLD } from "./engine/verdict";
import { SEAL_ALGORITHM } from "./integrity/chain";
import { HAZARD_THRESHOLD, LABELING_VERSION } from "./engine/labeling";
import type { EngineVerdict, Pact, SkyBundle } from "./types";

/**
 * The takeaway artifact: a care card you can send to the person the plant is
 * for, and a printable HTML version of the same content.
 *
 * It carries the placement, the odds, the one thing most likely to kill it, the
 * check-back date, the exact data provenance and the caveats. Nothing here is
 * decorative: a recipient who only reads the card still knows what to do and
 * when they will be asked how it went.
 */

export const SAFETY_DISCLAIMER = [
  "Plant Pact gives placement guidance, not horticultural or veterinary advice.",
  "Care ranges in the species catalogue are approximate published guidelines compiled for this project, not measurements of a specific cultivar.",
  "Toxicity flags are conservative and general. If an animal or a child chews a plant, confirm the species with a veterinarian or your local poison service.",
].join(" ");

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function header(pact: Pact): string[] {
  return [
    `# Care card: ${pact.plantLabel}`,
    "",
    `**For ${pact.friendName}** · ${pact.plantLabel} (*${pact.species?.scientificName ?? "species pending"}*) · ${pact.placeLabel}`,
    "",
  ];
}

export function renderCareCard(pact: Pact, verdict: EngineVerdict, sky: SkyBundle): string {
  const lines: string[] = [];
  lines.push(...header(pact));

  lines.push("## The placement");
  lines.push("");
  lines.push(`- Window: ${pact.windowLabel} (${pact.windowAspect} facing, ${pact.windowHours} h of light per day)`);
  lines.push(`- Watering: every ${pact.wateringDays} days`);
  lines.push(`- Care routine: ${pact.careLevel}`);
  lines.push(`- Pets or small children in the home: ${pact.petsPresent ? "yes" : "no"}`);
  lines.push("");

  lines.push(`## The odds: ${pct(verdict.model.probability)} over ${verdict.horizonDays} days`);
  lines.push("");
  lines.push(verdict.recommendation);
  lines.push("");
  lines.push(verdict.recommendationDetail);
  lines.push("");

  const failingDate = verdict.breakingPoint.projectedDate ?? verdict.breakingPoint.date;
  lines.push("## The week it dies");
  lines.push("");
  if (failingDate) {
    const basis =
      verdict.breakingPoint.date === failingDate
        ? "Inside the current 14-day forecast window."
        : "Projected beyond the current forecast window from the model slope.";
    lines.push(
      `Survival is projected to fall below ${pct(ALERT_THRESHOLD)} on **${failingDate}**. ${basis}`,
    );
  } else {
    lines.push(
      `Survival stays above ${pct(ALERT_THRESHOLD)} across the whole forecast window and the model trend is flat or rising, so no failing week is projected.`,
    );
  }
  lines.push("");

  lines.push("## What is costing the most");
  lines.push("");
  for (const factor of verdict.model.features
    .filter((f) => f.key !== "lightHeadroom" && f.value > 0)
    .sort((a, b) => a.contribution - b.contribution)) {
    lines.push(`- **${factor.label}** — ${factor.evidence}`);
  }
  lines.push("");

  if (verdict.alerts.length > 0) {
    lines.push("## Read this too");
    lines.push("");
    for (const alert of verdict.alerts) lines.push(`- ${alert}`);
    lines.push("");
  }

  lines.push("## Check back");
  lines.push("");
  lines.push(
    `Return to Plant Pact on **${pact.dueDate}** and record what happened. The pact is a prediction you have agreed to test, not a receipt.`,
  );
  lines.push("");

  lines.push("## Where the numbers came from");
  lines.push("");
  lines.push(`- Engine: \`${verdict.engineVersion}\` · Model: \`${verdict.modelVersion}\``);
  lines.push(
    `- Prediction sealed in a ${SEAL_ALGORITHM} chain (head \`${pact.seal.slice(0, 24)}…\`), so this record cannot be quietly rewritten.`,
  );
  lines.push(
    `- Labels for model fitting: \`${LABELING_VERSION}\` (hazard threshold ${HAZARD_THRESHOLD})`,
  );
  lines.push(
    `- Sill thermal model: outdoor extremes damped toward ${SILL_MODEL.neutralC} °C (cold ×${SILL_MODEL.coldDamping}, heat ×${SILL_MODEL.heatDamping})`,
  );
  lines.push(
    `- Weather: ${sky.origin === "live" ? "live" : "sealed offline sample"}, fetched ${sky.fetchedAt}. ${sky.attribution}`,
  );
  if (sky.origin !== "live" && sky.note) lines.push(`- ${sky.note}`);
  lines.push("");
  lines.push("## Please note");
  lines.push("");
  lines.push(SAFETY_DISCLAIMER);
  lines.push("");
  lines.push(
    `Made with ${SITE.name} — ${SITE.repositoryUrl}`,
  );
  lines.push("");

  return lines.join("\n");
}

export function renderCareCardHtml(pact: Pact, verdict: EngineVerdict, sky: SkyBundle): string {
  const factors = verdict.model.features
    .filter((f) => f.key !== "lightHeadroom" && f.value > 0)
    .sort((a, b) => a.contribution - b.contribution)
    .map(
      (f) =>
        `<li><strong>${escapeHtml(f.label)}</strong> <span class="num">${f.contribution.toFixed(3)}</span><br><span class="muted">${escapeHtml(f.evidence)}</span></li>`,
    )
    .join("\n");

  const failingDate = verdict.breakingPoint.projectedDate ?? verdict.breakingPoint.date;
  const alerts = verdict.alerts
    .map((a) => `<li>${escapeHtml(a)}</li>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Care card · ${escapeHtml(pact.plantLabel)}</title>
<style>
  :root { --ink:#1e2419; --bone:#f4f6f0; --glass:#e9ede6; --clay:#b4502a; --leaf:#3f7d57; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--glass); color:var(--ink); font-family: Georgia, 'Times New Roman', serif; line-height:1.55; padding:2rem 1rem; }
  main { max-width: 44rem; margin:0 auto; background:var(--bone); border:1px solid #c9cfc2; border-radius:14px; padding:2rem; }
  h1 { font-size:1.6rem; margin:0 0 .25rem; }
  .lede { color:#4b5346; margin:0 0 1.5rem; font-size:1rem; }
  .odds { display:flex; align-items:baseline; gap:.75rem; padding:1rem 0; border-top:1px solid #d5dbcd; border-bottom:1px solid #d5dbcd; margin:1rem 0; }
  .odds .big { font-size:2.6rem; font-weight:700; color:var(--leaf); }
  .odds .label { font-size:.8rem; text-transform:uppercase; letter-spacing:.09em; color:#6b7364; }
  h2 { font-size:.78rem; text-transform:uppercase; letter-spacing:.11em; color:#6b7364; margin:1.8rem 0 .5rem; font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; }
  ul { margin:0; padding-left:1.1rem; }
  li { margin-bottom:.6rem; }
  .num { font-family: ui-monospace, Menlo, monospace; color:var(--clay); font-size:.85rem; }
  .muted { color:#5a6154; font-size:.92rem; }
  .kill { background:#f6ece6; border-left:3px solid var(--clay); padding:.75rem 1rem; border-radius:0 8px 8px 0; }
  footer { margin-top:2rem; padding-top:1rem; border-top:1px solid #d5dbcd; font-size:.8rem; color:#6b7364; }
  a { color:var(--clay); }
</style>
</head>
<body>
<main>
  <h1>Care card · ${escapeHtml(pact.plantLabel)}</h1>
  <p class="lede">For ${escapeHtml(pact.friendName)} · ${escapeHtml(pact.species?.scientificName ?? "")} · ${escapeHtml(pact.placeLabel)}</p>

  <div class="odds">
    <span class="big">${pct(verdict.model.probability)}</span>
    <span class="label">chance of surviving ${verdict.horizonDays} days at<br>${escapeHtml(pact.windowLabel)} · ${pact.windowHours} h light · watered every ${pact.wateringDays} d</span>
  </div>

  <div class="kill"><strong>${escapeHtml(
    verdict.model.features.find((f) => f.key === verdict.model.killer)?.label ?? "Top risk",
  )}:</strong> ${escapeHtml(pact.killerNote)}</div>
  <p>${escapeHtml(verdict.recommendationDetail)}</p>

  <h2>The week it dies</h2>
  <p>${
    failingDate
      ? `Survival is projected below ${pct(ALERT_THRESHOLD)} on <strong>${escapeHtml(failingDate)}</strong>.`
      : `No week inside the forecast window drops survival below ${pct(ALERT_THRESHOLD)}, and the model trend is flat or rising.`
  }</p>

  <h2>What is costing the most</h2>
  <ul>${factors}</ul>

  ${
    alerts
      ? `<h2>Read this too</h2><ul>${alerts}</ul>`
      : ""
  }

  <h2>Check back on ${escapeHtml(pact.dueDate)}</h2>
  <p>Return to Plant Pact and record what happened. This is a prediction you agreed to test.</p>

  <footer>
    Engine <code>${escapeHtml(verdict.engineVersion)}</code> · model <code>${escapeHtml(verdict.modelVersion)}</code><br />
    Weather ${sky.origin === "live" ? "live" : "sealed offline sample"}, fetched ${escapeHtml(sky.fetchedAt)}. ${escapeHtml(sky.attribution)}<br />
    Prediction sealed in a ${SEAL_ALGORITHM} chain, head <code>${escapeHtml(pact.seal.slice(0, 24))}…</code><br />
    ${escapeHtml(SAFETY_DISCLAIMER)}<br />
    <a href="${escapeHtml(SITE.repositoryUrl)}">${escapeHtml(SITE.name)}</a> · MIT
  </footer>
</main>
</body>
</html>`;
}