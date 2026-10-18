import { createCanvas } from "@napi-rs/canvas";

const proto = Object.getPrototypeOf(createCanvas(1, 1).getContext("2d"));
if (!proto.As)
  proto.As = function (s) {
    this.scale(s, s);
  };

// DOM/event adapters for an idle, single-slot instance of the original list renderer.
// Background, clipping, border, sprite transfer, text and quantity calls remain upstream.
export function paintTile(game, atlas, petal, count) {
  const tileSize = game.rendering.tileSize;
  const padding = tileSize / 2;
  const extent = tileSize + 2 * padding;
  const canvas = createCanvas(1, 1);
  canvas.style = {};
  const parent = {
    style: {},
    offsetWidth: extent,
    offsetHeight: extent,
    scrollTop: 0,
    getBoundingClientRect() {
      return { width: extent };
    },
    appendChild() {},
  };
  const slot = {
    kc: petal.id,
    vc: game.superRarity.id,
    Hh: count,
    offsetLeft: padding,
    offsetTop: padding,
    offsetWidth: tileSize,
    offsetHeight: tileSize,
  };
  const grid = { parentNode: parent, children: [slot] };
  const mapping = { [`petal-${petal.id}-${game.superRarity.id}`]: [0, 0] };
  game.paintSlot({ canvas, atlas, mapping, grid });
  return { canvas, padding, tileSize, pixelSize: canvas.width };
}

export function paintAtlasCell(game, petal, rarity) {
  const size = game.rendering.iconSize;
  const canvas = createCanvas(size * 2, size * 2);
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  game.draw(ctx, petal, rarity);
  game.label(ctx, petal);
  canvas.uh = canvas.width;
  return canvas;
}
