import { readingIdentity } from "./local-state.js";

export const FEEDBACK_KEY = "reader-refactor-feedback-v1";
const fields = ["quote", "context", "suggestion", "reason"];
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const emptyDraft = () => Object.fromEntries(fields.map((field) => [field, ""]));
const hash = /^[0-9a-f]{64}$/u;

function version(entry, mode) {
  if (!["body", "review"].includes(mode)) return null;
  const identity = { ...readingIdentity(entry), reviewArtifactSha256: entry.reviewArtifactSha256 };
  if (!/^[0-9a-f]{32}$/u.test(identity.editionId) || !["publication", "publication-draft"].includes(identity.manuscriptType)
    || !Number.isSafeInteger(identity.videoPartId) || identity.videoPartId <= 0 || identity.contentVersion !== 2
    || !["bilibili", "youtube"].includes(identity.platform) || typeof identity.externalVideoId !== "string" || !identity.externalVideoId
    || !Number.isSafeInteger(identity.partIndex) || identity.partIndex < 0
    || !["aiRevisionId", "contentSha256", "artifactSha256", "reviewArtifactSha256"].every((field) => hash.test(identity[field]))
    || (identity.manuscriptType === "publication" ? !hash.test(identity.releaseId) : identity.releaseId !== null)) return null;
  return JSON.stringify([mode, identity]);
}

function cleanDraft(draft) {
  if (!plain(draft)) return null;
  const value = emptyDraft();
  for (const field of fields) {
    if (draft[field] !== undefined && typeof draft[field] !== "string") return null;
    if ((draft[field] || "").length > 4000) return null;
    value[field] = draft[field] || "";
  }
  return value;
}

export function createFeedbackState({ storage } = {}) {
  let status = { available: true, saved: true, corrupted: false, reason: "" };
  let records = [];
  if (storage === undefined) {
    try { storage = globalThis.sessionStorage; } catch { storage = null; }
  }
  if (!storage) status = { ...status, available: false, saved: false, reason: "storage-unavailable" };
  else {
    try {
      const text = storage.getItem(FEEDBACK_KEY);
      const parsed = text === null ? [] : JSON.parse(text);
      if (!Array.isArray(parsed)) throw new SyntaxError("Invalid feedback records");
      const seen = new Set();
      for (const record of parsed) {
        if (!plain(record) || record.schemaVersion !== 1 || typeof record.key !== "string" || !cleanDraft(record.draft) || seen.has(record.key)) {
          status = { ...status, corrupted: true, reason: "storage-corrupted" }; continue;
        }
        try {
          const decoded = JSON.parse(record.key);
          if (!Array.isArray(decoded) || version(decoded[1], decoded[0]) !== record.key) throw new Error("Invalid version identity");
        } catch { status = { ...status, corrupted: true, reason: "storage-corrupted" }; continue; }
        seen.add(record.key);
        records.push({ schemaVersion: 1, key: record.key, draft: cleanDraft(record.draft) });
        if (records.length === 10) break;
      }
    } catch (error) {
      status = { ...status, ...(error instanceof SyntaxError ? { corrupted: true, reason: "storage-corrupted" } : { available: false, saved: false, reason: "storage-unavailable" }) };
    }
  }
  return {
    get status() { return { ...status }; },
    read(entry, mode) {
      const key = version(entry, mode);
      const record = key && records.find((candidate) => candidate.key === key);
      return record ? { ...record.draft } : emptyDraft();
    },
    write(entry, mode, draft) {
      const key = version(entry, mode), value = cleanDraft(draft);
      if (!key || !value) return { ok: false, reason: "invalid-draft" };
      records = [{ schemaVersion: 1, key, draft: value }, ...records.filter((record) => record.key !== key)].slice(0, 10);
      try {
        if (!storage) throw new Error("storage unavailable");
        storage.setItem(FEEDBACK_KEY, JSON.stringify(records));
        status = { ...status, available: true, saved: true, reason: status.corrupted ? "storage-corrupted" : "" };
        return { ok: true, reason: "" };
      } catch {
        status = { ...status, available: false, saved: false, reason: "storage-write-failed" };
        return { ok: false, reason: "storage-write-failed" };
      }
    },
  };
}
