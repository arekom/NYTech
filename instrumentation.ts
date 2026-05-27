export async function register() {
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const pollSeconds = Number(process.env.DEV_CRON_POLL_SECONDS || 20);
  const port = process.env.PORT || "3000";
  const url = `http://localhost:${port}/api/cron/deliver`;
  const secret = process.env.CRON_SECRET;

  console.log(`[dev-cron] polling ${url} every ${pollSeconds}s`);

  setInterval(async () => {
    try {
      const headers: Record<string, string> = {};
      if (secret) headers.authorization = `Bearer ${secret}`;
      const res = await fetch(url, { headers });
      const json = (await res.json().catch(() => ({}))) as {
        delivered?: number;
        deliveryFailed?: number;
        cleaned?: number;
        cleanupFailed?: number;
      };
      const d = json.delivered ?? 0;
      const df = json.deliveryFailed ?? 0;
      const c = json.cleaned ?? 0;
      const cf = json.cleanupFailed ?? 0;
      if (d || df || c || cf) {
        console.log(
          `[dev-cron] delivered=${d} failed=${df} cleaned=${c} cleanupFailed=${cf}`
        );
      }
    } catch (err) {
      // dev-only; quiet noise unless something useful to report
      const message = err instanceof Error ? err.message : String(err);
      if (!/ECONNREFUSED/.test(message)) console.warn("[dev-cron]", message);
    }
  }, pollSeconds * 1000);
}
