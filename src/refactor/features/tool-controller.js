export function createToolController(root) {
  let opener;
  let background = [];
  const focusable = () => [...root.querySelectorAll('.tool-drawer a[href], .tool-drawer button, .tool-drawer input, .tool-drawer textarea, .tool-drawer select, .tool-drawer summary')].filter((node) => !node.disabled && node.getClientRects().length);
  return {
    get open() { return !!root.querySelector('.tool-drawer'); },
    show(html) {
      if (!this.open) { opener = document.activeElement; background = [...root.children]; background.forEach((node) => { node.inert = true; }); }
      root.querySelector('.tool-drawer')?.remove();
      root.insertAdjacentHTML('beforeend', html);
      const drawer = root.querySelector('.tool-drawer');
      drawer?.setAttribute('tabindex', '-1');
      (focusable()[0] || drawer)?.focus({ preventScroll: true });
    },
    close({ restoreFocus = true } = {}) {
      root.querySelector('.tool-drawer')?.remove();
      background.forEach((node) => { node.inert = false; });
      background = [];
      if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    },
    keyboard(event) {
      if (!this.open) return;
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0], last = items.at(-1);
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    },
  };
}
