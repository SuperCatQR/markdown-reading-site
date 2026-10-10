import { readingToolPosition, restoreReadingToolPosition } from "./reading-position.js";

const titles = { search: "视频内查找", review: "当前校验参照内查找", source: "来源与版本", outline: "当前篇导览", parts: "同视频目录" };

export function bindReaderPanels({ app, getCurrent, offset }) {
  const dialog = app.querySelector("#reader-panel");
  const layout = app.querySelector(".reader-layout");
  const events = new AbortController();
  const desktop = window.matchMedia("(min-width: 1100px)");
  let kind, saved, savedScroll, trigger, frame, anchorStyle;
  const restore = () => {
    if (!restoreReadingToolPosition(saved, offset(), { focus: false })) window.scrollTo({ top: savedScroll, behavior: "instant" });
  };
  function open(nextKind) {
    const edition = getCurrent()?.editionId;
    const selector = `[data-reader-panel="${nextKind}"]${["source", "outline"].includes(nextKind) ? `[data-edition="${edition}"]` : ""}`;
    const section = app.querySelector(selector);
    if (!section || (nextKind === "outline" && !section.textContent.trim())) return;
    if (frame) cancelAnimationFrame(frame);
    if (!dialog.open) {
      trigger = document.activeElement;
      saved = readingToolPosition(app, offset());
      savedScroll = window.scrollY;
      anchorStyle = app.style.overflowAnchor;
      app.style.overflowAnchor = "none";
      app.dispatchEvent(new CustomEvent("reading-tool-open", { detail: { scroll: savedScroll } }));
    } else if (kind !== nextKind) {
      app.dispatchEvent(new CustomEvent("reader-panel-close", { detail: { kind, restore: false } }));
    }
    dialog.querySelectorAll("[data-reader-panel]").forEach((node) => { node.hidden = true; });
    dialog.querySelector(".reader-panel-content").append(section);
    section.hidden = false;
    kind = nextKind;
    dialog.querySelector("#reader-panel-title").textContent = titles[kind];
    if (!dialog.open) {
      layout.classList.add("has-reader-panel");
      if (desktop.matches) dialog.show();
      else dialog.showModal();
    }
    restore();
    frame = requestAnimationFrame(() => { frame = null; restore(); });
    (section.querySelector('input, a, button') || dialog.querySelector("[data-reader-panel-close]")).focus({ preventScroll: true });
    app.querySelectorAll("[data-reader-panel-open]").forEach((button) => button.setAttribute("aria-expanded", String(button.dataset.readerPanelOpen === kind)));
    app.dispatchEvent(new CustomEvent("reader-panel-open", { detail: { kind } }));
  }

  function close({ restorePosition = true } = {}) {
    if (!dialog.open) return;
    if (frame) cancelAnimationFrame(frame);
    dialog.close();
    layout.classList.remove("has-reader-panel");
    app.querySelectorAll("[data-reader-panel-open]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    app.dispatchEvent(new CustomEvent("reader-panel-close", { detail: { kind, restore: restorePosition } }));
    if (restorePosition) {
      restore();
      frame = requestAnimationFrame(() => {
        restore(); frame = null;
        app.style.overflowAnchor = anchorStyle;
        app.dispatchEvent(new CustomEvent("reading-tool-return"));
      });
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    } else {
      app.style.overflowAnchor = anchorStyle;
      app.dispatchEvent(new CustomEvent("reading-tool-navigate"));
    }
  }
  app.addEventListener("reader-panel-request", (event) => open(event.detail.kind), { signal: events.signal });
  app.addEventListener("reader-panel-dismiss", (event) => close(event.detail), { signal: events.signal });
  app.addEventListener("reading-tool-abandon", () => {
    // A desktop reader can keep the non-modal panel open while resuming prose.
    // Closing it should then preserve the new body position, not rewind reading.
    if (dialog.open) { saved = readingToolPosition(app, offset()); savedScroll = window.scrollY; }
  }, { signal: events.signal });
  app.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reader-panel-open]");
    if (button) {
      const nextKind = button.dataset.readerPanelOpen;
      if (dialog.open && kind === nextKind) close(); else open(nextKind);
    }
    if (event.target.closest("[data-reader-panel-close], #cancel-video-search")) close();
    const link = event.target.closest("a[href]");
    if (dialog.open && link && dialog.contains(link) && !link.target && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) close({ restorePosition: false });
    if (dialog.open && event.target.closest("[data-feedback], #reader-settings")) close();
  }, { capture: true, signal: events.signal });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); }, { signal: events.signal });
  // A dock and a modal drawer have different focus rules. Close the tool when
  // crossing that breakpoint so a resized window never retains the wrong mode.
  desktop.addEventListener("change", () => close(), { signal: events.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialog.open && !app.querySelector('dialog[open]:not(#reader-panel)')) { event.preventDefault(); close(); }
  }, { signal: events.signal });
  return { open, close, destroy() {
    events.abort(); if (frame) cancelAnimationFrame(frame);
    if (dialog.open) { dialog.close(); app.style.overflowAnchor = anchorStyle; }
  } };
}
