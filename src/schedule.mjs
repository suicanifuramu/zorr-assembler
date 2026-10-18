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
