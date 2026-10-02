import type { ReactNode } from "react";
import { SITE } from "@/lib/config";

/**
 * The official GitHub mark, inlined.
 *
 * lucide-react has no GitHub glyph, and a generic "code" icon next to the word
 * "GitHub" is worse than nothing, so the real mark is embedded here as an SVG
 * path. The repository URL always comes from SITE.repositoryUrl: there is no
 * second copy of it anywhere in the application.
 */
export function GitHubMark({ className = "h-4 w-4" }: { className?: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      focusable="false"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/**
 * The one place repository links are rendered. Header, mobile menu, landing CTA
 * and footer all use this component so the URL and the accessible name can
 * never drift apart.
 */
export function GitHubLink({
  variant = "header",
  label,
}: {
  variant?: "header" | "cta" | "footer";
  label?: string;
}): ReactNode {
  const text = label ?? (variant === "cta" ? "Star on GitHub" : "View source");

  const styles: Record<string, string> = {
    header:
      "inline-flex items-center gap-1.5 rounded-[3px] border border-edge px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-loam-soft transition-colors hover:border-loam-faint hover:text-loam",
    cta: "inline-flex items-center gap-2 rounded-[4px] border border-clay bg-clay px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-plaster transition-colors hover:bg-clay-deep",
    footer: "inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-loam-soft underline decoration-edge underline-offset-4 hover:text-clay",
  };

  return (
    <a
      href={SITE.repositoryUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${text} — ${SITE.name} on GitHub (opens in a new tab)`}
      className={styles[variant]}
      data-testid="github-link"
    >
      <GitHubMark className={variant === "cta" ? "h-4 w-4" : "h-3.5 w-3.5"} />
      <span>{text}</span>
    </a>
  );
}