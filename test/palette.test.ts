import { createTestRenderer } from "@opentui/core/testing";
import { expect, test } from "bun:test";
import { mountPalette } from "../src/palette";
import { fallbackTheme } from "../src/theme";
import type { CommandResult, PaletteItem } from "../src/types";

/**
 * A palette deliberately unlike both the built-in fallback and anything a real Herdr config
 * would resolve to, so the assertions below can only pass when the mounted theme is honored.
 */
const theme = { background: "#29284f", panel: "#3c3b68", text: "#e9e8ff", muted: "#a7a4df", accent: "#ffe11a", shortcut: "#8be9fd", footer: "#1d1c3a", footerText: "#8f8cd0" };

const item = (id: string, title: string, invocation: PaletteItem["invocation"], prompt?: PaletteItem["prompt"]): PaletteItem =>
  ({ id, title, category: "Panes", description: "Does the thing", icon: "▯", aliases: [], shortcuts: ["ctrl+a+z"], invocation, ...(prompt ? { prompt } : {}) });

const items = [
  item("zoom", "Zoom pane", { kind: "herdr", argv: ["pane", "zoom", "--current"] }),
  item("rename_pane", "Rename pane", { kind: "resolve", action: "rename-pane" }, { placeholder: "New name" }),
  item("settings", "Settings", { kind: "shortcut" }),
];

async function palette(result: CommandResult, paletteItems = items) {
  const harness = await createTestRenderer({ width: 60, height: 14 });
  const ran: Array<{ id: string; input?: string } | "closed"> = [];
  const recorded: string[] = [];
  mountPalette(harness.renderer, paletteItems, {
    theme,
    run: async (selected, input) => {
      ran.push(input === undefined ? { id: selected.id } : { id: selected.id, input });
      return result;
    },
    record: id => recorded.push(id),
    close: () => ran.push("closed"),
  });
  return { ...harness, ran, recorded };
}

const hex = (color: { r: number; g: number; b: number }) =>
  "#" + [color.r, color.g, color.b].map(value => Math.round(value <= 1 ? value * 255 : value).toString(16).padStart(2, "0")).join("");

/** Enter runs the command asynchronously, so let its result land before rendering. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
/** Escape is ambiguous until OpenTUI's stdin parser timeout (~20ms) flushes it. */
const settleEscape = () => new Promise(resolve => setTimeout(resolve, 30));
const rowsOf = (frame: string) => frame.split("\n").filter((row, index, all) => index < all.length - 1 || row !== "");

test("paints the palette background across the whole popup", async () => {
  const { renderer, mockInput, renderOnce, captureSpans } = await palette({ ok: true, message: "" });

  await mockInput.typeText("settings");
  await renderOnce();

  const frame = captureSpans();
  expect(frame.lines).toHaveLength(renderer.height);
  for (const line of frame.lines.slice(0, -1)) expect(line.spans.map(span => hex(span.bg))).toContain(theme.background);
});

test("pins the footer to the bottom of the popup", async () => {
  const { mockInput, renderOnce, captureCharFrame } = await palette({ ok: true, message: "" });

  await mockInput.typeText("settings");
  await renderOnce();

  const rows = rowsOf(captureCharFrame());
  expect(rows).toHaveLength(14);
  expect(rows.at(-1)).toContain("1 commands");
});

test("sets the footer apart as a full-width bar", async () => {
  const { renderer, mockInput, renderOnce, captureSpans } = await palette({ ok: true, message: "" });

  await mockInput.typeText("settings");
  await renderOnce();

  const footer = captureSpans().lines.at(-1)!;
  expect(footer.spans.map(span => hex(span.bg))).toEqual(footer.spans.map(() => theme.footer));
  expect(footer.spans.reduce((width, span) => width + span.text.length, 0)).toBe(renderer.width);
  expect(footer.spans.filter(span => hex(span.fg) === theme.accent).map(span => span.text)).toEqual(["enter", "↑/↓"]);
});

test("closes the palette once a Herdr command succeeds", async () => {
  const { mockInput, renderOnce, ran } = await palette({ ok: true, message: "" });

  await mockInput.typeText("zoom");
  mockInput.pressEnter();
  await settle();
  await renderOnce();

  expect(ran).toEqual([{ id: "zoom" }, "closed"]);
});

test("asks for input before running a prompted command", async () => {
  const { mockInput, renderOnce, captureCharFrame, ran } = await palette({ ok: true, message: "" });

  await mockInput.typeText("rename");
  mockInput.pressEnter();
  await settle();
  await renderOnce();

  expect(captureCharFrame()).toContain("Rename pane");
  expect(captureCharFrame()).toContain("New name");
  expect(ran).toEqual([]);

  await mockInput.typeText("logs");
  mockInput.pressEnter();
  await settle();
  await renderOnce();

  expect(ran).toEqual([{ id: "rename_pane", input: "logs" }, "closed"]);
});

test("returns to search when escaping a prompt", async () => {
  const { mockInput, renderOnce, captureCharFrame, ran } = await palette({ ok: true, message: "" });

  await mockInput.typeText("rename");
  mockInput.pressEnter();
  await settle();
  mockInput.pressEscape();
  await settleEscape();
  await renderOnce();

  expect(captureCharFrame()).toContain("Commands");
  expect(captureCharFrame()).toContain("1 commands");
  expect(ran).toEqual([]);
});

test("reports why a command did not run instead of ignoring enter", async () => {
  const { mockInput, renderOnce, captureCharFrame } = await palette({ ok: false, message: "Press ctrl+a+z — Herdr only runs this one from the keyboard." });

  await mockInput.typeText("settings");
  mockInput.pressEnter();
  await settle();
  await renderOnce();

  const rows = rowsOf(captureCharFrame());
  expect(rows).toHaveLength(14);
  expect(rows.at(-2)).toContain("Press ctrl+a+z — Herdr only runs this one");
  expect(rows.at(-1)).toContain("1 commands");
});

test("stays usable when running a command throws", async () => {
  const { renderer, mockInput, renderOnce, captureCharFrame, captureSpans } = await createTestRenderer({ width: 60, height: 14 });
  mountPalette(renderer, items, { run: async () => { throw new Error("herdr is not on PATH"); }, close: () => {} });

  await mockInput.typeText("zoom");
  mockInput.pressEnter();
  await settle();
  mockInput.pressEnter();
  await settle();
  await renderOnce();

  // No theme injected here on purpose, so this also covers the built-in fallback palette.
  const footer = captureSpans().lines.at(-1)!;
  expect(footer.spans.map(span => hex(span.bg))).toEqual(footer.spans.map(() => fallbackTheme.footer));
  expect(captureCharFrame()).toContain("herdr is not on PATH");
});

test("explains an empty result set", async () => {
  const { mockInput, renderOnce, captureCharFrame } = await palette({ ok: true, message: "" });

  await mockInput.typeText("nowhere");
  await renderOnce();

  expect(captureCharFrame()).toContain("No commands match your search.");
});

const pinned = [
  { ...item("zoom", "Zoom pane", { kind: "herdr", argv: [] }), category: "Recent" as const },
  ...items,
];

const occurrences = (frame: string, needle: string) => frame.split(needle).length - 1;

test("pins recently used commands above their own category", async () => {
  const { renderOnce, captureCharFrame } = await palette({ ok: true, message: "" }, pinned);

  await renderOnce();

  const frame = captureCharFrame();
  expect(frame).toContain("Recent");
  expect(occurrences(frame, "Zoom pane")).toBe(2);
  expect(frame.indexOf("Recent")).toBeLessThan(frame.indexOf("Zoom pane"));
});

test("counts commands once and drops the pinned copy while searching", async () => {
  const { mockInput, renderOnce, captureCharFrame } = await palette({ ok: true, message: "" }, pinned);

  await mockInput.typeText("zoom");
  await renderOnce();

  const frame = captureCharFrame();
  expect(occurrences(frame, "Zoom pane")).toBe(1);
  expect(frame).toContain("1 commands");
});

test("remembers a command that ran and forgets one that did not", async () => {
  const succeeded = await palette({ ok: true, message: "" });
  await succeeded.mockInput.typeText("zoom");
  succeeded.mockInput.pressEnter();
  await settle();

  expect(succeeded.recorded).toEqual(["zoom"]);

  const failed = await palette({ ok: false, message: "Herdr said no." });
  await failed.mockInput.typeText("zoom");
  failed.mockInput.pressEnter();
  await settle();

  expect(failed.recorded).toEqual([]);
});
