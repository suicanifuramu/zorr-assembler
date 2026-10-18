import { recipeAtSlot, slotAt } from "./schedule.mjs";

const list = document.getElementById("list");
const status = document.getElementById("status");
const dataURL = new URL("__DATA_URL__", import.meta.url);
// Times follow the device clock and its local time zone (no fixed zone).
const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  weekday: "short",
});
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
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

function until(ms) {
  const minutes = Math.ceil(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h ? `${h}時間` : ""}${m || !h ? `${m}分` : ""}後`;
}

function countdown(ms) {
  const seconds = Math.ceil(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `残り ${h ? `${h}:` : ""}${m}:${s}`;
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
    html += `<section class="row${i ? "" : " now"}"><p>${timeFormat.format(start)}–${timeFormat.format(end)}<b></b></p><div>${petals(recipe.inputs)}<i>→</i>${petals(recipe.outputs)}</div></section>`;
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
      ? until(entries[i].start - now)
      : countdown(entries[0].end - now);
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
  status.textContent = "読み込めませんでした。再読み込みしてください。";
  console.error(error);
}
