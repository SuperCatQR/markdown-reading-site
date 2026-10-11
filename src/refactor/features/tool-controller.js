import { readingLocation, restoreReadingLocation } from './reader-session.js';

export function createToolController(root) {
  let opener;
  let background = [];
  let layoutFrame, pendingPosition;
  const capturePosition = () => {
    const position = readingLocation(root);
    if (!position) return null;
    const article = root.querySelector(`.reader-article[data-edition-id="${CSS.escape(position.editionId)}"]`);
    const blocks = [...article.querySelectorAll('.reader-prose [data-block-id]')].filter((node) => node.checkVisibility());
    const block = blocks.find((node) => node.dataset.blockId === position.anchor)
      || (article.querySelector('.reader-prose').getBoundingClientRect().top <= 90 ? blocks.at(-1) : null);
    // Tool reflow also preserves positions in the whitespace before a block.
    if (block) { position.anchor = block.dataset.blockId; position.offset = (90 - block.getBoundingClientRect().top) / Math.max(1, block.getBoundingClientRect().height); }
    else position.headerOffset = 89 - article.getBoundingClientRect().top;
    return position;
  };
  const restorePosition = (position) => {
    restoreReadingLocation(root, position);
    if (position?.headerOffset) window.scrollBy({ top: position.headerOffset, behavior: 'instant' });
  };
  const settlePosition = (position, scrollTop = null) => {
    cancelAnimationFrame(layoutFrame);
    pendingPosition = position;
    layoutFrame = requestAnimationFrame(() => {
      if (scrollTop !== null) window.scrollTo({ top: scrollTop, behavior: 'instant' });
      else restorePosition(position);
      pendingPosition = null;
    });
  };
  const wideScreen = window.matchMedia('(min-width: 1100px)');
  const updateLayout = () => {
    const drawer = root.querySelector('.tool-drawer');
    if (!drawer) return;
    const position = pendingPosition || capturePosition();
    root.dataset.readerToolMode = wideScreen.matches ? 'docked' : 'modal';
    drawer.setAttribute('aria-modal', String(!wideScreen.matches));
    background.forEach((node) => { node.inert = !wideScreen.matches; });
    settlePosition(position);
  };
  wideScreen.addEventListener('change', updateLayout);
  const focusable = () => [...root.querySelectorAll('.tool-drawer a[href], .tool-drawer button, .tool-drawer input, .tool-drawer textarea, .tool-drawer select, .tool-drawer summary')].filter((node) => !node.disabled && node.getClientRects().length);
  return {
    get open() { return !!root.querySelector('.tool-drawer'); },
    show(html) {
      if (!this.open) { opener = document.activeElement; background = [...root.children]; }
      root.querySelector('.tool-drawer')?.remove();
      root.insertAdjacentHTML('beforeend', html);
      const drawer = root.querySelector('.tool-drawer');
      updateLayout();
      drawer?.setAttribute('tabindex', '-1');
      (focusable()[0] || drawer)?.focus({ preventScroll: true });
    },
    close({ restoreFocus = true, restoreReading = true } = {}) {
      const position = this.open ? pendingPosition || capturePosition() : null;
      const scrollTop = this.open ? window.scrollY : null;
      cancelAnimationFrame(layoutFrame); pendingPosition = null;
      root.querySelector('.tool-drawer')?.remove();
      delete root.dataset.readerToolMode;
      background.forEach((node) => { node.inert = false; });
      background = [];
      if (restoreFocus && restoreReading) settlePosition(position, scrollTop);
      if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    },
    keyboard(event) {
      if (!this.open) return;
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      if (event.key !== 'Tab' || wideScreen.matches) return;
      const items = focusable();
      const first = items[0], last = items.at(-1);
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    },
    dispose() { this.close({ restoreFocus: false }); wideScreen.removeEventListener('change', updateLayout); },
  };
}
