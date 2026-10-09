export const READING_HISTORY_KEY = "reader-history-v1";
export const READING_HISTORY_LIMIT = 20;
export const READING_HISTORY_MAX_AGE = 180 * 24 * 60 * 60 * 1000;
const hex = (value, length) => typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
const finiteTime = (value) => Number.isSafeInteger(value) && value >= 0;
export const readingRecordId = (entry) => `${entry.manuscriptType}:${entry.videoPartId}`;

export function recordFromEntry(entry, { anchor, offset = 0, text = "", readingMode = "single", lastReadAt = Date.now() }) {
  return {
    id: readingRecordId(entry), manuscriptType: entry.manuscriptType, videoPartId: entry.videoPartId,
    bvid: entry.bvid, pageIndex: entry.pageIndex, editionId: entry.editionId,
    contentSha256: entry.contentSha256, artifactSha256: entry.artifactSha256,
    releaseId: entry.manuscriptType === "publication" ? entry.releaseId : null,
    title: entry.title, readingMode, documentMode: "body", anchor, offset,
    text: text.replace(/\s+/gu, " ").trim().slice(0, 160), lastReadAt,
  };
}

function validRecord(record) {
  return record && ["publication", "publication-draft"].includes(record.manuscriptType)
    && Number.isSafeInteger(record.videoPartId) && record.videoPartId > 0
    && record.id === readingRecordId(record) && typeof record.bvid === "string" && /^[\w-]{1,80}$/.test(record.bvid)
    && Number.isSafeInteger(record.pageIndex) && record.pageIndex >= 0
    && hex(record.editionId, 32) && hex(record.contentSha256, 64) && hex(record.artifactSha256, 64)
    && (record.manuscriptType === "publication" ? hex(record.releaseId, 64) : record.releaseId === null)
    && typeof record.title === "string" && record.title.length <= 10000
    && ["single", "continuous"].includes(record.readingMode) && record.documentMode === "body"
    && typeof record.anchor === "string" && record.anchor.length > 0 && record.anchor.length <= 1000
    && Number.isFinite(record.offset) && record.offset >= 0 && record.offset <= 1
    && typeof record.text === "string" && record.text.length <= 160 && finiteTime(record.lastReadAt);
}

export function reconcileReadingRecord(record, entries) {
  const entry = entries.find((candidate) => readingRecordId(candidate) === record.id);
  if (!entry) return { status: "missing", record };
  const exact = ["manuscriptType", "videoPartId", "bvid", "pageIndex", "editionId", "contentSha256", "artifactSha256"]
    .every((field) => entry[field] === record[field])
    && (entry.manuscriptType !== "publication" || entry.releaseId === record.releaseId);
  return { status: exact ? "available" : "updated", record, entry };
}

// Keep storage access observable. The theme preference wrapper intentionally swallows
// failures; reading progress must never claim that an unsuccessful write was saved.
export function readingHistoryStorage(target = globalThis.window) {
  return {
    getItem: (key) => target.localStorage.getItem(key),
    setItem: (key, value) => target.localStorage.setItem(key, value),
  };
}

export function createReadingHistoryStore(storage, { now = Date.now } = {}) {
  const empty = () => ({ schemaVersion: 1, records: [], deleted: {}, clearedAt: 0 });
  function readEnvelope() {
    let raw;
    try { raw = storage.getItem(READING_HISTORY_KEY); }
    catch { return { status: "unavailable", ...empty() }; }
    if (!raw) return { status: "ok", ...empty() };
    let value;
    try { value = JSON.parse(raw); }
    catch { return { status: "corrupt", ...empty() }; }
    if (value?.schemaVersion !== 1) return { status: "unsupported", ...empty() };
    if (!Array.isArray(value.records) || value.records.length > READING_HISTORY_LIMIT
      || !value.records.every(validRecord) || !finiteTime(value.clearedAt)
      || !value.deleted || typeof value.deleted !== "object" || Array.isArray(value.deleted)
      || Object.entries(value.deleted).some(([key, time]) => !/^(publication|publication-draft):[1-9]\d*$/.test(key) || !finiteTime(time))
      || new Set(value.records.map(({ id }) => id)).size !== value.records.length) {
      return { status: "corrupt", ...empty() };
    }
    const cutoff = now() - READING_HISTORY_MAX_AGE;
    return {
      status: "ok", schemaVersion: 1, clearedAt: value.clearedAt,
      deleted: Object.fromEntries(Object.entries(value.deleted).filter(([, time]) => time >= cutoff)),
      records: value.records.filter((record) => record.lastReadAt >= cutoff && record.lastReadAt > value.clearedAt
        && record.lastReadAt > (value.deleted[record.id] || 0))
        .sort((a, b) => b.lastReadAt - a.lastReadAt),
    };
  }
  function persist(envelope) {
    try {
      storage.setItem(READING_HISTORY_KEY, JSON.stringify({
        schemaVersion: 1, records: envelope.records, deleted: envelope.deleted, clearedAt: envelope.clearedAt,
      }));
      return { ok: true };
    } catch { return { ok: false, reason: "unavailable" }; }
  }
  return {
    read() { const { records, status } = readEnvelope(); return { records, status }; },
    write(record) {
      if (!validRecord(record) || record.lastReadAt > now() + 60000) return { ok: false, reason: "invalid" };
      const envelope = readEnvelope();
      if (envelope.status !== "ok") return { ok: false, reason: envelope.status };
      const existing = envelope.records.find(({ id }) => id === record.id);
      if (record.lastReadAt < now() - READING_HISTORY_MAX_AGE
        || record.lastReadAt <= envelope.clearedAt || record.lastReadAt <= (envelope.deleted[record.id] || 0)
        || (existing && existing.lastReadAt >= record.lastReadAt)) return { ok: false, reason: "stale" };
      envelope.records = [record, ...envelope.records.filter(({ id }) => id !== record.id)]
        .sort((a, b) => b.lastReadAt - a.lastReadAt).slice(0, READING_HISTORY_LIMIT);
      delete envelope.deleted[record.id];
      return persist(envelope);
    },
    remove(id) {
      const envelope = readEnvelope();
      if (envelope.status !== "ok") return { ok: false, reason: envelope.status };
      const existing = envelope.records.find((record) => record.id === id);
      if (!existing) return { ok: false, reason: "missing" };
      envelope.deleted[id] = Math.max(now(), existing.lastReadAt);
      envelope.records = envelope.records.filter((record) => record.id !== id);
      return persist(envelope);
    },
    clear() {
      const envelope = readEnvelope();
      // An explicit clear is also the recovery path for a damaged/unknown schema.
      return persist({ ...empty(), clearedAt: Math.max(now(), ...envelope.records.map(({ lastReadAt }) => lastReadAt)) });
    },
  };
}
