import {
  formatRemaining,
  formatUntil,
  recipeAtSlot,
  slotAt,
} from "./schedule.mjs";

const list = document.getElementById("list");
const status = document.getElementById("status");
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

function petals(items) {
  return items
    .map(({ slug, count }) => {
      const p = data.petals[slug];
      const src = new URL(p.images[count], dataURL).href;
      return `<span class="p"><img src="${escape(src)}" width="${data.rendering.pixelSize}" height="${data.rendering.pixelSize}" alt="${escape(p.name)} ×${count}"></span>`;
    })
    .join("");
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
  if (data.schemaVersion !== 2 || !data.recipes.length || !data.intervalMs)
    throw new Error("Invalid recipe data");
  update();
  status.remove();
  setInterval(update, 1000);
} catch (error) {
  status.textContent = "Failed to load recipes. Please reload.";
  console.error(error);
}
