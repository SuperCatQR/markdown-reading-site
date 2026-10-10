export function visibleReadingEntry(app, entries, topOffset) {
  const articles = [...app.querySelectorAll('.reading-article[data-edition], .continuous-part[data-edition]')];
  const article = articles.find((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.top <= topOffset && bounds.bottom > topOffset;
  }) || articles.find((element) => element.getBoundingClientRect().bottom > topOffset);
  return entries.find((entry) => entry.editionId === article?.dataset.edition);
}

export function readingToolPosition(app, offset) {
  for (const block of app.querySelectorAll(".prose [id]")) {
    if (block.closest("details:not([open])")) continue;
    const rect = block.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom > offset && rect.top < window.innerHeight) {
      return { target: block, fraction: Math.max(0, Math.min(1, (offset - rect.top) / rect.height)) };
    }
  }
  return null;
}

export function restoreReadingToolPosition(position, offset, { focus = true } = {}) {
  if (!position?.target.isConnected) return false;
  const rect = position.target.getBoundingClientRect();
  window.scrollTo({ top: Math.max(0, window.scrollY + rect.top + rect.height * position.fraction - offset), behavior: "instant" });
  if (focus) {
    const hadTabindex = position.target.hasAttribute("tabindex");
    if (!hadTabindex) position.target.setAttribute("tabindex", "-1");
    position.target.focus({ preventScroll: true });
    if (!hadTabindex) position.target.addEventListener("blur", () => position.target.removeAttribute("tabindex"), { once: true });
  }
  return true;
}
