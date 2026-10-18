import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createCanvas, Path2D, GlobalFonts } from "@napi-rs/canvas";
import { extract } from "../scripts/lib/extract.mjs";
import { paintAtlasCell, paintTile } from "../scripts/lib/paint.mjs";
import { openRenderer } from "../scripts/lib/browser.mjs";

const files = await readdir(new URL("../dist/assets/", import.meta.url));
const data = JSON.parse(
  await readFile(
    new URL(
      `../dist/assets/${files.find((f) => /^recipes\..*\.json$/.test(f))}`,
      import.meta.url,
    ),
    "utf8",
  ),
);
const cached = await readdir(new URL("../.cache/", import.meta.url));
const decoded = cached.find(
  (f) => f.startsWith(data.source.sha256) && f.endsWith(".decoded.js"),
);
const game = extract(
  await readFile(new URL(`../.cache/${decoded}`, import.meta.url), "utf8"),
  { Path2D },
);
const fontBytes = await readFile(
  new URL(`../.cache/font.${data.rendering.fontSha256}.ttf`, import.meta.url),
);
GlobalFonts.register(fontBytes, data.rendering.font);
const proto = Object.getPrototypeOf(createCanvas(1, 1).getContext("2d"));
proto.As ??= function (s) {
  this.scale(s, s);
};
const petal = game.recipes[0].inputs[0].petal;

function recording(ctx, calls) {
  return new Proxy(ctx, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      return (...args) => {
        calls.push({
          method: key,
          args,
          font: target.font,
          fillStyle: target.fillStyle,
          strokeStyle: target.strokeStyle,
          lineWidth: target.lineWidth,
        });
        return value.apply(target, args);
      };
    },
    set(target, key, value) {
      return Reflect.set(target, key, value, target);
    },
  });
}

test("the original name renderer draws outlined text inside the full atlas cell", () => {
  const calls = [];
  const ctx = createCanvas(
    game.rendering.iconSize,
    game.rendering.iconSize,
  ).getContext("2d");
  game.label(recording(ctx, calls), petal);
  assert.ok(
    calls.some(
      (c) => c.method === "translate" && c.args[0] === 40 && c.args[1] === 70,
    ),
  );
  const stroke = calls.find((c) => c.method === "strokeText");
  const fill = calls.find((c) => c.method === "fillText");
  assert.equal(stroke.args[0].trim(), petal.name);
  assert.deepEqual(stroke.args, fill.args);
  assert.match(stroke.font, /bolder 16px/);
  assert.ok(stroke.font.includes(data.rendering.font));
  assert.match(stroke.strokeStyle, /^#(?:000|000000)$/);
  assert.match(fill.fillStyle, /^#(?:fff|ffffff)$/);
  assert.equal(stroke.lineWidth, 3);
});

test("the original list renderer draws angled quantities, including x1, above the slot", () => {
  const atlas = paintAtlasCell(game, petal, 0, createCanvas);
  const original = game.paintSlot;
  let calls;
  game.paintSlot = (host) => {
    calls = [];
    const ctx = host.canvas.getContext("2d");
    host.canvas.getContext = () => recording(ctx, calls);
    return original(host);
  };
  try {
    const one = paintTile(game, atlas, petal, 1, createCanvas).canvas;
    assert.equal(calls.find((c) => c.method === "fillText").args[0], "x1");
    const two = paintTile(game, atlas, petal, 2, createCanvas).canvas;
    const label = calls.find((c) => c.method === "fillText");
    assert.equal(label.args[0], "x2");
    assert.match(label.font, /bolder 28px/);
    assert.ok(
      calls.some(
        (c) => c.method === "translate" && c.args[0] === 87 && c.args[1] === 18,
      ),
    );
    assert.ok(
      calls.some((c) => c.method === "rotate" && c.args[0] === Math.PI / 6),
    );
    assert.ok(calls.some((c) => c.method === "stroke" && c.lineWidth === 13));
    // Quantity changes must leave the body and the name in the lower half intact.
    const lower = (c) =>
      Buffer.from(
        c.getContext("2d").getImageData(0, c.height / 2, c.width, c.height / 2)
          .data,
      );
    assert.deepEqual(lower(one), lower(two));
    const large = paintTile(game, atlas, petal, 1999, createCanvas).canvas;
    assert.equal(calls.find((c) => c.method === "fillText").args[0], "x1.99k");
    const edge = large
      .getContext("2d")
      .getImageData(0, 0, large.width, large.height).data;
    for (let i = 0; i < large.width; i++) {
      assert.equal(edge[i * 4 + 3], 0, "quantity clipped at top");
      assert.equal(
        edge[((i + 1) * large.width - 1) * 4 + 3],
        0,
        "quantity clipped at right",
      );
    }
  } finally {
    game.paintSlot = original;
  }
});

// Kitty's ears (scale(-1, 1)) and Nuke's sectors (rotate) are sub-paths built inside
// save()/restore(); @napi-rs/canvas misplaces them, so icons are drawn in Chromium.
test("Chromium draws transformed sub-paths of mirror-symmetric bodies symmetrically", async () => {
  const renderer = await openRenderer(game, fontBytes);
  try {
    for (const slug of ["kitty", "nuke"]) {
      const size = 160;
      const px = await renderer.page.evaluate(
        ({ slug, size }) => {
          const ctx = createCanvas(size, size).getContext("2d");
          ctx.scale(2, 2);
          result.draw(
            ctx,
            result.petals.find((p) => p.slug === slug),
            0,
          );
          return [...ctx.getImageData(0, 0, size, size).data];
        },
        { slug, size },
      );
      let left = size;
      let right = -1;
      for (let i = 0; i < px.length; i += 4)
        if (px[i + 3]) {
          left = Math.min(left, (i / 4) % size);
          right = Math.max(right, (i / 4) % size);
        }
      let painted = 0;
      let mismatched = 0;
      for (let y = 0; y < size; y++)
        for (let x = left; x <= right; x++) {
          const a = (y * size + x) * 4;
          const b = (y * size + left + right - x) * 4;
          if (px[a + 3] || px[b + 3]) painted++;
          if ([0, 1, 2, 3].some((k) => Math.abs(px[a + k] - px[b + k]) > 64))
            mismatched++;
        }
      assert.ok(painted > 1000, `${slug} body was drawn`);
      assert.ok(mismatched / painted < 0.01, `${slug} is mirror-symmetric`);
    }
  } finally {
    await renderer.close();
  }
});
