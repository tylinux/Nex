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

test("application icon source uses the same N in neutral black and white", async () => {
  const [source, startup] = await Promise.all([read("public/logo/icon.svg"), read(surfaces[5]!)]);
  assert.match(source, /viewBox="0 0 1024 1024"/);
  assert.deepEqual(paths(source), paths(startup));
  assert.equal((source.match(/fill="#FFFFFF"/g) ?? []).length, 3);
  assert.doesNotMatch(source, /<image\b/);
  for (const [, color] of source.matchAll(/(?:stop-color|fill)="(#[\da-f]{6})"/gi)) {
    const hex = color!.slice(1);
    assert.equal(hex.slice(0, 2), hex.slice(2, 4));
    assert.equal(hex.slice(2, 4), hex.slice(4, 6));
  }
});

test("Web inline favicon matches the neutral 32px brand PNG", async () => {
  const html = await read(surfaces[1]!);
  const base64 = html.match(/href="data:image\/png;base64,([^"]+)"/)?.[1];
  assert.ok(base64);
  const expected = await readFile(new URL("public/logo/icons/32x32.png", root));
  assert.ok(Buffer.from(base64, "base64").equals(expected));
});

test("platform and update-dialog icon copies stay aligned with the brand source export", async () => {
  const master = await readFile(new URL("public/logo/icons/1024x1024.png", root));
  for (const path of [
    "packages/desktop/build/icon.png",
    "packages/desktop/build/icon_windows.png",
    "packages/desktop/build/icon_installer.png",
    "packages/desktop/build/icons/1024x1024.png",
    "public/icon_512@2x.png",
  ]) {
    assert.ok((await readFile(new URL(path, root))).equals(master), path);
  }
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    const name = `${size}x${size}.png`;
    const [brand, desktop] = await Promise.all([
      readFile(new URL(`public/logo/icons/${name}`, root)),
      readFile(new URL(`packages/desktop/build/icons/${name}`, root)),
    ]);
    assert.ok(brand.equals(desktop), name);
    assert.equal(brand.readUInt32BE(16), size);
    assert.equal(brand.readUInt32BE(20), size);
  }
  const ico = await readFile(new URL("public/logo/icons/icon.ico", root));
  for (const path of [
    "packages/desktop/build/icon.ico",
    "packages/desktop/build/icon_installer.ico",
    "packages/web/public/favicon.ico",
  ]) {
    assert.ok((await readFile(new URL(path, root))).equals(ico), path);
  }
  const icns = await readFile(new URL("public/logo/icons/icon.icns", root));
  for (const path of [
    "packages/desktop/build/icon.icns",
    "packages/desktop/build/icon_installer.icns",
  ]) {
    assert.ok((await readFile(new URL(path, root))).equals(icns), path);
  }
});
