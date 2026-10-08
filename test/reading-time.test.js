import test from "node:test";
import assert from "node:assert/strict";
import { estimateReadingMinutes } from "../src/reading-time.js";

test("estimates Chinese reading time from CJK characters", () => {
  assert.equal(estimateReadingMinutes("中".repeat(801)), 3);
});

test("estimates Latin reading time from words", () => {
  assert.equal(estimateReadingMinutes(Array.from({ length: 441 }, () => "word").join(" ")), 3);
});
