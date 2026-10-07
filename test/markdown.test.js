import test from "node:test";
import assert from "node:assert/strict";
import { markdown } from "../src/markdown.js";

test("renders plain text instead of raw HTML", () => {
  const html = markdown.render("<script>alert(1)</script>");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("hardens external links and rejects javascript URLs", () => {
  const html = markdown.render("[outside](https://example.com)\n\n[unsafe](javascript:alert(1))");
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /href="javascript:/);
});
