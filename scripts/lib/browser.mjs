import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";
import { paintAtlasCell, paintTile } from "./paint.mjs";

// Canvas paths with transforms must run in a real browser: the native Node
// implementation distorts Kitty's ears, Nuke's sectors and Plasma's bolts.
// Chromium and the extracted game runtime are used only during the build.
export async function openRenderer(game, fontBytes) {
  const browser = await playwright.launch({
    executablePath: await chromium.executablePath(),
    args: chromium.args,
    headless: true,
  });
  try {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.evaluate(
      async ({ runtime, rendering, rarity, font }) => {
        window.IS_PROD = true;
        CanvasRenderingContext2D.prototype.As = function (scale) {
          this.scale(scale, scale);
        };
        new Function(runtime)();
        Object.assign(globalThis.result, { rendering, superRarity: rarity });
        const face = new FontFace(
          rendering.font,
          `url(data:font/ttf;base64,${font})`,
        );
        await face.load();
        document.fonts.add(face);
      },
      {
        runtime: game.runtimeCode,
        rendering: game.rendering,
        rarity: { id: game.superRarity.id },
        font: fontBytes.toString("base64"),
      },
    );
    await page.addScriptTag({
      content: `globalThis.paintAtlasCell=${paintAtlasCell};globalThis.paintTile=${paintTile};
        globalThis.createCanvas=(width,height)=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c;};`,
    });
    return {
      page,
      version: browser.version(),
      close: () => browser.close(),
      // Label-free tile (no quantity): the viewer draws the label pass on top.
      render: (id, rarity) =>
        page.evaluate(
          ({ id, rarity }) => {
            const game = globalThis.result;
            const petal = game.petals[id];
            const atlas = paintAtlasCell(game, petal, rarity, createCanvas);
            const { canvas, ...layout } = paintTile(
              game,
              atlas,
              petal,
              0,
              createCanvas,
            );
            return {
              ...layout,
              png: canvas.toDataURL("image/png").split(",")[1],
            };
          },
          { id, rarity },
        ),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
