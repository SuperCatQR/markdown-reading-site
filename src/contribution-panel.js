import { visibleReadingEntry, readingToolPosition } from "./reader-tools.js";
import { readingOffset } from "./contribution-navigation.js";
import { feedbackKey, createFeedbackStore, feedbackText, feedbackIssueUrl } from "./contribution-feedback.js";

export function bindContributionPanel({ app, route, entries, issueUrl, passages = [] }) {
  const events = new AbortController();
  // Access itself can throw in browsers that prohibit storage.
  let storage; try { storage = window.sessionStorage; } catch { storage = null; }
  const store = createFeedbackStore(storage);
  const dialog = document.createElement("dialog");
  dialog.className = "contribution-dialog"; dialog.setAttribute("aria-labelledby", "feedback-title");
  dialog.innerHTML = `<div class="feedback-heading"><h2 id="feedback-title">整理修改建议</h2><button type="button" data-feedback-close aria-label="关闭反馈">关闭</button></div>
    <p>建议暂存于当前浏览器会话。可复制文本，也可前往 GitHub；提交时需要登录，本站不会自动提交。</p>
    <p class="feedback-identity"></p><form>${[["quote", "原句 / 选中文本"], ["context", "上下文"], ["suggestion", "建议修改"], ["reason", "理由"]].map(([key, label]) => `<label for="feedback-${key}">${label}</label><textarea id="feedback-${key}" name="${key}" maxlength="4000" rows="2"></textarea>`).join("")}</form>
    <details><summary>核对完整反馈文本与版本</summary><textarea class="feedback-preview" readonly aria-label="完整反馈文本" rows="10"></textarea></details>
    <p class="feedback-status" role="status"></p><div class="feedback-actions"><button type="button" data-feedback-copy>复制反馈文本</button><a class="feedback-github" target="_blank" rel="noopener noreferrer">前往 GitHub 提交 ↗</a><button type="button" data-feedback-clear>清除暂存</button></div>`;
  app.append(dialog);
  let entry, key, pageUrl, source, opener, selection, previousOverflow, scroll;
  const fields = [...dialog.querySelectorAll("form textarea")];
  const preview = dialog.querySelector(".feedback-preview");
  const status = dialog.querySelector(".feedback-status");
  function values() { return Object.fromEntries(fields.map((field) => [field.name, field.value])); }
  function update({ persist = false } = {}) {
    preview.value = feedbackText(entry, route.mode === "review" ? "review" : "body", pageUrl, values(), source);
    const url = feedbackIssueUrl(entry, route.mode === "review" ? "review" : "body", pageUrl, preview.value, issueUrl);
    const github = dialog.querySelector(".feedback-github");
    github.href = url || issueUrl;
    github.textContent = url ? "前往 GitHub 提交 ↗" : "打开 GitHub 并粘贴反馈 ↗";
    if (persist) status.textContent = store.write(key, values()) ? "已暂存于当前浏览器会话。" : "暂存失败，请复制反馈文本保存。";
    if (!url) status.textContent += " 文本较长，请先复制，再粘贴到 GitHub。";
  }
  document.addEventListener("selectionchange", () => {
    if (dialog.open) return;
    const selected = window.getSelection();
    const element = selected?.anchorNode?.nodeType === Node.ELEMENT_NODE ? selected.anchorNode : selected?.anchorNode?.parentElement;
    const article = element?.closest("article[data-edition]");
    const endElement = selected?.focusNode?.nodeType === Node.ELEMENT_NODE ? selected.focusNode : selected?.focusNode?.parentElement;
    const endArticle = endElement?.closest("article[data-edition]");
    if (selected?.toString().trim() && element?.closest(".prose") && article === endArticle) {
      selection = { text: selected.toString().slice(0, 4000), edition: article.dataset.edition,
        blockId: element.closest(".prose [id]")?.id };
    } else if (selected?.toString().trim()) selection = null;
  }, { signal: events.signal });
  app.addEventListener("click", (event) => {
    const button = event.target.closest("[data-feedback]");
    if (!button) return;
    const article = button.closest("article[data-edition]");
    entry = article ? entries.find((candidate) => candidate.editionId === article.dataset.edition)
      : visibleReadingEntry(app, entries, readingOffset(app)) || route.entry;
    if (!entry) return;
    opener = button;
    const currentArticle = app.querySelector(`article[data-edition="${entry.editionId}"]`);
    const selected = selection?.edition === entry.editionId ? selection : null;
    const block = (selected && document.getElementById(selected.blockId)) || readingToolPosition(currentArticle, readingOffset(app))?.target;
    pageUrl = new URL(location.href);
    if (block?.id) pageUrl.hash = block.id;
    pageUrl = pageUrl.href;
    source = passages.find((passage) => passage.id === block?.id) || {};
    if (!source.heading && block?.closest(".review-group")) {
      const group = block.closest(".review-group");
      source = { heading: group.querySelector("h2")?.textContent, sourceUrl: group.querySelector(".review-sources a")?.href };
    }
    key = feedbackKey(entry, route.mode === "review" ? "review" : "body");
    const saved = store.read(key);
    const initial = saved || { quote: selected?.text || block?.textContent?.slice(0, 4000) || "", context: block?.textContent?.slice(0, 4000) || "" };
    for (const field of fields) field.value = initial[field.name] || "";
    dialog.querySelector(".feedback-identity").textContent = `${entry.title} · P${entry.pageIndex + 1} · ${route.mode === "review" ? "校验参照" : "正文"} · 编辑版本 ${entry.editionId}`;
    status.textContent = saved ? "已恢复当前版本的暂存建议。" : "填写后会暂存，尚未提交。";
    update();
    scroll = window.scrollY; previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal(); fields[2].focus({ preventScroll: true });
  }, { signal: events.signal });
  dialog.addEventListener("input", () => update({ persist: true }), { signal: events.signal });
  dialog.querySelector("form").addEventListener("submit", (event) => event.preventDefault(), { signal: events.signal });
  dialog.addEventListener("close", () => {
    document.body.style.overflow = previousOverflow || "";
    window.scrollTo({ top: scroll, behavior: "instant" }); opener?.focus({ preventScroll: true });
  }, { signal: events.signal });
  dialog.addEventListener("click", async (event) => {
    if (event.target.closest("[data-feedback-close]")) dialog.close();
    if (event.target.closest("[data-feedback-clear]")) {
      for (const field of fields) field.value = "";
      status.textContent = store.remove(key) ? "已清除暂存建议。" : "清除失败，浏览器拒绝访问暂存。"; update();
    }
    if (event.target.closest("[data-feedback-copy]")) {
      try { await navigator.clipboard.writeText(preview.value); status.textContent = "已复制反馈文本，可粘贴或保存。"; }
      catch {
        dialog.querySelector("details").open = true; preview.focus(); preview.select();
        status.textContent = "自动复制失败。完整文本已选中，请手动复制。";
      }
    }
  }, { signal: events.signal });
  return { destroy() { if (dialog.open) { dialog.close(); document.body.style.overflow = previousOverflow || ""; } events.abort(); dialog.remove(); } };
}
