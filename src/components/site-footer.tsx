import Link from "next/link";
import { NAV, SITE } from "@/lib/config";
import { GitHubLink } from "./github-link";
import { SAFETY_DISCLAIMER } from "@/lib/export";

export function SiteFooter(): React.ReactNode {
  return (
    <footer className="mt-16 border-t border-edge bg-shell" data-testid="site-footer">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="text-[1.05rem] font-medium">{SITE.name}</p>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-loam-soft">
              {SITE.description}
            </p>
            <div className="mt-4">
              <GitHubLink variant="footer" />
            </div>
          </div>

          <nav aria-label="Footer">
            <p className="label-mono">Product</p>
            <ul className="mt-2 space-y-1.5">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-loam-soft no-underline underline decoration-edge underline-offset-4 hover:text-clay"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/api/mcp"
                  className="text-sm text-loam-soft no-underline underline decoration-edge underline-offset-4 hover:text-clay"
                >
                  Agent endpoint
                </Link>
              </li>
            </ul>
          </nav>

          <div>
            <p className="label-mono">Build</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li>
                <a
                  href="/method"
                  className="text-loam-soft no-underline underline decoration-edge underline-offset-4 hover:text-clay"
                >
                  Method &amp; provenance
                </a>
              </li>
              <li>
                <a
                  href="/verify"
                  className="text-loam-soft no-underline underline decoration-edge underline-offset-4 hover:text-clay"
                >
                  Verify a seal chain
                </a>
              </li>
              <li>
                <a
                  href="/api/health"
                  className="text-loam-soft no-underline underline decoration-edge underline-offset-4 hover:text-clay"
                >
                  Health &amp; store
                </a>
              </li>
              <li>
                <a
                  href={SITE.issuesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-loam-soft no-underline underline decoration-edge underline-offset-4 hover:text-clay"
                >
                  Issues
                </a>
              </li>
              <li>
                <a
                  href={SITE.licenseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-loam-soft no-underline underline decoration-edge underline-offset-4 hover:text-clay"
                >
                  MIT licence
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 space-y-3 border-t border-edge pt-6 text-xs leading-relaxed text-loam-faint">
          <p>
            <strong className="font-medium text-loam-soft">Data.</strong> Weather and
            climate normals from{" "}
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-edge underline-offset-2 hover:text-clay"
            >
              Open-Meteo
            </a>{" "}
            (forecast API and ERA5 reanalysis archive, CC BY 4.0). Taxonomy from the{" "}
            <a
              href="https://www.gbif.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-edge underline-offset-2 hover:text-clay"
            >
              GBIF Backbone Taxonomy
            </a>
            . Plant Pact has no third-party API keys and never asks you for one.
          </p>
          <p>{SAFETY_DISCLAIMER}</p>
          <p>
            Built and open-sourced by{" "}
            <a
              href={`https://github.com/${SITE.repositorySlug.split("/")[0]}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-edge underline-offset-2 hover:text-clay"
            >
              {SITE.author}
            </a>
            . Licensed MIT.
          </p>
        </div>
      </div>
    </footer>
  );
}