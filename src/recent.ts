import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Category, PaletteItem } from "./types";

/** Category of the pinned copies; also how the palette recognizes them. */
export const RECENT_CATEGORY: Category = "Recent";
export const RECENT_LIMIT = 5;
const FILE = "recent.palette.json";

/** Herdr owns the state directory; the second name is a debugging escape hatch, not a second home. */
const stateDir = (): string | undefined => process.env.HERDR_PLUGIN_STATE_DIR ?? process.env.HERDR_PALETTE_STATE_DIR;

export function recentPath(dir = stateDir()): string | undefined {
  return dir ? join(dir, FILE) : undefined;
}

/** Recently used ids, most recent first. A cache: anything unreadable reads as no history. */
export function readRecent(path = recentPath()): string[] {
  if (!path) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, RECENT_LIMIT) : [];
  } catch { return []; }
}

/** Move `id` to the front of the ring and persist it. Losing this is not worth an error. */
export function recordRecent(id: string, path = recentPath()): string[] {
  const next = [id, ...readRecent(path).filter(seen => seen !== id)].slice(0, RECENT_LIMIT);
  try { if (path) writeFileSync(path, `${JSON.stringify(next)}\n`); } catch {}
  return next;
}

/** Pin the used commands on top as copies, so the originals keep their own category. */
export function withRecent(items: PaletteItem[], ids: string[] = readRecent()): PaletteItem[] {
  const byId = new Map(items.map(item => [item.id, item]));
  return [
    ...ids.flatMap(id => { const item = byId.get(id); return item ? [{ ...item, category: RECENT_CATEGORY }] : []; }),
    ...items,
  ];
}
