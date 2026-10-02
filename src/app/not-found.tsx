import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="label-mono">404</p>
      <h1 className="mt-2 text-[2rem] leading-tight">Nothing is planted here</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-loam-soft">
        That address does not exist, or the pact behind it belongs to a different session. Pact
        ids are unguessable and scoped, so a wrong one looks exactly like a missing one.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link
          href="/advisor"
          className="inline-flex items-center rounded-[4px] border border-clay bg-clay px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-plaster no-underline hover:bg-clay-deep"
        >
          Place a plant
        </Link>
        <Link
          href="/"
          className="inline-flex items-center rounded-[4px] border border-edge bg-plaster px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-loam no-underline hover:border-clay hover:text-clay"
        >
          Home
        </Link>
      </div>
    </div>
  );
}