import test from "node:test";
import assert from "node:assert/strict";
import { createReaderSession, prepareReaderDocument, readerPositionForRoute } from "../src/refactor/features/reader-session.js";

const entries = [0, 1, 3].map((partIndex) => ({ editionId: String(partIndex + 1).padStart(32, "0"), manuscriptType: "publication-draft", platform: "bilibili", externalVideoId: "BVcase", partIndex }));
test("canonical reload restores a validated paragraph fraction while explicit links and stale versions do not", () => {
  const route = { name: "read", editionId: entries[0].editionId, block: "passage-8" };
  const record = { editionId: route.editionId, anchor: route.block, offset: .619 };
  const local = { status: "valid", record };
  assert.equal(readerPositionForRoute(route, { local, reload: true }), record);
  const explicit = { editionId: route.editionId, anchor: route.block };
  assert.deepEqual(readerPositionForRoute(route, { local }), explicit);
  assert.deepEqual(readerPositionForRoute(route, { local: { ...local, status: "stale" }, reload: true }), explicit);
  assert.deepEqual(readerPositionForRoute(route, { local: { status: "valid", record: { ...record, editionId: entries[1].editionId } }, reload: true }), explicit);
  assert.deepEqual(readerPositionForRoute(route, { local: { status: "valid", record: { ...record, anchor: "passage-9" } }, reload: true }), explicit);
  assert.deepEqual(readerPositionForRoute({ ...route, name: "verify" }, { local, reload: true }), explicit);
  assert.equal(readerPositionForRoute({ ...route, block: "" }, { local }), record);
});
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function repository(loadBody) {
  return { findEdition: (id) => entries.find((entry) => entry.editionId === id), list: () => [...entries].reverse(), loadBody, loadReview: loadBody };
}
test("reader append loads exact numeric next P and keeps the previous document and canonical anchors", async () => {
  const calls = [];
  const session = createReaderSession(repository(async (entry) => { calls.push(entry.partIndex); return `# P${entry.partIndex + 1}\n\n正文\n\n[段落](#passage-1)`; }), { name: "read", editionId: entries[0].editionId, flow: true });
  await session.load();
  const first = session.documents.get(entries[0].editionId);
  const second = await session.append();
  assert.deepEqual(calls, [0, 1]);
  assert.equal(second.entry.editionId, entries[1].editionId);
  assert.equal(session.documents.get(entries[0].editionId), first);
  assert.equal(session.next.partIndex, 3);
  assert.equal(second.prepared.blocks[0].id, "passage-1");
  assert.match(second.prepared.body, new RegExp(`id="e-${entries[1].editionId}-passage-1" data-block-id="passage-1"`));
  assert.match(second.prepared.body, new RegExp(`href="#e-${entries[1].editionId}-passage-1"`));
  session.setCurrent(entries[0].editionId);
  assert.equal(session.entry.editionId, entries[0].editionId);
  assert.equal(session.next.partIndex, 3, "next appends after last loaded P rather than current visible P");
  await session.append();
  assert.equal(session.next, undefined);
});

test("concurrent append requests cannot duplicate a document and aborted work is retryable", async () => {
  const pending = deferred();
  let calls = 0;
  const session = createReaderSession(repository(async () => { if (++calls === 1) return "# 起点\n\n正文"; if (calls === 2) return pending.promise; return "# 下一篇\n\n正文"; }), { name: "read", editionId: entries[0].editionId, flow: true });
  await session.load();
  const controller = new AbortController();
  const append = session.append(controller.signal);
  assert.equal(await session.append(controller.signal), null);
  controller.abort();
  pending.resolve("# 延迟响应\n\n正文");
  await assert.rejects(append, { name: "AbortError" });
  assert.equal(session.documents.size, 1);
  await session.append();
  assert.equal(session.documents.size, 2);
  assert.equal(calls, 3);
});

test("DOM document scopes distinguish identical passage IDs without changing model identities", () => {
  const first = prepareReaderDocument("# 同名标题\n\n段落", entries[0].editionId);
  const second = prepareReaderDocument("# 同名标题\n\n段落", entries[1].editionId);
  assert.equal(first.blocks[0].id, second.blocks[0].id);
  assert.notEqual(first.body, second.body);
  assert.match(first.body, new RegExp(entries[0].editionId));
  assert.match(second.body, new RegExp(entries[1].editionId));
});
