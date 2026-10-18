import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { scheduleAt } from "../src/schedule.mjs";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));

test("built site contains complete live recipes and a valid generated icon for every item", async () => {
  const assets = await readdir(path.join(dist, "assets"));
  const file = assets.find((f) => /^recipes\..*\.json$/.test(f));
  assert.ok(file, "Run npm run build before npm test");
  const data = JSON.parse(
    await readFile(path.join(dist, "assets", file), "utf8"),
  );
  assert.equal(data.schemaVersion, 2);
  assert.equal(data.rarity.slug, "super");
  assert.match(data.rarity.color, /^#[a-f\d]{6}$/i);
  assert.match(data.source.script, /^https:\/\/zorr\.pages\.dev\/[^/]+\.js/);
  assert.match(data.source.sha256, /^[a-f\d]{64}$/);
  assert.ok(Number.isFinite(Date.parse(data.source.fetchedAt)));
  assert.ok(data.source.extraction.rotationLine > 0);
  assert.ok(data.recipes.length > 3);
  for (const [id, recipe] of data.recipes.entries()) {
    assert.equal(recipe.id, id);
    assert.ok(recipe.inputs.length && recipe.outputs.length);
    for (const item of [...recipe.inputs, ...recipe.outputs]) {
      assert.ok(Number.isSafeInteger(item.count) && item.count > 0);
      assert.ok(data.petals[item.slug]?.name);
      assert.ok(data.petals[item.slug].images[item.count]);
    }
  }
  for (const petal of Object.values(data.petals)) {
    assert.ok(Number.isSafeInteger(petal.bodies) && petal.bodies >= 0);
    for (const file of Object.values(petal.images)) {
      const iconPath = path.join(dist, "assets", file);
      assert.ok((await stat(iconPath)).size > 0);
      const image = await loadImage(iconPath);
      assert.equal(image.width, data.rendering.pixelSize);
      assert.equal(image.height, data.rendering.pixelSize);
    }
  }
  const s = scheduleAt(Date.now(), data.recipes, data.intervalMs);
  assert.equal(
    new Set(
      [s.previous, s.current, s.next, ...s.upcoming].map((e) => e.recipe.id),
    ).size,
    data.recipes.length,
  );
});

test("published output has no game runtime, research artifacts, placeholders or external scripts", async () => {
  const html = await readFile(path.join(dist, "index.html"), "utf8");
  assert.doesNotMatch(html, /__[A-Z_]+__|<script[^>]*src=["']https?:/);
  const assets = await readdir(path.join(dist, "assets"));
  const app = await readFile(
    path.join(
      dist,
      "assets",
      assets.find((f) => /^app\..*\.js$/.test(f)),
    ),
    "utf8",
  );
  assert.doesNotMatch(app, /__[A-Z_]+__|research\/|deobfuscator|WebSocket/);
  assert.doesNotMatch(app, /class="petal-(?:quantity|name)"/);
  assert.deepEqual((await readdir(dist)).sort(), [
    "404.html",
    "_headers",
    "assets",
    "icon.svg",
    "index.html",
  ]);
});
