import { routeHref } from '../core/router.js';

const editionPattern = /^[0-9a-f]{32}$/u;
const views = new Set(['read', 'verify']);

function checkedEntry(entry) {
  if (!entry || !editionPattern.test(entry.editionId) || !Number.isSafeInteger(entry.partIndex) || entry.partIndex < 0) throw new TypeError('Invalid document identity');
  return entry;
}

function checkedView(view) {
  if (!views.has(view)) throw new TypeError('Invalid document view');
  return view;
}

export function documentShareUrl({ entry, view = 'read', anchor = '', flow = false, baseUrl }) {
  checkedEntry(entry); checkedView(view);
  if (typeof anchor !== 'string' || typeof flow !== 'boolean') throw new TypeError('Invalid reading position');
  const href = routeHref(view, { editionId: entry.editionId, block: anchor, flow: view === 'read' && flow });
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('Invalid site URL');
  // The current contract owns all reading conditions in the hash.
  url.search = '';
  url.hash = href.slice(1);
  return url.href;
}

export function markdownDownloadFilename(entry, view = 'read') {
  checkedEntry(entry); checkedView(view);
  let title = String(entry.title || '').replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]/gu, ' ').replace(/\s+/gu, ' ').replace(/^[ .]+|[ .]+$/gu, '').trim();
  title = Array.from(title).slice(0, 80).join('').replace(/[ .]+$/u, '') || '稿件';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(title)) title = `稿件-${title}`;
  const part = entry.platform === 'youtube' ? '单视频' : `P${entry.partIndex + 1}`;
  return `${title}-${part}-${view === 'verify' ? '核验参照' : '正文'}.md`;
}

export function currentDocumentSource(session, { editionId = session?.entry?.editionId, view = session?.route?.name } = {}) {
  checkedView(view);
  if (!session || session.route?.name !== view || !editionPattern.test(editionId)) throw new TypeError('Document view does not match the loaded session');
  const item = session.documents?.get(editionId);
  if (!item || item.entry?.editionId !== editionId || typeof item.source !== 'string') throw new Error('The original document is not loaded');
  checkedEntry(item.entry);
  return item.source;
}

export function markdownDownload(session, options = {}) {
  const editionId = options.editionId ?? session?.entry?.editionId;
  const view = options.view ?? session?.route?.name;
  const text = currentDocumentSource(session, { editionId, view });
  const entry = session.documents.get(editionId).entry;
  return { filename: markdownDownloadFilename(entry, view), text, type: 'text/markdown;charset=utf-8', editionId, view };
}

export function createDocumentActionsController({ root, getDocument, environment = globalThis }) {
  let operation = 0;
  const viewOf = (value) => value === 'body' ? 'read' : value === 'review' ? 'verify' : value;
  const targetKey = (value) => JSON.stringify([value.entry?.editionId, value.entry?.artifactSha256, value.entry?.reviewArtifactSha256, viewOf(value.mode), value.flow, value.anchor, value.baseUrl]);
  function outputNode() {
    let node = root.querySelector('[data-document-action-output]');
    if (!node) {
      const document = root.ownerDocument;
      const label = document.createElement('label');
      label.textContent = '自动复制失败，请选中下面的完整文本手动复制。';
      node = document.createElement('textarea');
      node.dataset.documentActionOutput = ''; node.readOnly = true; node.rows = 8;
      node.setAttribute('aria-label', '可手动复制的完整文本');
      label.append(node);
      (root.querySelector('.tool-sheet') || root).append(label);
    }
    return node;
  }
  return {
    async perform(action) {
      if (action === 'copy-paragraph-link') action = 'copy-link';
      if (!['copy-link', 'copy-markdown', 'download-markdown'].includes(action)) return { ok: false, reason: 'unknown-action' };
      const target = getDocument(), token = ++operation;
      const key = targetKey(target), status = root.querySelector('[data-document-action-status]');
      const view = checkedView(viewOf(target.mode));
      checkedEntry(target.entry);
      const current = () => token === operation && (!status || status.isConnected && root.contains(status)) && targetKey(getDocument()) === key;
      const setStatus = (text) => { if (current() && status) status.textContent = text; };
      setStatus(action === 'download-markdown' ? '正在准备原始 Markdown…' : '正在复制…');
      if (action === 'download-markdown') {
        if (typeof target.source !== 'string') throw new Error('The original document is not loaded');
        const url = environment.URL.createObjectURL(new environment.Blob([target.source], { type: 'text/markdown;charset=utf-8' }));
        try {
          const link = root.ownerDocument.createElement('a');
          link.href = url; link.download = markdownDownloadFilename(target.entry, view); link.click();
          setStatus('已下载当前准确版本的原始 Markdown。');
          return { ok: true };
        } finally { environment.setTimeout(() => environment.URL.revokeObjectURL(url), 1000); }
      }
      const text = action === 'copy-link' ? documentShareUrl({ entry: target.entry, view, anchor: target.anchor || '', flow: Boolean(target.flow), baseUrl: target.baseUrl }) : target.source;
      if (typeof text !== 'string') throw new Error('The original document is not loaded');
      try {
        await environment.navigator.clipboard.writeText(text);
        if (!current()) return { ok: true, stale: true };
        setStatus(action === 'copy-link' ? '已复制当前段落的准确版本链接。' : '已复制当前视图的原始完整 Markdown。');
        const output = root.querySelector('[data-document-action-output]');
        if (output) { output.value = ''; output.hidden = true; }
        return { ok: true };
      } catch {
        if (!current()) return { ok: false, stale: true, reason: 'copy-failed' };
        const output = outputNode(); output.value = text; output.hidden = false;
        setStatus('自动复制失败，可以在下方选中完整文本手动复制。');
        return { ok: false, reason: 'copy-failed' };
      }
    },
  };
}
