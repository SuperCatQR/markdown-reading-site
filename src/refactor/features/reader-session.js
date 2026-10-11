import { prepareDocument, prepareReviewDocument } from '../../../packages/content-core/index.js';
import { isDraft, partsFor } from '../core/content.js';

export function prepareReaderDocument(source, editionId, review = false) {
  const document = review ? prepareReviewDocument(source) : prepareDocument(source);
  // Canonical anchors remain in the model and URL. DOM IDs are unique across P.
  const prefix = `e-${editionId}-`;
  const scopeIds = (html) => html.replace(/\bid="([^"]+)"/gu, (_match, id) => `id="${prefix}${id}" data-block-id="${id}"`)
    .replace(/href="#([^"]+)"/gu, (_match, id) => `href="#${prefix}${id}" data-reader-block="${id}" data-edition-id="${editionId}"`);
  return { ...document, title: scopeIds(document.title), body: scopeIds(document.body) };
}

export function createReaderSession(repository, route) {
  const documents = new Map();
  let current = repository.findEdition(route.editionId);
  const parts = current ? partsFor(current, repository.list(isDraft(current) ? 'drafts' : 'published')) : [];
  let loading = false;
  return {
    route, parts, documents,
    get entry() { return current; },
    get prepared() { return documents.get(current?.editionId)?.prepared; },
    setCurrent(editionId) { if (documents.has(editionId)) current = documents.get(editionId).entry; },
    get next() {
      const last = [...documents.values()].at(-1)?.entry || current;
      return parts[parts.findIndex((part) => part.editionId === last?.editionId) + 1];
    },
    async load(entry = current, signal) {
      if (!entry) throw new Error('没有找到这篇稿件');
      if (documents.has(entry.editionId)) return documents.get(entry.editionId);
      const source = route.name === 'verify' ? await repository.loadReview(entry, { signal }) : await repository.loadBody(entry, { signal });
      signal?.throwIfAborted();
      const item = { entry, source, prepared: prepareReaderDocument(source, entry.editionId, route.name === 'verify') };
      documents.set(entry.editionId, item);
      // Bound loaded DOM and documents at the controller level when adding P.
      return item;
    },
    async append(signal) {
      if (loading || !this.next) return null;
      loading = true;
      try { return await this.load(this.next, signal); } finally { loading = false; }
    },
  };
}

export function readingLocation(root) {
  const articles = [...root.querySelectorAll('.reader-article[data-edition-id]')];
  const article = articles.find((node) => node.getBoundingClientRect().bottom > 90);
  if (!article) return null;
  const prose = article.querySelector('.reader-prose');
  const block = prose?.getBoundingClientRect().top <= 90 ? [...prose.querySelectorAll('[data-block-id]')].find((node) => node.getBoundingClientRect().bottom > 90) : null;
  return { editionId: article.dataset.editionId, anchor: block?.dataset.blockId || '', offset: block ? Math.max(0, Math.min(1, (90 - block.getBoundingClientRect().top) / Math.max(1, block.getBoundingClientRect().height))) : 0 };
}

export function restoreReadingLocation(root, location) {
  if (!location) return;
  const article = root.querySelector(`.reader-article[data-edition-id="${CSS.escape(location.editionId)}"]`);
  const block = article && [...article.querySelectorAll('[data-block-id]')].find((node) => node.dataset.blockId === location.anchor);
  if (block) window.scrollTo({ top: window.scrollY + block.getBoundingClientRect().top - 90 + (location.offset || 0) * block.getBoundingClientRect().height, behavior: 'instant' });
  // Start just inside the same 90px reading line used to identify the current P.
  // Placing the next article below that line would still identify the previous P.
  else if (article) window.scrollTo({ top: Math.max(0, window.scrollY + article.getBoundingClientRect().top - 89), behavior: 'instant' });
}
