import {
  formatRemaining,
  formatUntil,
  recipeAtSlot,
  slotAt,
} from "./schedule.mjs";
import { drawQuantity } from "./quantity.mjs";

const list = document.getElementById("list");
const status = document.getElementById("status");
const counter = document.getElementById("counter");
const input = document.getElementById("assembles");
const maxAssembles = Number(input.max);
const dataURL = new URL("__DATA_URL__", import.meta.url);
// Times follow the device clock and its local time zone (no fixed zone).
const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// The icon font has no arrow glyph, so draw it instead of falling back to a system font.
const arrow =
  '<svg viewBox="0 0 20 12" width="20" height="12" aria-label="makes"><path d="M1 6h17M13 1l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
let data;
let entries;
let renderedSlot;
let assembles = 1;
const labels = new Map();

// Quantity label layer, drawn by the game's own label pass with the build-time
// slot geometry, so tile PNG + label equals the original single-canvas rendering.
function label(count) {
  if (!labels.has(count)) {
    const { pixelSize, tileSize, padding } = data.rendering;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = pixelSize;
    const ctx = canvas.getContext("2d");
    const scale = pixelSize / (tileSize + 2 * padding);
    ctx.scale(scale, scale);
    drawQuantity(ctx, {
      offsetLeft: padding,
      offsetTop: padding,
      offsetWidth: tileSize,
      Hh: count,
    });
    labels.set(count, canvas.toDataURL());
  }
  return labels.get(count);
}

function petals(items) {
  const size = data.rendering.pixelSize;
  return items
    .map(({ slug, count }) => {
      const p = data.petals[slug];
      const total = count * assembles;
      const src = new URL(p.image, dataURL).href;
      return `<span class="p"><img src="${escape(src)}" width="${size}" height="${size}" alt="${escape(p.name)} ×${total}"><img class="q" src="${label(total)}" width="${size}" height="${size}" alt=""></span>`;
    })
    .join("");
}

function setAssembles(value, rewrite = true) {
  const n = Math.min(maxAssembles, Math.max(1, Math.round(value) || 1));
  if (rewrite) input.value = n;
  if (n === assembles) return;
  assembles = n;
  try {
    localStorage.setItem("assembles", n);
  } catch {}
  renderedSlot = undefined;
  update();
}

function render(slot) {
  entries = data.recipes.map((_, i) =>
    recipeAtSlot(slot + i, data.recipes, data.intervalMs),
  );
  let html = "";
  let lastDay;
  for (const [i, { recipe, start, end }] of entries.entries()) {
    const day = dayFormat.format(start);
    if (day !== lastDay) html += `<h2>${day}</h2>`;
    lastDay = day;
    html += `<section class="row${i ? "" : " now"}"><p>${timeFormat.format(start)}–${timeFormat.format(end)} <b></b></p><div>${petals(recipe.inputs)}${arrow}${petals(recipe.outputs)}</div></section>`;
  }
  list.innerHTML = html;
  renderedSlot = slot;
}

function update() {
  const now = Date.now();
  const slot = slotAt(now, data.intervalMs);
  if (slot !== renderedSlot) render(slot);
  list.querySelectorAll("b").forEach((label, i) => {
    label.textContent = i
      ? formatUntil(entries[i].start - now)
      : formatRemaining(entries[0].end - now);
  });
}

try {
  const response = await fetch(dataURL);
  if (!response.ok) throw new Error(`Data HTTP ${response.status}`);
  data = await response.json();
  if (data.schemaVersion !== 3 || !data.recipes.length || !data.intervalMs)
    throw new Error("Invalid recipe data");
  // Labels are canvas text: wait for the icon font so they never use a fallback.
  await document.fonts
    .load(`28px "${data.rendering.font}"`)
    .catch(console.error);
  try {
    assembles = Number(localStorage.getItem("assembles")) || 1;
  } catch {}
  setAssembles(assembles);
  update();
  status.remove();
  setInterval(update, 1000);
  counter.addEventListener("click", (event) => {
    const step = event.target.closest("button")?.dataset.step;
    if (step) setAssembles(assembles + Number(step));
  });
  input.addEventListener("input", () => {
    if (input.validity.valid && input.value)
      setAssembles(input.valueAsNumber, false);
  });
  input.addEventListener("change", () => setAssembles(input.valueAsNumber));
} catch (error) {
  status.textContent = "Failed to load recipes. Please reload.";
  console.error(error);
}
