import type { Config } from "./config";
import { HttpError } from "./errors";

export function periods(now = new Date()) {
  const iso = now.toISOString();
  return { month: `m:${iso.slice(0, 7)}`, day: `d:${iso.slice(0, 10)}` };
}

/** Atomically adds `pages` to a period if it stays within `limit`. Returns false if it would exceed. */
async function add(db: D1Database, period: string, pages: number, limit: number): Promise<boolean> {
  if (limit <= 0) return true;
  await db.prepare("INSERT INTO usage (period, pages) VALUES (?1, 0) ON CONFLICT (period) DO NOTHING").bind(period).run();
  const res = await db
    .prepare("UPDATE usage SET pages = pages + ?1 WHERE period = ?2 AND pages + ?1 <= ?3")
    .bind(pages, period, limit)
    .run();
  return res.meta.changes === 1;
}

async function subtract(db: D1Database, period: string, pages: number): Promise<void> {
  await db.prepare("UPDATE usage SET pages = MAX(0, pages - ?1) WHERE period = ?2").bind(pages, period).run();
}

/**
 * Reserves pages before calling Google, so concurrent requests can't overshoot the limit.
 * Usage is always recorded (even with limits disabled) so /api/usage stays accurate.
 */
export async function reservePages(db: D1Database, config: Config, pages: number): Promise<void> {
  const { month, day } = periods();
  const monthLimit = config.monthlyPageLimit > 0 ? config.monthlyPageLimit : Number.MAX_SAFE_INTEGER;
  const dayLimit = config.dailyPageLimit > 0 ? config.dailyPageLimit : Number.MAX_SAFE_INTEGER;

  if (!(await add(db, month, pages, monthLimit))) {
    throw new HttpError(429, `Monthly page limit reached (${config.monthlyPageLimit}). Request needs ${pages} page(s).`);
  }
  if (!(await add(db, day, pages, dayLimit))) {
    await subtract(db, month, pages);
    throw new HttpError(429, `Daily page limit reached (${config.dailyPageLimit}). Request needs ${pages} page(s).`);
  }
}

export async function refundPages(db: D1Database, pages: number): Promise<void> {
  const { month, day } = periods();
  await subtract(db, month, pages);
  await subtract(db, day, pages);
}

export async function getUsage(db: D1Database, config: Config) {
  const { month, day } = periods();
  const rows = await db
    .prepare("SELECT period, pages FROM usage WHERE period IN (?1, ?2)")
    .bind(month, day)
    .all<{ period: string; pages: number }>();
  const used = (p: string) => rows.results.find((r) => r.period === p)?.pages ?? 0;
  return {
    month: { period: month.slice(2), used: used(month), limit: config.monthlyPageLimit || null },
    day: { period: day.slice(2), used: used(day), limit: config.dailyPageLimit || null },
  };
}
