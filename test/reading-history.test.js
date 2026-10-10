import test from "node:test";
import assert from "node:assert/strict";
import {
  READING_HISTORY_KEY, READING_HISTORY_MAX_AGE, createReadingHistoryStore,
  recordFromEntry, reconcileReadingRecord, readingHistoryStorage,
} from "../src/reading-history.js";
import { visibleReadingPosition, recentReadingMarkup, readingRecordHref } from "../src/reading-history-browser.js";
import { resolveReaderRoute } from "../src/manuscripts.js";

const entry = (part = 1, manuscriptType = "publication-draft") => ({
  manuscriptType, videoPartId: part, partIndex: part - 1, contentVersion: 2, platform: "bilibili", externalVideoId: "BVexample", slug: `part-${part}`,
  editionId: part.toString(16).padStart(32, "0"), contentSha256: "b".repeat(64), artifactSha256: "c".repeat(64),
  releaseId: "d".repeat(64), title: `长讲解 P${part}`,
});
const record = (part = 1, time = 1000) => recordFromEntry(entry(part), { anchor: "passage-3", offset: 0.4, text: "原句", lastReadAt: time });
function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("recent reading is limited, ordered and expires without guessing a new position", () => {
  let time = 1000;
  const storage = memoryStorage();
  const store = createReadingHistoryStore(storage, { now: () => time });
  for (let part = 1; part <= 25; part++) { time++; assert.equal(store.write(record(part, time)).ok, true); }
  const fresh = createReadingHistoryStore(storage, { now: () => time }).read();
  assert.equal(fresh.records.length, 20);
  assert.deepEqual(fresh.records.map(({ videoPartId }) => videoPartId), Array.from({ length: 20 }, (_, i) => 25 - i));
  time += READING_HISTORY_MAX_AGE + 1;
  assert.deepEqual(store.read().records, []);
});

test("restoration requires every frozen identity including category, edition, release and both hashes", () => {
  const original = entry(1, "publication");
  const saved = recordFromEntry(original, { anchor: "passage-1", lastReadAt: 1000 });
  assert.equal(reconcileReadingRecord(saved, [original]).status, "available");
  for (const [field, value] of Object.entries({ editionId: "f".repeat(32), contentSha256: "f".repeat(64),
    artifactSha256: "f".repeat(64), releaseId: "f".repeat(64), contentVersion: 1, platform: "youtube", externalVideoId: "BVchanged", partIndex: 4 })) {
    assert.equal(reconcileReadingRecord(saved, [{ ...original, [field]: value }]).status, "updated", field);
  }
  assert.equal(reconcileReadingRecord(saved, []).status, "missing");
  assert.equal(reconcileReadingRecord(saved, [{ ...original, manuscriptType: "publication-draft" }]).status, "missing");
  assert.equal(reconcileReadingRecord(saved, [{ ...original, title: "新标题" }]).status, "available");
});

test("older scroll captures cannot overwrite newer tabs or resurrect deleted and cleared records", () => {
  let time = 1000;
  const storage = memoryStorage();
  const first = createReadingHistoryStore(storage, { now: () => time });
  const second = createReadingHistoryStore(storage, { now: () => time });
  assert.equal(first.write(record(1, time)).ok, true);
  time = 1200;
  assert.equal(second.write(record(1, time)).ok, true);
  assert.equal(first.write(record(1, 1100)).reason, "stale");
  time = 1300;
  assert.equal(second.remove(record(1).id).ok, true);
  assert.equal(first.write(record(1, 1250)).reason, "stale");
  time = 1400;
  assert.equal(first.write(record(1, time)).ok, true);
  assert.equal(second.write(record(2, time)).ok, true);
  time = 1500;
  assert.equal(second.clear().ok, true);
  assert.equal(first.write(record(1, 1450)).reason, "stale");
  assert.deepEqual(first.read().records, []);
});

test("unavailable, full, corrupt and unknown storage fails visibly and preserves unknown data until explicit clear", () => {
  const disabled = { getItem() { throw new Error("disabled"); }, setItem() { throw new Error("disabled"); } };
  const blocked = createReadingHistoryStore(disabled, { now: () => 2000 });
  assert.equal(blocked.read().status, "unavailable");
  assert.deepEqual(blocked.write(record()), { ok: false, reason: "unavailable" });
  assert.equal(blocked.clear().ok, false);
  assert.throws(() => readingHistoryStorage({ get localStorage() { throw new Error("disabled"); } }).getItem("x"));
  const quota = createReadingHistoryStore({ getItem: () => null, setItem() { throw new Error("full"); } }, { now: () => 2000 });
  assert.equal(quota.write(record()).ok, false);
  for (const [raw, expected] of [["{broken", "corrupt"], ['{"schemaVersion":99}', "unsupported"],
    ['{"schemaVersion":2,"records":[],"deleted":{},"clearedAt":"wrong"}', "corrupt"]]) {
    const storage = memoryStorage(); storage.setItem(READING_HISTORY_KEY, raw);
    const store = createReadingHistoryStore(storage, { now: () => 2000 });
    assert.equal(store.read().status, expected);
    assert.equal(store.write(record()).reason, expected);
    assert.equal(storage.getItem(READING_HISTORY_KEY), raw);
    assert.equal(store.clear().ok, true);
    assert.equal(store.read().status, "ok");
  }
});

test("progress refuses reference-mode, invalid anchors, offsets and non-exact identity records", () => {
  const store = createReadingHistoryStore(memoryStorage(), { now: () => 2000 });
  for (const invalid of [{ documentMode: "review" }, { offset: -1 }, { offset: 1.1 }, { anchor: "" },
    { editionId: "unknown" }, { artifactSha256: "" }, { lastReadAt: Infinity }, { videoPartId: 0 }]) {
    assert.equal(store.write({ ...record(), ...invalid }).reason, "invalid");
  }
  assert.deepEqual(store.read().records, []);
});

test("actual visible prose chooses previous loaded P and normalizes anchors independently of route entry", () => {
  const block = (id, top, height = 100) => ({ id, textContent: "  讲解\n正文  ", getBoundingClientRect: () => ({ top, height, bottom: top + height }) });
  const first = entry(1), second = entry(2);
  const article = (item, blocks) => ({ dataset: { edition: item.editionId }, querySelectorAll: () => blocks });
  const app = { querySelectorAll: () => [
    article(first, [block(`part-${first.editionId}-passage-1`, -100), block(`part-${first.editionId}-passage-2`, 20)]),
    article(second, [block(`part-${second.editionId}-passage-1`, 700)]),
  ] };
  const visible = visibleReadingPosition(app, [first, second], { topOffset: 60, viewportHeight: 600 });
  assert.equal(visible.entry, first);
  assert.equal(visible.anchor, "passage-2");
  assert.equal(visible.offset, 0.4);
  assert.equal(visible.text, "讲解 正文");
  assert.equal(visibleReadingPosition(app, [second], { topOffset: 60, viewportHeight: 600 }), null);
});

test("recent links reopen only exact current continuous P; updated/withdrawn records get no saved anchor", () => {
  const item = entry(2);
  const saved = { ...record(2), readingMode: "continuous", title: '<script>bad</script>' };
  const href = readingRecordHref(saved, item);
  const url = new URL(href, "https://example.test/");
  const route = resolveReaderRoute(url.search, [], [entry(1), item]);
  assert.equal(route.kind, "continuous");
  assert.equal(route.entry, item);
  assert.equal(url.hash, `#part-${item.editionId}-passage-3`);
  const available = recentReadingMarkup({ records: [saved], status: "ok" }, [item]);
  assert.match(available, /data-reading-resume/);
  assert.match(available, /保存在当前浏览器/);
  const updated = recentReadingMarkup({ records: [saved], status: "ok" }, [{ ...item, artifactSha256: "f".repeat(64) }]);
  assert.match(updated, /内容已更新/);
  assert.doesNotMatch(updated, /data-reading-resume|#part-/);
  const missing = recentReadingMarkup({ records: [saved], status: "ok" }, []);
  assert.match(missing, /稿件已撤回/);
  assert.doesNotMatch(missing, /<script>|data-reading-resume/);
});

test("latest readable record has a direct primary action while management stays secondary", () => {
  const latest = { ...record(2, 1200), title: "很长的标题".repeat(30) };
  const markup = recentReadingMarkup({ records: [latest, record()], status: "ok" }, [entry(1), entry(2)]);
  const primary = markup.slice(markup.indexOf('class="recent-reading-primary"'), markup.indexOf('class="recent-reading-management"'));
  assert.match(primary, /P2/);
  assert.match(primary, /data-reading-resume="publication-draft:2"/);
  assert.doesNotMatch(primary, /data-reading-delete|data-reading-clear|180 天/);
  assert.match(markup, /<details class="recent-reading-management"><summary>查看全部 2 篇与管理记录/);
  assert.match(markup, /保存在当前浏览器/);
  const changed = recentReadingMarkup({ records: [latest, record()], status: "ok" }, [entry(1)]);
  const changedPrimary = changed.slice(0, changed.indexOf('class="recent-reading-management"'));
  assert.match(changedPrimary, /不可恢复/);
  assert.doesNotMatch(changedPrimary, /data-reading-resume/);
  for (const status of ["corrupt", "unavailable", "unsupported"]) {
    assert.doesNotMatch(recentReadingMarkup({ records: [latest], status }, [entry(2)]), /data-reading-resume/);
  }
});
