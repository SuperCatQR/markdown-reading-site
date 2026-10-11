export const HISTORY_KEY = "reader-refactor-history-v1";
export const PREF_KEY = "reader-refactor-preferences-v1";
export const HISTORY_MAX_AGE = 180 * 24 * 60 * 60 * 1000;
export const DEFAULT_PREFERENCES = Object.freeze({ theme: "light", size: 17, width: 760, lineHeight: 1.95, font: "serif" });

const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const editionPattern = /^[0-9a-f]{32}$/u;
const hashPattern = /^[0-9a-f]{64}$/u;
const anchorPattern = /^[\p{L}\p{N}_-]{1,256}$/u;
const identityFields = ["manuscriptType", "videoPartId", "contentVersion", "platform", "externalVideoId", "partIndex", "editionId", "aiRevisionId", "contentSha256", "artifactSha256", "releaseId"];

export function readingIdentity(entry) {
  return Object.fromEntries(identityFields.map((field) => [field, field === "releaseId" ? entry.releaseId || null : entry[field]]));
}

function completeIdentity(record) {
  return ["publication", "publication-draft"].includes(record.manuscriptType)
    && Number.isSafeInteger(record.videoPartId) && record.videoPartId > 0 && record.contentVersion === 2
    && ["bilibili", "youtube"].includes(record.platform) && typeof record.externalVideoId === "string" && record.externalVideoId.length > 0 && record.externalVideoId.length <= 200
    && Number.isSafeInteger(record.partIndex) && record.partIndex >= 0 && editionPattern.test(record.editionId)
    && ["aiRevisionId", "contentSha256", "artifactSha256"].every((field) => hashPattern.test(record[field]))
    && (record.manuscriptType === "publication" ? hashPattern.test(record.releaseId) : record.releaseId === null);
}

export function sameReadingVersion(record, entry) {
  const identity = readingIdentity(entry);
  return record.schemaVersion === 2 && completeIdentity(record) && identityFields.every((field) => record[field] === identity[field]);
}

function normalizePreferences(value) {
  const preferences = { ...DEFAULT_PREFERENCES };
  if (!plain(value)) return preferences;
  const choices = { theme: ["light", "dark"], size: [17, 19, 21], width: [620, 760, 920], lineHeight: [1.65, 1.8, 1.95, 2.1], font: ["serif", "sans"] };
  for (const [key, values] of Object.entries(choices)) if (values.includes(value[key])) preferences[key] = value[key];
  return preferences;
}

function normalizeRecord(value, time) {
  if (!plain(value) || !editionPattern.test(value.editionId) || typeof value.title !== "string"
    || !Number.isFinite(value.readAt) || value.readAt < 0 || value.readAt > time + 60000
    || time - value.readAt > HISTORY_MAX_AGE) return null;
  return { ...readingIdentity(value), schemaVersion: value.schemaVersion === 2 ? 2 : 0,
    title: value.title.slice(0, 2000), part: Number.isSafeInteger(value.partIndex) ? value.partIndex : Number.isSafeInteger(value.part) ? value.part : 0,
    anchor: typeof value.anchor === "string" && anchorPattern.test(value.anchor) ? value.anchor : "",
    offset: Number.isFinite(value.offset) ? Math.max(0, Math.min(1, value.offset)) : 0, readAt: value.readAt };
}

export function createLocalState({ storage, now = Date.now } = {}) {
  let storageStatus = { available: true, saved: true, corrupted: false, reason: "" };
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  if (!storage) storageStatus = { ...storageStatus, available: false, saved: false, reason: "storage-unavailable" };
  function read(key, fallback) {
    if (!storage) return fallback;
    try { const source = storage.getItem(key); return source === null ? fallback : JSON.parse(source); }
    catch (error) {
      if (error instanceof SyntaxError) storageStatus = { ...storageStatus, corrupted: true, reason: "storage-corrupted" };
      else storageStatus = { ...storageStatus, available: false, saved: false, reason: "storage-unavailable" };
      return fallback;
    }
  }
  const stored = read(HISTORY_KEY, []);
  const rawRecords = Array.isArray(stored) ? stored : [];
  if (!Array.isArray(stored)) storageStatus = { ...storageStatus, corrupted: true, reason: "storage-corrupted" };
  const records = rawRecords.map((record) => normalizeRecord(record, now())).filter(Boolean).sort((a, b) => b.readAt - a.readAt);
  if (rawRecords.some((record) => !plain(record) || !editionPattern.test(record.editionId))) storageStatus = { ...storageStatus, corrupted: true, reason: "storage-corrupted" };
  const unique = new Map();
  for (const record of records) if (!unique.has(record.editionId)) unique.set(record.editionId, record);
  let history = [...unique.values()].slice(0, 20);
  const storedPreferences = read(PREF_KEY, DEFAULT_PREFERENCES);
  let preferences = normalizePreferences(storedPreferences);
  if (!plain(storedPreferences)) storageStatus = { ...storageStatus, corrupted: true, reason: "storage-corrupted" };
  function save(key, value) {
    try {
      if (!storage) throw new Error("storage unavailable");
      storage.setItem(key, JSON.stringify(value));
      storageStatus = { ...storageStatus, available: true, saved: true, reason: storageStatus.corrupted ? "storage-corrupted" : "" };
      return { ok: true, reason: "" };
    } catch {
      storageStatus = { ...storageStatus, available: false, saved: false, reason: "storage-write-failed" };
      return { ok: false, reason: "storage-write-failed" };
    }
  }
  const persistHistory = () => save(HISTORY_KEY, history);
  const currentHistory = () => history.filter((record) => now() - record.readAt <= HISTORY_MAX_AGE);
  function reconcile(record, entries) {
    const entry = entries.find((candidate) => candidate.editionId === record.editionId);
    if (!entry) return { status: "missing", record, entry: null, reason: "edition-unavailable" };
    return sameReadingVersion(record, entry) ? { status: "valid", record, entry, reason: "" } : { status: "stale", record, entry, reason: "version-changed" };
  }
  return {
    get history() { return currentHistory().map((record) => ({ ...record })); },
    get preferences() { return { ...preferences }; },
    get status() { return { ...storageStatus }; },
    reconcile,
    progress(entry) {
      const record = currentHistory().find((candidate) => candidate.editionId === entry.editionId)
        || currentHistory().find((candidate) => candidate.manuscriptType === entry.manuscriptType && candidate.platform === entry.platform && candidate.externalVideoId === entry.externalVideoId && candidate.partIndex === entry.partIndex);
      if (!record) return { status: "missing", record: null, reason: "no-progress" };
      return sameReadingVersion(record, entry) ? { status: "valid", record: { ...record }, reason: "" } : { status: "stale", record: { ...record }, reason: "version-changed" };
    },
    remember(entry, anchor = "", offset = 0) {
      const identity = readingIdentity(entry);
      if (!completeIdentity(identity)) return { ok: false, reason: "invalid-entry" };
      const record = normalizeRecord({ ...identity, schemaVersion: 2, title: entry.title || "", anchor, offset, readAt: now() }, now());
      history = [record, ...currentHistory().filter((candidate) => candidate.editionId !== entry.editionId)].slice(0, 20);
      return persistHistory();
    },
    remove(editionId) { history = currentHistory().filter((record) => record.editionId !== editionId); return persistHistory(); },
    clear() { history = []; return persistHistory(); },
    updatePreferences(next) { preferences = normalizePreferences({ ...preferences, ...(plain(next) ? next : {}) }); save(PREF_KEY, preferences); return this.preferences; },
  };
}