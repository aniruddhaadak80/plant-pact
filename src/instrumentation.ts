export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { getRepository } = await import("@/lib/db");
      await getRepository();
    } catch {
      // Warmup is best-effort. /api/health reports the real store status, and a
      // cold function will retry initialisation on its first request.
    }
  }
}