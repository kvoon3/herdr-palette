import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { RECENT_LIMIT, readRecent, recentPath, recordRecent, withRecent } from "../src/recent";
import { defaultItems } from "../src/catalog";

const dir = () => mkdtempSync(join(tmpdir(), "palette-recent-"));

test("records the used command first and de-duplicates repeats", () => {
  const path = join(dir(), "recent.palette.json");

  recordRecent("zoom", path);
  recordRecent("rename_pane", path);
  recordRecent("zoom", path);

  expect(readRecent(path)).toEqual(["zoom", "rename_pane"]);
});

test("keeps only the most recent ids", () => {
  const path = join(dir(), "recent.palette.json");

  for (let index = 0; index < RECENT_LIMIT + 3; index++) recordRecent(`id-${index}`, path);

  expect(readRecent(path)).toEqual(["id-7", "id-6", "id-5", "id-4", "id-3"]);
});

test("treats a cache that cannot be read as no history", () => {
  const path = join(dir(), "recent.palette.json");

  expect(readRecent(path)).toEqual([]);
  writeFileSync(path, "{not json");
  expect(readRecent(path)).toEqual([]);
  writeFileSync(path, '{"items":["zoom"]}');
  expect(readRecent(path)).toEqual([]);
  expect(readRecent(undefined)).toEqual([]);
});

test("pins recent commands on top without disturbing the catalog", () => {
  const items = withRecent(defaultItems(), ["close_pane", "zoom"]);

  expect(items.slice(0, 2).map(item => [item.id, item.category])).toEqual([["close_pane", "Recent"], ["zoom", "Recent"]]);
  expect(items[2]!.category).toBe("Workspace");
  expect(items.find(item => item.id === "zoom" && item.category !== "Recent")!.title).toBe("Zoom pane");
});

test("drops ids that are no longer in the catalog", () => {
  expect(withRecent(defaultItems(), ["gone"]).every(item => item.category !== "Recent")).toBe(true);
});

test("resolves the cache next to the plugin state Herdr owns", () => {
  expect(recentPath("/state")).toBe("/state/recent.palette.json");
  expect(recentPath(undefined)).toBeUndefined();
});
