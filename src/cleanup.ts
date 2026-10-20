import type { Env } from "./config";

/** Deletes expired jobs and their result files. Returns the number of jobs removed. */
export async function cleanupExpired(env: Env, now = Date.now()): Promise<number> {
  let removed = 0;
  for (;;) {
    const { results } = await env.DB.prepare("SELECT id FROM jobs WHERE expires_at <= ?1 LIMIT 200")
      .bind(now)
      .all<{ id: string }>();
    if (results.length === 0) break;

    const ids = results.map((r) => r.id);
    await env.RESULTS.delete(ids.flatMap((id) => [`results/${id}.md`, `results/${id}.txt`]));
    await env.DB.prepare(`DELETE FROM jobs WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(",")})`)
      .bind(...ids)
      .run();
    removed += ids.length;
  }

  // Daily usage counters are only needed for the current day; keep ~2 months for reference.
  const cutoff = new Date(now - 62 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM usage WHERE period LIKE 'd:%' AND period < ?1").bind(`d:${cutoff}`).run();
  return removed;
}
