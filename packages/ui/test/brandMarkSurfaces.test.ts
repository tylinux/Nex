import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const surfaces = [
  "packages/ui/src/assets/N.svg",
  "packages/web/index.html",
  "packages/desktop/src/renderer/index.html",
  "packages/ui/src/WorkspaceAboutDialog.tsx",
  "packages/desktop/src/main/aboutWindow.ts",
  "packages/ui/src/root/RootStartupLoading.tsx",
  "packages/ui/src/v4/ConversationDraftEmptyState.tsx",
];
const paths = (source: string) =>
  [...new Set([...source.matchAll(/\bd="(M(?:263|625) [^"]+)"/g)].map((match) => match[1]))].sort();

test("seven brand surfaces retain the same three N strokes", async () => {
  const sources = await Promise.all(surfaces.map(read));
  const expected = paths(sources[5]!);
  assert.equal(expected.length, 3);
  for (const [index, source] of sources.entries()) {
    assert.deepEqual(paths(source), expected, surfaces[index]);
  }
});

test("dark empty-state watermark retains the original neutral Z treatment without an app tile", async () => {
  const svg = await read(surfaces[0]!);
  assert.match(svg, /viewBox="0 0 436 360"/);
  const colors = [...svg.matchAll(/stop-color="(#[\da-f]+)"/gi)].map((match) =>
    match[1]!.toUpperCase(),
  );
  assert.deepEqual([...new Set(colors)], ["#444444", "#2A2A2A", "#1A1A1A"]);
  assert.match(svg, /<g opacity="0.15" filter=/);
  assert.match(svg, /stdDeviation="1.2"/);
  assert.doesNotMatch(svg, /tile|<rect|<image/i);
});

test("both About marks use inherited white and fit the existing small icon shell", async () => {
  const [web, desktop] = await Promise.all([read(surfaces[3]!), read(surfaces[4]!)]);
  for (const source of [web, desktop]) {
    const svg = source.match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
    assert.ok(svg);
    assert.equal((svg.match(/fill="currentColor"/g) ?? []).length, 3);
    assert.doesNotMatch(svg, /linearGradient|stopColor|stop-color/);
  }
  assert.match(web, /className="w-\[30px\] h-auto shrink-0"/);
  assert.match(desktop, /\.app-logo\s*\{\s*width: 30px;\s*height: auto;/);
});
