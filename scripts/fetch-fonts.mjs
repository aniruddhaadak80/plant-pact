/**
 * Downloads the two self-hosted families used by Plant Pact into src/app/fonts
 * and prints the next/font/local config lines. Run once; the woff2 files are
 * committed so builds never depend on a font CDN.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "src", "app", "fonts");
mkdirSync(outDir, { recursive: true });

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const FAMILIES = [
  { family: "Fraunces", file: "Fraunces-latin-wght-normal.woff2", css: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..800&display=swap" },
  { family: "Fragment Mono", file: "FragmentMono-latin-400-normal.woff2", css: "https://fonts.googleapis.com/css2?family=Fragment+Mono&display=swap" },
];

for (const entry of FAMILIES) {
  const css = await fetch(entry.css, { headers: { "User-Agent": UA } }).then((r) => r.text());
  const latinBlock = css.split("/* latin */")[1] ?? css;
  const match = latinBlock.match(/url\((https:[^)]+\.woff2)\)/);
  if (!match) {
    throw new Error(`Could not find a latin woff2 URL for ${entry.family}`);
  }
  const bytes = Buffer.from(await fetch(match[1], { headers: { "User-Agent": UA } }).then((r) => r.arrayBuffer()));
  writeFileSync(resolve(outDir, entry.file), bytes);
  console.log(`${entry.family} -> src/app/fonts/${entry.file} (${(bytes.length / 1024).toFixed(1)} kB)`);
}

console.log(`\nconst display = localFont({ src: "./fonts/Fraunces-latin-wght-normal.woff2", variable: "--font-display", display: "swap", weight: "300 800" });`);
console.log(`const mono = localFont({ src: "./fonts/FragmentMono-latin-400-normal.woff2", variable: "--font-mono", display: "swap", weight: "400" });`);