import test from "node:test";
import assert from "node:assert/strict";
import { createResourceCache } from "../src/refactor/services/resource-cache.js";

test("resource cache evicts least recently used entries within entry and memory budgets", async () => {
  const requests = [];
  const load = createResourceCache(async (url) => { requests.push(url); return new Response("x".repeat(20)); }, { maxBytes: 336, maxEntries: 2 });
  for (const url of ["a", "b", "a", "c", "a", "b"]) await load(url, { text: true });
  assert.deepEqual(requests, ["a", "b", "c", "b"]);
});

test("oversized values are served without displacing or exceeding the cache budget", async () => {
  const requests = [];
  const load = createResourceCache(async (url) => { requests.push(url); return new Response(url === "large" ? "x".repeat(100) : "small"); }, { maxBytes: 200 });
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

test("original UTF-8 text retains BOM and CRLF bytes through loading and cached reuse", async () => {
  const bytes = new TextEncoder().encode("\uFEFF# 原文\r\n\r\n完整的 Markdown & <文本>\r\n");
  let requests = 0;
  const load = createResourceCache(async () => { requests++; return new Response(bytes); });
  for (let attempt = 0; attempt < 2; attempt++) {
    const source = await load("/original.md", { text: true });
    assert.equal(source.codePointAt(0), 0xfeff);
    assert.deepEqual(new TextEncoder().encode(source), bytes);
  }
  assert.equal(requests, 1);
});

test("malformed UTF-8 text is rejected without caching and a valid retry retains exact bytes", async () => {
  const valid = new TextEncoder().encode("\uFEFF# 可重试\r\n");
  let requests = 0;
  const load = createResourceCache(async () => new Response(++requests === 1 ? new Uint8Array([0xc3, 0x28]) : valid));
  await assert.rejects(load("/original.md", { text: true }), TypeError);
  assert.deepEqual(new TextEncoder().encode(await load("/original.md", { text: true })), valid);
  assert.equal(requests, 2);
  assert.deepEqual(new TextEncoder().encode(await load("/original.md", { text: true })), valid);
  assert.equal(requests, 2);
});
