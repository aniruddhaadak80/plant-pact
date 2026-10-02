import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared state components.
 *
 * Every data surface in this product renders one of these five states: loading,
 * empty, error, or loaded. There is no component that shows a spinner and then
 * quietly renders nothing, and nothing ever labels fallback data as live.
 */

export function SectionHeading({
  label,
  title,
  lede,
  action,
}: {
  label: string;
  title: string;
  lede?: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <p className="label-mono">{label}</p>
        <h2 className="mt-1.5 text-[1.6rem] leading-tight sm:text-[1.9rem]">{title}</h2>
        {lede ? <p className="mt-2 text-[0.95rem] leading-relaxed text-loam-soft">{lede}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }): ReactNode {
  return (
    <div
      className="tag flex items-center gap-3 px-4 py-6"
      role="status"
      aria-live="polite"
      data-testid="loading-state"
    >
      <span className="flex gap-1" aria-hidden="true">
        <span className="h-1.5 w-6 animate-pulse rounded-full bg-edge" />
        <span className="h-1.5 w-6 animate-pulse rounded-full bg-edge [animation-delay:120ms]" />
        <span className="h-1.5 w-6 animate-pulse rounded-full bg-edge [animation-delay:240ms]" />
      </span>
      <span className="label-mono">{label}…</span>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="tag px-5 py-8 text-center" data-testid="empty-state">
      <p className="text-[1.1rem]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-loam-soft">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "That did not work",
  body,
  action,
}: {
  title?: string;
  body: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div
      className="rounded-[3px] border border-risk/40 bg-risk-wash px-5 py-6"
      role="alert"
      data-testid="error-state"
    >
      <p className="text-[1.05rem] text-risk">{title}</p>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-loam-soft">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function OriginBadge({ origin }: { origin: "live" | "fallback" | "local-catalog" }): ReactNode {
  const live = origin === "live";
  return (
    <span
      data-testid="origin-badge"
      data-origin={origin}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
        live ? "border-leaf/40 bg-leaf-wash text-leaf-deep" : "border-warn/40 bg-warn-wash text-warn"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${live ? "bg-leaf" : "bg-warn"}`}
      />
      {live ? "live" : origin === "fallback" ? "sealed sample" : "local catalogue"}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}): ReactNode {
  const styles: Record<string, string> = {
    primary: "bg-clay text-plaster hover:bg-clay-deep border-clay disabled:bg-clay/50 disabled:border-clay/50",
    secondary: "bg-plaster text-loam hover:bg-shell border-edge",
    ghost: "bg-transparent text-loam-soft hover:bg-shell border-transparent",
    danger: "bg-plaster text-risk hover:bg-risk-wash border-risk/40",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-[4px] border px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="label-mono" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs leading-relaxed text-loam-faint">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  "w-full rounded-[3px] border border-edge bg-plaster px-2.5 py-2 text-sm text-loam placeholder:text-loam-faint/70 focus:border-clay focus:outline-none";

export function CtaLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}): ReactNode {
  const styles =
    variant === "primary"
      ? "bg-clay text-plaster hover:bg-clay-deep border-clay"
      : "bg-plaster text-loam hover:bg-shell border-edge";
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-[4px] border px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] no-underline transition-colors ${styles}`}
    >
      {children}
    </Link>
  );
}