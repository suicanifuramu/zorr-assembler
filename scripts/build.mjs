import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm, cp, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Path2D } from "@napi-rs/canvas";
import { webcrack } from "webcrack";
import deobfuscator from "zorr-deobfuscator";
import { extract } from "./lib/extract.mjs";
import { openRenderer } from "./lib/browser.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cache = path.join(root, ".cache");
const staging = path.join(cache, "site");
const upstream = "https://zorr.pages.dev/";
const hash = (data) => createHash("sha256").update(data).digest("hex");
const assetName = (stem, ext, bytes) =>
  `${stem}.${hash(bytes).slice(0, 12)}.${ext}`;
const log = (message) => console.log(`[build] ${message}`);

async function download(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}: ${url}`);
  return {
    body: await response.text(),
    type: response.headers.get("content-type"),
    url: response.url,
  };
}

async function main() {
  // Never serve a previous successful build after a failed refresh.
  await rm(path.join(root, "dist"), { recursive: true, force: true });
  await rm(staging, { recursive: true, force: true });
  await mkdir(path.join(staging, "assets"), { recursive: true });
  log(`Fetching ${upstream}`);
  const page = await download(upstream);
  const scripts = [
    ...page.body.matchAll(
      /<script\b[^>]*?\ssrc\s*=\s*["']([^"']+\.js(?:\?[^"']*)?)["']/gi,
    ),
  ];
  if (scripts.length !== 1)
    throw new Error(
      `Expected one upstream game script, found ${scripts.length}`,
    );
  const sourceUrl = new URL(scripts[0][1], page.url).href;
  if (new URL(sourceUrl).origin !== new URL(upstream).origin)
    throw new Error("Unexpected upstream script origin");
  const script = await download(sourceUrl);
  if (/html/i.test(script.type) || /^\s*</.test(script.body))
    throw new Error("Upstream game script returned HTML");
  const sourceHash = hash(script.body);
  const fetchedAt = new Date().toISOString();
  log(`Fetched ${sourceUrl} (${sourceHash.slice(0, 12)})`);
  // Cache only the expensive decode, keyed by bytes fetched on EVERY build and engine version.
  const engine = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  ).dependencies["zorr-deobfuscator"];
  const decodedFile = path.join(
    cache,
    `${sourceHash}.${hash(engine).slice(0, 12)}.decoded.js`,
  );
  let decoded;
  try {
    decoded = await readFile(decodedFile, "utf8");
    log("Reusing matching decoded source");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    log("Running webcrack and zorr-deobfuscator");
    const cracked = await webcrack(script.body);
    decoded = deobfuscator.deobfuscate(cracked.code, {
      log: (...messages) => {
        const message = messages.join(" ");
        if (/^Phase|^  [\d]|^Size:/.test(message)) log(message.trim());
      },
    }).code;
    await writeFile(decodedFile, decoded);
  }
  const game = extract(decoded, { Path2D });
  const petals = new Map();
  const quantities = new Map();
  const items = (list) =>
    list.map(({ petal, count }) => {
      petals.set(petal.slug, petal);
      if (!quantities.has(petal.slug)) quantities.set(petal.slug, new Set());
      quantities.get(petal.slug).add(count);
      return { slug: petal.slug, count };
    });
  const recipes = game.recipes.map((r) => ({
    id: r.id,
    inputs: items(r.inputs),
    outputs: items(r.outputs),
  }));
  const images = {};
  if (!/^[\w -]+$/.test(game.rendering.font))
    throw new Error(`Unsafe font family ${game.rendering.font}`);
  const fontStyleURL = new URL("https://fonts.googleapis.com/css2");
  fontStyleURL.searchParams.set("family", game.rendering.font);
  // One subset serves both the icon renderer and the page text (printable ASCII + "–…").
  const ascii = String.fromCharCode(
    ...Array.from({ length: 95 }, (_, i) => i + 32),
  );
  const characters = [
    ...new Set([...petals.values()].map((p) => p.name).join("") + ascii + "–…"),
  ].join("");
  fontStyleURL.searchParams.set("text", characters);
  const fontStyle = await download(fontStyleURL.href);
  const fontURL = fontStyle.body.match(/src:\s*url\(([^)]+)\)/)?.[1];
  if (!fontURL) throw new Error("Upstream icon font URL was not found");
  const fontResponse = await fetch(fontURL, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!fontResponse.ok) throw new Error(`Font HTTP ${fontResponse.status}`);
  const fontBytes = Buffer.from(await fontResponse.arrayBuffer());
  const fontHash = hash(fontBytes);
  await writeFile(path.join(cache, `font.${fontHash}.ttf`), fontBytes);
  log(`Loaded upstream icon font: ${game.rendering.font}`);
  let tileRendering;
  const renderer = await openRenderer(game, fontBytes);
  log(`Rendering with Chromium ${renderer.version}`);
  // This is the original icon renderer. Supply the lowest body count while retaining
  // the original size/position/angle; Super is a presentation color, not a quantity.
  try {
    for (const [slug, petal] of petals) {
      if (!/^[a-z\d_]+$/.test(slug))
        throw new Error(`Unsafe petal slug ${slug}`);
      const counts = game.rarities.map((r) =>
        game.property(petal, "count", r.id),
      );
      if (!counts.every((c) => Number.isSafeInteger(c) && c >= 0))
        throw new Error(`Invalid body count ${slug}`);
      const minimum = Math.min(...counts);
      const rarity = game.rarities[counts.indexOf(minimum)];
      const variants = {};
      for (const { count, png, ...layout } of await renderer.render(
        petal.id,
        rarity.id,
        quantities.get(slug),
      )) {
        tileRendering = layout;
        const bytes = Buffer.from(png, "base64");
        const file = assetName(`petal-${slug}-${count}`, "png", bytes);
        await writeFile(path.join(staging, "assets", file), bytes);
        variants[count] = `./${file}`;
      }
      images[slug] = { name: petal.name, images: variants, bodies: minimum };
    }
  } finally {
    await renderer.close();
  }
  const data = {
    schemaVersion: 2,
    source: {
      homepage: upstream,
      script: sourceUrl,
      sha256: sourceHash,
      fetchedAt,
      extraction: game.extraction,
    },
    intervalMs: game.intervalMs,
    rendering: {
      ...game.rendering,
      ...tileRendering,
      engine: `Chromium ${renderer.version}`,
      fontURL,
      fontStyleURL: fontStyleURL.href,
      fontSha256: fontHash,
    },
    rarity: {
      name: game.superRarity.name,
      slug: game.superRarity.slug,
      color: game.superRarity.color,
    },
    recipes,
    petals: images,
  };
  const dataJSON = JSON.stringify(data);
  const dataFile = assetName("recipes", "json", dataJSON);
  await writeFile(path.join(staging, "assets", dataFile), dataJSON);
  const schedule = await readFile(path.join(root, "src/schedule.mjs"), "utf8");
  const scheduleFile = assetName("schedule", "js", schedule);
  await writeFile(path.join(staging, "assets", scheduleFile), schedule);
  const app = (await readFile(path.join(root, "src/app.js"), "utf8"))
    .replace("./schedule.mjs", `./${scheduleFile}`)
    .replace("__DATA_URL__", `./${dataFile}`);
  const appFile = assetName("app", "js", app);
  await writeFile(path.join(staging, "assets", appFile), app);
  const fontFile = assetName("font", "ttf", fontBytes);
  await writeFile(path.join(staging, "assets", fontFile), fontBytes);
  const css =
    `@font-face{font-family:"${game.rendering.font}";src:url(./${fontFile}) format("truetype");font-display:swap}\n` +
    `:root{--font:"${game.rendering.font}";--super:${data.rarity.color};--petal-image-size:${(1 + (2 * data.rendering.padding) / data.rendering.tileSize) * 100}%;--petal-image-offset:${(-data.rendering.padding / data.rendering.tileSize) * 100}%}\n` +
    (await readFile(path.join(root, "src/style.css"), "utf8"));
  const cssFile = assetName("style", "css", css);
  await writeFile(path.join(staging, "assets", cssFile), css);
  const html = (await readFile(path.join(root, "src/index.html"), "utf8"))
    .replace("__STYLE_URL__", `./assets/${cssFile}`)
    .replace("__APP_URL__", `./assets/${appFile}`);
  await writeFile(path.join(staging, "index.html"), html);
  await cp(path.join(root, "public"), staging, { recursive: true });
  await rename(staging, path.join(root, "dist"));
  log(
    `${recipes.length} recipes, ${petals.size} icons, interval ${game.intervalMs}ms, ${data.rarity.name} ${data.rarity.color}`,
  );
  log("Static Cloudflare Pages site ready in dist/");
}

main().catch((error) => {
  console.error("[build] FAILED:", error);
  process.exitCode = 1;
});
