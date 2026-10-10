import { readingToolPosition, restoreReadingToolPosition } from "./reader-tools.js";

export const defaultReadingPreferences = Object.freeze({ size: 17, line: 1.95, width: 760, font: "serif" });
const options = { size: [17, 19, 21], line: [1.7, 1.95, 2.2], width: [620, 760, 920], font: ["serif", "sans"] };

export function sanitizeReadingPreferences(value) {
  return Object.fromEntries(Object.entries(options).map(([key, allowed]) =>
    [key, allowed.includes(value?.[key]) ? value[key] : defaultReadingPreferences[key]]));
}

export function saveReadingPreferences(storage, value) {
  try { storage.setItem("reading-layout", JSON.stringify(sanitizeReadingPreferences(value))); return true; }
  catch { return false; }
}

export function readingPreferencesMarkup() {
  return `<dialog class="reading-settings" aria-labelledby="reading-settings-title"><form method="dialog"><h2 id="reading-settings-title">阅读排版</h2><button class="settings-close" aria-label="关闭阅读设置">×</button></form>
    <label>字号<select data-reading-preference="size"><option value="17">标准 · 17px</option><option value="19">较大 · 19px</option><option value="21">大字 · 21px</option></select></label>
    <label>行距<select data-reading-preference="line"><option value="1.7">紧凑</option><option value="1.95">标准</option><option value="2.2">宽松</option></select></label>
    <label>行宽<select data-reading-preference="width"><option value="620">窄 · 620px</option><option value="760">标准 · 760px</option><option value="920">宽 · 920px</option></select></label>
    <label>字体<select data-reading-preference="font"><option value="serif">宋体风格</option><option value="sans">黑体风格</option></select></label>
    <button type="button" class="settings-reset" data-reading-reset>恢复默认排版</button><p class="settings-status" role="status">设置保存在当前浏览器；手机行宽会适应屏幕。</p></dialog>`;
}

export function bindReadingPreferences(app) {
  let preferences;
  try { preferences = sanitizeReadingPreferences(JSON.parse(window.localStorage.getItem("reading-layout"))); }
  catch { preferences = { ...defaultReadingPreferences }; }
  function apply() {
    const root = document.documentElement;
    root.style.setProperty("--reading-font-size", `${preferences.size}px`);
    root.style.setProperty("--reading-line-height", preferences.line);
    root.style.setProperty("--reading-width", `${preferences.width}px`);
    root.style.setProperty("--reading-font", preferences.font === "sans" ? '"Noto Sans SC", system-ui, sans-serif' : 'Georgia, "Noto Serif SC", "Songti SC", serif');
  }
  const offset = () => Math.max(app.querySelector(".reader-header")?.getBoundingClientRect().bottom || 64,
    app.querySelector("#reader-search-navigation:not([hidden])")?.getBoundingClientRect().bottom || 0) + 12;
  let position;
  const sync = (dialog) => dialog.querySelectorAll("[data-reading-preference]").forEach((select) => { select.value = String(preferences[select.dataset.readingPreference]); });
  function change(dialog) {
    apply();
    let saved = false;
    try { saved = saveReadingPreferences(window.localStorage, preferences); } catch { /* Storage accessor can throw. */ }
    dialog.querySelector(".settings-status").textContent = saved
      ? "已保存在当前浏览器；手机行宽会适应屏幕。"
      : "当前排版已生效，但浏览器无法保存设置；刷新后可能恢复默认。";
    requestAnimationFrame(() => restoreReadingToolPosition(position, offset()));
  }
  app.addEventListener("click", (event) => {
    const dialog = app.querySelector(".reading-settings");
    if (!dialog) return;
    if (event.target.closest("#reader-settings")) {
      position = readingToolPosition(app, offset());
      sync(dialog);
      dialog.showModal();
    }
    if (event.target.closest("[data-reading-reset]")) {
      preferences = { ...defaultReadingPreferences }; sync(dialog); change(dialog);
    }
  });
  app.addEventListener("change", (event) => {
    const select = event.target.closest("[data-reading-preference]");
    if (!select) return;
    const key = select.dataset.readingPreference;
    preferences = sanitizeReadingPreferences({ ...preferences, [key]: key === "font" ? select.value : Number(select.value) });
    change(select.closest("dialog"));
  });
  // close does not bubble; capture also handles dialogs created by later routes.
  app.addEventListener("close", (event) => {
    if (!event.target.matches(".reading-settings")) return;
    requestAnimationFrame(() => {
      restoreReadingToolPosition(position, offset());
      app.querySelector("#reader-settings")?.focus({ preventScroll: true });
    });
  }, true);
  apply();
}
