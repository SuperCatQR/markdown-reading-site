import test from "node:test";
import assert from "node:assert/strict";
import { createLocalState, HISTORY_KEY, PREF_KEY, HISTORY_MAX_AGE, DEFAULT_PREFERENCES } from "../src/refactor/services/local-state.js";

const entry = (part = 0) => ({ manuscriptType: "publication-draft", editionId: String(part + 1).padStart(32, "0"), videoPartId: part + 1,
  contentVersion: 2, platform: "bilibili", externalVideoId: "BVCaseSensitive", partIndex: part,
  aiRevisionId: "a".repeat(64), contentSha256: "b".repeat(64), artifactSha256: "c".repeat(64), title: `阅读 P${part + 1}` });
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}

test("damaged JSON, wrong history shape and null records do not break state operations", () => {
  for (const value of ["{", "{}", "[null]", "false", '"wrong"']) {
    const state = createLocalState({ storage: storage({ [HISTORY_KEY]: value }), now: () => 1000 });
    assert.deepEqual(state.history, []);
    assert.equal(state.status.corrupted, true);
    assert.equal(state.remember(entry(), "passage-3").ok, true);
    assert.equal(state.history.length, 1);
    assert.equal(state.remove(entry().editionId).ok, true);
    assert.deepEqual(state.history, []);
  }
});

test("preferences validate every field and restore defaults for malformed values", () => {
  for (const value of ["null", "[]", "{}", '{"theme":"purple","size":0,"width":999999,"lineHeight":-1,"font":"url(fake)"}']) {
    const state = createLocalState({ storage: storage({ [PREF_KEY]: value }) });
    assert.deepEqual(state.preferences, DEFAULT_PREFERENCES);
  }
  const disk = storage();
  const state = createLocalState({ storage: disk });
  state.updatePreferences({ theme: "dark", size: 21, width: 920, lineHeight: 2.1, font: "sans" });
  assert.deepEqual(createLocalState({ storage: disk }).preferences, { theme: "dark", size: 21, width: 920, lineHeight: 2.1, font: "sans" });
  state.updatePreferences({ size: 200, other: "ignored" });
  assert.equal(state.preferences.size, 17);
  assert.equal(state.preferences.other, undefined);
});

test("version identity and paragraph offset survive reload and reject every changed frozen field", () => {
  const disk = storage();
  const state = createLocalState({ storage: disk, now: () => 1000 });
  const original = { ...entry(), manuscriptType: "publication", releaseId: "d".repeat(64) };
  assert.equal(state.remember(original, "段落-3", 0.42).ok, true);
  const loaded = createLocalState({ storage: disk, now: () => 2000 });
  assert.equal(loaded.progress(original).status, "valid");
  assert.equal(loaded.progress(original).record.offset, 0.42);
  assert.equal(loaded.progress(original).record.schemaVersion, 2);
  for (const [field, value] of Object.entries({ manuscriptType: "publication-draft", videoPartId: 3, contentVersion: 1, platform: "youtube",
    externalVideoId: "BVcasesensitive", partIndex: 8, editionId: "f".repeat(32), aiRevisionId: "f".repeat(64), contentSha256: "f".repeat(64), artifactSha256: "f".repeat(64), releaseId: "f".repeat(64) })) {
    const changed = { ...original, [field]: value };
    assert.notEqual(loaded.progress(changed).status, "valid", field);
    assert.notEqual(loaded.reconcile(loaded.history[0], [changed]).status, "valid", field);
  }
  assert.equal(loaded.progress({ ...original, title: "改标题" }).status, "valid");
});

test("missing editions and incomplete old records remain visible but cannot restore position", () => {
  const old = { editionId: entry().editionId, title: "撤回的记录", part: 0, anchor: "passage-7", readAt: 1000 };
  const state = createLocalState({ storage: storage({ [HISTORY_KEY]: JSON.stringify([old]) }), now: () => 2000 });
  assert.equal(state.history.length, 1);
  assert.equal(state.reconcile(state.history[0], []).status, "missing");
  assert.equal(state.reconcile(state.history[0], [entry()]).status, "stale");
  assert.equal(state.progress(entry()).status, "stale");
  state.remove(old.editionId);
  assert.deepEqual(state.history, []);
});

test("storage rejection keeps memory usable and never claims successful persistence", () => {
  for (const disk of [null, { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } }, { getItem() { return null; }, setItem() { throw Error("quota"); } }]) {
    const state = createLocalState({ storage: disk, now: () => 1000 });
    assert.equal(state.remember(entry(), "passage-1").ok, false);
    assert.equal(state.status.saved, false);
    assert.equal(state.status.available, false);
    assert.equal(state.history.length, 1);
    state.updatePreferences({ size: 19 });
    assert.equal(state.preferences.size, 19);
    state.clear();
    assert.deepEqual(state.history, []);
  }
});

test("history limits, expiry, duplicate ordering, and offset bounds are enforced", () => {
  let time = 1000;
  const disk = storage();
  const state = createLocalState({ storage: disk, now: () => time });
  for (let part = 0; part < 25; part++) { time++; state.remember(entry(part), "passage-2", 20); }
  assert.equal(state.history.length, 20);
  assert.equal(state.history[0].offset, 1);
  const records = state.history;
  disk.setItem(HISTORY_KEY, JSON.stringify([...records, { ...records[0], readAt: 1, anchor: "passage-old" }]));
  const loaded = createLocalState({ storage: disk, now: () => time });
  assert.equal(loaded.history[0].anchor, "passage-2");
  time += HISTORY_MAX_AGE + 1;
  assert.deepEqual(loaded.history, []);
});

test("invalid content identities cannot be saved as valid progress", () => {
  const state = createLocalState({ storage: storage(), now: () => 1000 });
  assert.equal(state.remember({ ...entry(), contentSha256: "bad" }).reason, "invalid-entry");
  assert.deepEqual(state.history, []);
});
