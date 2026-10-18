export function slotAt(now, intervalMs) {
  if (
    !Number.isFinite(now) ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0
  )
    throw new RangeError("Invalid clock or interval");
  return Math.floor(now / intervalMs);
}

export function recipeAtSlot(slot, recipes, intervalMs) {
  if (!Number.isSafeInteger(slot) || !recipes.length)
    throw new RangeError("Invalid slot or empty recipes");
  const index = ((slot % recipes.length) + recipes.length) % recipes.length;
  return {
    slot,
    recipe: recipes[index],
    start: slot * intervalMs,
    end: (slot + 1) * intervalMs,
  };
}

export function scheduleAt(now, recipes, intervalMs) {
  const slot = slotAt(now, intervalMs);
  const at = (offset) => recipeAtSlot(slot + offset, recipes, intervalMs);
  return {
    previous: at(-1),
    current: at(0),
    next: at(1),
    upcoming: Array.from(
      { length: Math.max(0, recipes.length - 3) },
      (_, index) => at(index + 2),
    ),
  };
}

// "in 54m", "in 3h 54m", and from 24 hours on "in 1d 3h 54m".
export function formatUntil(ms) {
  const minutes = Math.ceil(ms / 60_000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return `in ${d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`}`;
}

export function formatRemaining(ms) {
  const seconds = Math.ceil(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h ? `${h}:` : ""}${m}:${s} left`;
}
