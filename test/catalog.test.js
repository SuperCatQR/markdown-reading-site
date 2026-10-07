import test from "node:test";
import assert from "node:assert/strict";
import { validateCatalog } from "../scripts/catalog.js";

const validEntry = {
  slug: "quiet-morning",
  title: "安静的早晨",
  date: "2026-10-07",
  summary: "一篇经过整理的阅读稿。",
  tags: ["随笔"],
  file: "quiet-morning.md",
};

test("accepts an empty publication catalog", () => {
  assert.deepEqual(validateCatalog([], []), []);
});

test("accepts a complete entry whose markdown file exists", () => {
  assert.deepEqual(validateCatalog([validEntry], ["quiet-morning.md"]), []);
});

test("rejects path traversal, duplicates, missing files, and unlisted files", () => {
  const unsafe = { ...validEntry, slug: "../private", file: "../private.md" };
  const errors = validateCatalog([validEntry, validEntry, unsafe], ["quiet-morning.md", "draft.md"]);
  assert.ok(errors.some((error) => error.includes("重复")));
  assert.ok(errors.some((error) => error.includes("slug 只能")));
  assert.ok(errors.some((error) => error.includes("未登记")));
});

test("rejects missing metadata and malformed dates", () => {
  const incomplete = { ...validEntry, title: "", date: "07/10/2026", tags: [] };
  const errors = validateCatalog([incomplete], ["quiet-morning.md"]);
  assert.ok(errors.some((error) => error.includes("title 为必填")));
  assert.ok(errors.some((error) => error.includes("YYYY-MM-DD")));
  assert.ok(errors.some((error) => error.includes("tags 必须")));
});

test("rejects impossible calendar dates", () => {
  const errors = validateCatalog([{ ...validEntry, date: "2026-02-30" }], ["quiet-morning.md"]);
  assert.ok(errors.some((error) => error.includes("有效的 YYYY-MM-DD")));
});

test("rejects metadata with incorrect field types", () => {
  const errors = validateCatalog([{ ...validEntry, title: 42, date: 20261007, summary: {} }], ["quiet-morning.md"]);
  assert.ok(errors.some((error) => error.includes("title 为必填")));
  assert.ok(errors.some((error) => error.includes("date 为必填")));
  assert.ok(errors.some((error) => error.includes("summary 为必填")));
});

test("validates review status and HTTPS Issue links", () => {
  const entry = {
    ...validEntry,
    reviewStatus: "pending-review",
    issueUrl: "https://github.com/SuperCatQR/bilibili-asr-archive/issues/new?title=review",
  };
  assert.deepEqual(validateCatalog([entry], [entry.file]), []);
  const errors = validateCatalog([{ ...entry, reviewStatus: "unknown", issueUrl: "javascript:alert(1)" }], [entry.file]);
  assert.ok(errors.some((error) => error.includes("reviewStatus 无效")));
  assert.ok(errors.some((error) => error.includes("HTTPS 地址")));
});
