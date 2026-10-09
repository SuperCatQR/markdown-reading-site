import test from "node:test";
import assert from "node:assert/strict";
import { createSearchLoader } from "../src/search-loader.js";

const urls = { published: "/published.json", drafts: "/drafts.json" };

test("concurrent directory and reader search share pending indices and report stage timings without queries", async () => {
  const requests = [];
  const releases = new Map();
  const stages = [];
  const loader = createSearchLoader(urls, { fetchIndex: (url) => {
    requests.push(url);
    return new Promise((resolve) => releases.set(url, resolve));
  }, measure: (stage, start, detail) => stages.push({ stage, detail }) });
  const all = loader("all");
  const drafts = loader("drafts");
  assert.equal(loader("all"), all);
  assert.deepEqual(requests, [urls.published, urls.drafts]);
  for (const url of requests) releases.get(url)({ ok: true, text: async () => JSON.stringify({ [url]: [{ text: "原文", id: "passage-1" }] }) });
  assert.deepEqual(Object.keys(await all), requests);
  assert.equal(await drafts, await loader("drafts"));
  for (const stage of ["response", "download", "parse", "normalize", "memory-cache"]) assert.ok(stages.some((sample) => sample.stage === stage), stage);
  assert.ok(stages.every(({ detail }) => !Object.hasOwn(detail, "query")));
});

test("failed transport and malformed indices evict failed promises so retry actually requests new data", async () => {
  for (const failure of [() => Promise.reject(Error("offline")), () => Promise.resolve({ ok: false }),
    () => Promise.resolve({ ok: true, text: async () => "broken json" })]) {
    let attempts = 0;
    const loader = createSearchLoader(urls, { fetchIndex: (url) => {
      if (url === urls.published) return Promise.resolve({ ok: true, text: async () => "{}" });
      return ++attempts === 1 ? failure() : Promise.resolve({ ok: true, text: async () => "{}" });
    }, measure: () => {} });
    await assert.rejects(loader("all"));
    assert.deepEqual(await loader("all"), {});
    assert.equal(attempts, 2);
  }
});
