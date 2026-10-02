/**
 * Lets plain `node scripts/train-model.ts` import the application's TypeScript
 * modules with the same extensionless specifiers the bundler uses.
 *
 * Node's ESM resolver requires explicit file extensions; the Next.js compiler
 * does not. Rather than distort the application source with `.ts` suffixes or
 * add a TypeScript runner dependency, this registers a resolver hook that
 * retries a failed relative import with .ts/.tsx/.mjs and an index file.
 *
 * Nothing in src/ imports this. It exists so that training reads exactly the
 * code the application runs.
 */
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

register(
  pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "ts-resolver.mjs")),
);