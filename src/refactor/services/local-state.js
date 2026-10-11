const HISTORY_KEY = "reader-refactor-history-v1";
const PREF_KEY = "reader-refactor-preferences-v1";

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

export function createLocalState() {
  let history = read(HISTORY_KEY, []);
  let preferences = read(PREF_KEY, { theme: "light", size: 17, width: 760 });
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  return {
    get history() { return Array.isArray(history) ? history : []; },
    get preferences() { return { ...preferences }; },
    remember(entry, anchor = "") {
      history = [{ editionId: entry.editionId, title: entry.title, part: entry.partIndex, anchor, readAt: Date.now() }, ...history.filter((record) => record.editionId !== entry.editionId)].slice(0, 20);
      save(HISTORY_KEY, history);
    },
    remove(editionId) { history = history.filter((record) => record.editionId !== editionId); save(HISTORY_KEY, history); },
    clear() { history = []; save(HISTORY_KEY, history); },
    updatePreferences(next) { preferences = { ...preferences, ...next }; save(PREF_KEY, preferences); return this.preferences; },
  };
}
