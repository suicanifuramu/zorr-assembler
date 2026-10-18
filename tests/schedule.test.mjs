import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatRemaining,
  formatUntil,
  scheduleAt,
  slotAt,
} from "../src/schedule.mjs";

// Different recipe count and interval from the live game catch baked-in game values.
const recipes = Array.from({ length: 7 }, (_, id) => ({ id }));
const interval = 37_000;

test("switches at the exact epoch boundary and wraps the recipe cycle", () => {
  const boundary = recipes.length * interval;
  const before = scheduleAt(boundary - 1, recipes, interval);
  assert.equal(before.current.recipe.id, 6);
  assert.equal(before.next.recipe.id, 0);
  assert.equal(before.current.end, boundary);
  const after = scheduleAt(boundary, recipes, interval);
  assert.equal(after.previous.recipe.id, 6);
  assert.equal(after.current.recipe.id, 0);
  assert.equal(after.next.recipe.id, 1);
  assert.equal(after.current.start, boundary);
});

test("featured and upcoming recipes form one chronological cycle without duplicates", () => {
  const s = scheduleAt(1_543_210, recipes, interval);
  const all = [s.previous, s.current, s.next, ...s.upcoming];
  assert.equal(all.length, recipes.length);
  assert.equal(new Set(all.map((e) => e.recipe.id)).size, recipes.length);
  for (let i = 1; i < all.length; i++)
    assert.equal(all[i - 1].end, all[i].start);
});

test("handles the epoch and negative previous slot correctly", () => {
  const s = scheduleAt(0, recipes, interval);
  assert.equal(s.previous.recipe.id, 6);
  assert.equal(s.current.recipe.id, 0);
  assert.equal(s.previous.start, -interval);
});

test("rejects invalid clock and upstream interval values", () => {
  assert.throws(() => slotAt(NaN, interval), RangeError);
  assert.throws(() => slotAt(1, 0), RangeError);
  assert.throws(() => slotAt(1, 1.5), RangeError);
});

test("formats start times as minutes, hours and, from 24 hours, days", () => {
  const minute = 60_000;
  assert.equal(formatUntil(54 * minute - 30_000), "in 54m");
  assert.equal(formatUntil(114 * minute), "in 1h 54m");
  assert.equal(formatUntil(24 * 60 * minute - 1), "in 1d 0h 0m");
  assert.equal(formatUntil((23 * 60 + 59) * minute), "in 23h 59m");
  assert.equal(formatUntil((27 * 60 + 54) * minute), "in 1d 3h 54m");
  assert.equal(formatUntil((48 * 60 + 5) * minute), "in 2d 0h 5m");
  assert.equal(formatRemaining(53 * minute + 20_500), "53:21 left");
});
