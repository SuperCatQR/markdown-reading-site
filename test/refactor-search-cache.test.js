import test from "node:test";
import assert from "node:assert/strict";
import { createResourceCache } from "../src/refactor/services/resource-cache.js";

test("resource cache evicts least recently used entries within entry and memory budgets", async () => {
  const requests = [];
  const load = createResourceCache(async (url) => { requests.push(url); return { ok: true, text: async () => "x".repeat(20) }; }, { maxBytes: 336, maxEntries: 2 });
  for (const url of ["a", "b", "a", "c", "a", "b"]) await load(url, { text: true });
  assert.deepEqual(requests, ["a", "b", "c", "b"]);
});

test("oversized values are served without displacing or exceeding the cache budget", async () => {
  const requests = [];
  const load = createResourceCache(async (url) => { requests.push(url); return { ok: true, text: async () => url === "large" ? "x".repeat(100) : "small" }; }, { maxBytes: 200 });
  for (const url of ["small", "large", "large", "small"]) await load(url, { text: true });
  assert.deepEqual(requests, ["small", "large", "large"]);
});

test("failed responses, invalid resources, and aborted completion are never retained", async () => {
  for (const failure of ["http", "validation", "abort"]) {
    const controller = new AbortController(); let requests = 0;
    const load = createResourceCache(async () => {
      requests++; return { ok: !(failure === "http" && requests === 1), json: async () => { if (failure === "abort" && requests === 1) controller.abort(); return { attempt: requests }; } };
    });
    await assert.rejects(load("a", { signal: controller.signal, validate(value) { if (failure === "validation" && value.attempt === 1) throw Error("invalid"); return value; } }));
    assert.equal((await load("a")).attempt, 2);
  }
});

test("concurrent callers own independent cancellation and successful work remains reusable", async () => {
  const requests = [];
  const load = createResourceCache((url, { signal }) => new Promise((resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true }); requests.push({ resolve, signal });
  }));
  const aborted = new AbortController(), active = new AbortController();
  const first = load("same", { signal: aborted.signal });
  const second = load("same", { signal: active.signal });
  aborted.abort(); await assert.rejects(first, { name: "AbortError" });
  requests[1].resolve({ ok: true, json: async () => ({ safe: true }) });
  assert.deepEqual(await second, { safe: true }); assert.equal(active.signal.aborted, false);
  assert.deepEqual(await load("same"), { safe: true }); assert.equal(requests.length, 2);
});

test("cache hits still validate caller expectations and respect an already aborted signal", async () => {
  let requests = 0;
  const load = createResourceCache(async () => { requests++; return { ok: true, json: async () => ({ id: 1 }) }; });
  await load("same");
  await assert.rejects(load("same", { validate() { throw Error("different identity"); } }), /different identity/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(load("same", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(requests, 1);
});
