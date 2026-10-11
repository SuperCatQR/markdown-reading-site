import test from "node:test";
import assert from "node:assert/strict";
import { createFeedbackState, FEEDBACK_KEY } from "../src/refactor/services/feedback-state.js";
const entry = { manuscriptType: "publication-draft", editionId: "a".repeat(32), videoPartId: 1, contentVersion: 2, platform: "bilibili", externalVideoId: "BVCase", partIndex: 0, aiRevisionId: "b".repeat(64), contentSha256: "c".repeat(64), artifactSha256: "d".repeat(64), reviewArtifactSha256: "e".repeat(64) };
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }
test("feedback drafts persist per exact body/reference and all frozen version fields", () => {
  const disk = storage(), state = createFeedbackState({ storage: disk });
  state.write(entry, "body", { quote: "原句", suggestion: "建议", reason: "理由" });
  state.write(entry, "review", { quote: "参照原句" });
  const loaded = createFeedbackState({ storage: disk });
  assert.equal(loaded.read(entry, "body").quote, "原句");
  assert.equal(loaded.read(entry, "review").quote, "参照原句");
  for (const [field, value] of Object.entries({ manuscriptType: "publication", editionId: "f".repeat(32), videoPartId: 2, platform: "youtube", externalVideoId: "BVcase", partIndex: 1, contentVersion: 1, aiRevisionId: "f".repeat(64), contentSha256: "f".repeat(64), artifactSha256: "f".repeat(64), reviewArtifactSha256: "f".repeat(64), releaseId: "f".repeat(64) })) {
    assert.equal(loaded.read({ ...entry, [field]: value }, "body").quote, "", field);
  }
});
test("feedback storage keeps only ten drafts and four bounded text fields", () => {
  const disk = storage(), state = createFeedbackState({ storage: disk });
  for (let part = 1; part <= 12; part++) state.write({ ...entry, editionId: part.toString(16).padStart(32, "0") }, "body", { quote: "x".repeat(4000), private: "not-saved" });
  const saved = JSON.parse(disk.getItem(FEEDBACK_KEY));
  assert.equal(saved.length, 10);
  assert.equal(saved[0].draft.quote.length, 4000);
  assert.equal(saved[0].draft.private, undefined);
  assert.equal(state.read({ ...entry, editionId: "1".padStart(32, "0") }, "body").quote, "");
  const before = disk.getItem(FEEDBACK_KEY);
  assert.deepEqual(state.write(entry, "body", { quote: "x".repeat(4001) }), { ok: false, reason: "invalid-draft" });
  assert.equal(disk.getItem(FEEDBACK_KEY), before, "oversized input must be rejected rather than silently truncated");
});
test("corrupt and denied feedback storage does not break draft editing or claim saved", () => {
  for (const text of ["{", "{}", "[null]"]) {
    const disk = storage(); disk.setItem(FEEDBACK_KEY, text);
    const state = createFeedbackState({ storage: disk });
    assert.equal(state.status.corrupted, true);
    assert.equal(state.read(entry, "body").quote, "");
    assert.equal(state.write(entry, "body", { quote: "恢复" }).ok, true);
  }
  const state = createFeedbackState({ storage: { getItem() { throw Error("denied"); }, setItem() { throw Error("denied"); } } });
  assert.equal(state.write(entry, "body", { quote: "仍可输入" }).ok, false);
  assert.equal(state.read(entry, "body").quote, "仍可输入");
  assert.equal(state.status.saved, false);
});
