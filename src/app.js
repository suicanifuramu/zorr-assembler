import { scheduleAt, slotAt } from "./schedule.mjs";

const $ = (selector) => document.querySelector(selector);
const dataURL = new URL("__DATA_URL__", import.meta.url);
const zone = "Asia/Tokyo";
const format = (options) =>
  new Intl.DateTimeFormat("ja-JP", { timeZone: zone, ...options });
const clockFormat = format({
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const timeFormat = format({
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayFormat = format({
  month: "numeric",
  day: "numeric",
  weekday: "short",
});
const dateKey = format({ year: "numeric", month: "2-digit", day: "2-digit" });
const quantity = new Intl.NumberFormat("ja-JP");
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let data;
let schedule;
let renderedSlot;
let ticker;

function petal(item, compact = false) {
  const p = data.petals[item.slug];
  return `<div class="petal ${compact ? "petal-compact" : ""}" title="${escape(p.name)} × ${item.count}">
    <div class="petal-picture"><img src="${escape(new URL(p.image, dataURL).href)}" width="160" height="136" alt="" loading="${compact ? "lazy" : "eager"}" decoding="async"><span class="petal-quantity">×${quantity.format(item.count)}</span></div>
    <span class="petal-name" lang="en">${escape(p.name)}</span><span class="sr-only"> ${item.count}個</span>
  </div>`;
}

function group(items, compact) {
  return `<div class="petal-group">${items.map((item, i) => `<div class="petal-term">${i ? '<span class="plus" aria-hidden="true">+</span>' : ""}${petal(item, compact)}</div>`).join("")}</div>`;
}

function formula(recipe, compact = false) {
  return `<div class="recipe-formula"><div class="recipe-side"><span class="side-label">材料</span>${group(recipe.inputs, compact)}</div><span class="recipe-arrow" aria-label="から完成"><svg viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12h26M19 3l9 9-9 9"/></svg></span><div class="recipe-side recipe-output"><span class="side-label">完成</span>${group(recipe.outputs, compact)}</div></div>`;
}

function range(entry) {
  const start = `<time datetime="${new Date(entry.start).toISOString()}">${timeFormat.format(entry.start)}</time>`;
  const end = `<time datetime="${new Date(entry.end).toISOString()}">${timeFormat.format(entry.end)}</time>`;
  return `${start}<span class="time-dash">—</span>${end}`;
}

function card(entry, kind) {
  const current = kind === "current";
  const labels = {
    current: ["NOW", "現在のレシピ"],
    previous: ["PREVIOUS", "前のレシピ"],
    next: ["NEXT", "次のレシピ"],
  };
  const [english, label] = labels[kind];
  const names = entry.recipe.outputs
    .map((item) => escape(data.petals[item.slug].name))
    .join(" + ");
  return `<article class="recipe-card recipe-card-${kind}" data-recipe-id="${entry.recipe.id}" aria-label="${label}">
    <div class="card-top"><h2><span class="${current ? "live-dot" : "card-marker"}" aria-hidden="true">${current ? "" : kind === "previous" ? "←" : "→"}</span>${label}</h2><span class="card-english">${english}</span></div>
    <div class="card-time"><span class="card-date">${dayFormat.format(entry.start)}</span><div>${range(entry)}</div></div>
    <h3 class="output-title">${names}</h3>
    ${formula(entry.recipe)}
    ${current ? '<div class="countdown-panel"><div class="countdown-label"><span>次のレシピまで</span><span id="countdown" aria-live="off"></span></div><div class="progress-track"><div id="progress" class="progress-fill"></div></div></div>' : `<p class="card-foot">${kind === "next" ? "このあと切り替わります" : "終了したレシピ"}</p>`}
  </article>`;
}

function renderTimeline() {
  const query = $("#search").value.trim().toLocaleLowerCase();
  const entries = schedule.upcoming.filter(
    ({ recipe }) =>
      !query ||
      [...recipe.inputs, ...recipe.outputs].some((item) =>
        `${data.petals[item.slug].name} ${item.slug}`
          .toLocaleLowerCase()
          .includes(query),
      ),
  );
  let lastDay;
  let html = "";
  for (const entry of entries) {
    const day = dateKey.format(entry.start);
    if (day !== lastDay) {
      if (lastDay) html += "</div></section>";
      html += `<section class="day-group" aria-label="${dayFormat.format(entry.start)}"><h3 class="day-heading">${dayFormat.format(entry.start)}<span aria-hidden="true"></span></h3><div class="day-recipes">`;
      lastDay = day;
    }
    html += `<article class="timeline-row" data-recipe-id="${entry.recipe.id}"><div class="row-time">${range(entry)}</div>${formula(entry.recipe, true)}</article>`;
  }
  if (lastDay) html += "</div></section>";
  $("#timeline").innerHTML = html;
  $("#empty").hidden = entries.length > 0;
  $("#search-results").textContent = query ? `${entries.length}件のレシピ` : "";
  const hours = (data.recipes.length * data.intervalMs) / 3_600_000;
  $("#schedule-summary").textContent =
    `${data.recipes.length}レシピ · ${quantity.format(hours)}時間で一巡`;
}

function update(now = Date.now()) {
  $("#clock").textContent = clockFormat.format(now);
  const slot = slotAt(now, data.intervalMs);
  if (slot !== renderedSlot) {
    const wasRendered = renderedSlot !== undefined;
    schedule = scheduleAt(now, data.recipes, data.intervalMs);
    $("#featured").innerHTML =
      card(schedule.current, "current") +
      card(schedule.previous, "previous") +
      card(schedule.next, "next");
    renderTimeline();
    if (wasRendered)
      $("#announcement").textContent =
        `現在のレシピが ${schedule.current.recipe.outputs.map((p) => data.petals[p.slug].name).join("、")} に切り替わりました。`;
    renderedSlot = slot;
  }
  const remaining = Math.max(0, schedule.current.end - now);
  const seconds = Math.ceil(remaining / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  $("#countdown").textContent =
    `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  $("#progress").style.transform =
    `scaleX(${Math.max(0, Math.min(1, remaining / data.intervalMs))})`;
}

async function init() {
  const response = await fetch(dataURL);
  if (!response.ok) throw new Error(`Data HTTP ${response.status}`);
  data = await response.json();
  if (
    data.schemaVersion !== 1 ||
    !data.recipes.length ||
    !data.intervalMs ||
    !data.petals
  )
    throw new Error("Invalid recipe data");
  $("#rarity-name").textContent = data.rarity.name;
  $("#source-updated").textContent =
    `データ取得 ${format({ month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(data.source.fetchedAt))} JST`;
  $("#source-link").href = data.source.script;
  update();
  $("#loading").hidden = true;
  $("#featured").hidden = false;
  $("#schedule").hidden = false;
  ticker = setInterval(() => update(), 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) update();
  });
  window.addEventListener("pageshow", () => update());
  $("#search").addEventListener("input", renderTimeline);
}

$("#retry").addEventListener("click", () => location.reload());
init().catch((error) => {
  clearInterval(ticker);
  $("#loading").hidden = true;
  $("#error").hidden = false;
  console.error(error);
});
