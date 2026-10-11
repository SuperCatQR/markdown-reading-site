// URL owns shareable conditions; this bounded session owns actual return state.
import { parseRoute } from '../core/router.js';

const MAX_PAGES = 12;
const MAX_READERS = 40;
const MAX_LIMIT = 10000;
const MAX_EXPANDED = 2000;
const MAX_SCROLL = 100000000;
const validHref = (href) => typeof href === 'string' && /^#\/(library|search)(?:\?|$)/u.test(href) && href.length <= 5000 && ['library', 'search'].includes(parseRoute(href).name);
const validPage = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && Number.isFinite(value.y) && value.y >= 0 && value.y <= MAX_SCROLL
  && Number.isSafeInteger(value.limit) && value.limit >= 1 && value.limit <= MAX_LIMIT
  && Array.isArray(value.expanded) && value.expanded.length <= MAX_EXPANDED
  && value.expanded.every((index) => Number.isSafeInteger(index) && index >= 0 && index <= MAX_LIMIT);
const clonePage = (value) => ({ y: value.y, limit: value.limit, expanded: [...new Set(value.expanded)] });

export function createNavigationSession({ storage, environment = globalThis.window } = {}) {
  if (storage === undefined) { try { storage = globalThis.sessionStorage; } catch { storage = null; } }
  const key = 'reader-refactor-navigation-v1';
  let saved;
  try { saved = JSON.parse(storage.getItem(key) || 'null'); } catch { saved = null; }
  const pages = new Map(Array.isArray(saved?.pages) ? saved.pages.filter((item) => Array.isArray(item) && item.length === 2 && validHref(item[0]) && validPage(item[1])).slice(-MAX_PAGES).map(([href, value]) => [href, clonePage(value)]) : []);
  let returnHref = validHref(saved?.returnHref) ? saved.returnHref : '#/library';
  const readers = new Map();
  const persist = () => { try { storage.setItem(key, JSON.stringify({ pages: [...pages], returnHref })); } catch { /* Navigation remains usable when session storage is unavailable. */ } };
  return {
    capture(hash, root, limit = 32) {
      if (!validHref(hash)) return;
      const details = [...root.querySelectorAll('details')];
      const value = { y: environment.scrollY, limit, expanded: [...root.querySelectorAll('details[open]')].map((node) => details.indexOf(node)) };
      if (!validPage(value)) return;
      pages.delete(hash);
      pages.set(hash, clonePage(value));
      returnHref = hash;
      if (pages.size > MAX_PAGES) pages.delete(pages.keys().next().value);
      persist();
    },
    page(hash) { const page = pages.get(hash); return page && clonePage(page); },
    restore(hash, root) {
      const page = pages.get(hash);
      if (!page) { environment.scrollTo({ top: 0, behavior: 'instant' }); return; }
      const details = root.querySelectorAll('details');
      page.expanded.forEach((index) => { if (details[index]) details[index].open = true; });
      environment.scrollTo({ top: page.y, behavior: 'instant' });
    },
    get returnHref() { return returnHref; },
    saveReader(mode, editionId, location) {
      if (!['read', 'verify'].includes(mode) || !/^[0-9a-f]{32}$/u.test(editionId) || !location || location.editionId !== editionId
        || typeof location.anchor !== 'string' || (location.anchor && !/^[\p{L}\p{N}_-]{1,256}$/u.test(location.anchor))
        || !Number.isFinite(location.offset) || location.offset < 0 || location.offset > 1) return;
      const readerKey = `${mode}:${editionId}`;
      readers.delete(readerKey);
      readers.set(readerKey, { editionId, anchor: location.anchor, offset: location.offset, flow: Boolean(location.flow) });
      if (readers.size > MAX_READERS) readers.delete(readers.keys().next().value);
    },
    reader(mode, editionId) { const location = readers.get(`${mode}:${editionId}`); return location && { ...location }; },
  };
}
