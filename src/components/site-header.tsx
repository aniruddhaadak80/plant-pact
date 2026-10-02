import Link from "next/link";
import { NAV, SITE } from "@/lib/config";
import { GitHubLink } from "./github-link";

function LeafMark(): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0" focusable="false">
      <path
        d="M20 3c0 9-5.5 14-11 14-2 0-3.5-.6-4.5-1.4C6 22 20 21 20 3Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path d="M4 21c1.5-4.5 4-8 8-10.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function SiteHeader(): React.ReactNode {
  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-glass/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-loam no-underline"
          aria-label={`${SITE.name} home`}
        >
          <span className="text-leaf">
            <LeafMark />
          </span>
          <span className="text-[1.15rem] leading-none font-medium tracking-[-0.01em]">
            {SITE.name}
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-[3px] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-loam-soft no-underline transition-colors hover:bg-shell hover:text-clay"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <GitHubLink />
          </div>

          {/* No-JS disclosure for the mobile menu: fewer moving parts, and it
              keeps working if the client bundle fails to hydrate. */}
          <details className="relative md:hidden">
            <summary className="cursor-pointer list-none rounded-[3px] border border-edge px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-loam-soft marker:content-none">
              Menu
            </summary>
            <div className="absolute right-0 z-50 mt-2 w-56 rounded-[4px] border border-edge bg-plaster p-2 shadow-[0_8px_24px_-12px_rgba(30,36,25,0.35)]">
              <nav aria-label="Primary mobile" className="flex flex-col">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-[3px] px-2.5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-loam-soft no-underline hover:bg-shell hover:text-clay"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-2 border-t border-edge-soft pt-2 sm:hidden">
                <GitHubLink />
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}