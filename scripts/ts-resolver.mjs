import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
  if (!isRelative) return nextResolve(specifier, context);

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
    const base = specifier.startsWith("/")
      ? resolvePath(specifier)
      : resolvePath(dirname(parentPath), specifier);

    for (const ext of EXTENSIONS) {
      const file = `${base}${ext}`;
      if (existsSync(file)) return nextResolve(pathToFileURL(file).href, context);
      const indexFile = resolvePath(base, `index${ext}`);
      if (existsSync(indexFile)) return nextResolve(pathToFileURL(indexFile).href, context);
    }
    throw error;
  }
}