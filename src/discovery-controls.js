import { sourceTags } from "./source-identity.js";
import { workKey } from "./source-identity.js";
import { escapeHtml } from "./ui.js";

export function sourceTagStats(entries) {
  const videos = new Map();
  for (const entry of entries) for (const tag of sourceTags(entry)) {
    if (!videos.has(tag)) videos.set(tag, new Set());
    videos.get(tag).add(workKey(entry));
  }
  return [...videos].map(([tag, ids]) => ({ tag, count: ids.size }))
    .sort((a, b) => b.count - a.count);
}

export function tagOptionsMarkup(stats, selected, query = "", limit = 12) {
  const needle = query.trim().toLocaleLowerCase("zh-Hans");
  const matches = needle ? stats.filter(({ tag }) => tag.toLocaleLowerCase("zh-Hans").includes(needle)) : stats;
  const shown = matches.slice(0, limit);
  if (!needle && selected !== "全部" && !shown.some(({ tag }) => tag === selected)) {
    const current = stats.find(({ tag }) => tag === selected);
    if (current) shown.unshift(current);
  }
  const option = (tag, label) => `<button class="tag-option${selected === tag ? " selected" : ""}" type="button" aria-pressed="${selected === tag}" data-tag="${escapeHtml(tag)}"><span>${escapeHtml(tag)}</span><span>${label}</span></button>`;
  return `${!needle ? option("全部", "所有主题") : ""}${shown.map(({ tag, count }) => option(tag, `${count} 个视频`)).join("")}${matches.length > limit ? `<button type="button" class="tag-more" data-tag-more>再显示 ${Math.min(48, matches.length - limit)} 个标签</button>` : ""}${!matches.length ? '<p class="tag-empty" role="status">没有匹配的源标签，试试其他词。</p>' : ""}`;
}

export function bindDirectoryDiscovery(app, stats) {
  const menu = app.querySelector("#tag-filter-menu");
  if (!menu) return;
  const input = menu.querySelector("#tag-search");
  let limit = 12;
  const render = () => {
    const selected = menu.querySelector(".filter-current").textContent;
    menu.querySelector(".filter-options").innerHTML = tagOptionsMarkup(stats, selected, input.value, limit);
    menu.querySelector(".tag-options-label").textContent = input.value.trim() ? "匹配的源标签" : "常用源标签 · 按视频数量";
  };
  input.addEventListener("input", () => { limit = 48; render(); });
  menu.addEventListener("click", (event) => {
    if (event.target.closest("[data-tag-more]")) {
      const shown = menu.querySelectorAll(".tag-option").length;
      limit += 48;
      render();
      menu.querySelectorAll(".tag-option")[shown]?.focus();
    }
  });
  menu.addEventListener("toggle", () => {
    menu.querySelector("summary").setAttribute("aria-expanded", String(menu.open));
    if (menu.open) render();
  });
  render();
}

export function openDirectorySection(app, section) {
  if (section === "topics") {
    const menu = app.querySelector("#tag-filter-menu");
    if (!menu) return false;
    menu.open = true;
    menu.querySelector("#tag-search").focus({ preventScroll: true });
    menu.scrollIntoView({ block: "center" });
    return true;
  }
  if (section === "recent-reading") {
    return false;
  }
  return false;
}

export function bindDirectoryPopovers(app) {
  const selector = ".filter-menu, .library-status, .reader-site-menu, .reader-part-menu, .reader-identity";
  app.addEventListener("toggle", (event) => {
    if (!event.target.matches?.(selector) || !event.target.open) return;
    app.querySelectorAll(selector).forEach((menu) => { if (menu !== event.target) menu.open = false; });
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || app.querySelector("dialog[open]")) return;
    const open = app.querySelector(`${selector.split(", ").map((s) => `${s}[open]`).join(", ")}`);
    if (!open) return;
    event.preventDefault();
    open.open = false;
    open.querySelector("summary").focus({ preventScroll: true });
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-directory-section]")) return;
    app.querySelectorAll(selector).forEach((menu) => { if (menu.open && !menu.contains(event.target)) menu.open = false; });
  });
}
