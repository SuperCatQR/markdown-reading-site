import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentActionsController, currentDocumentSource, documentShareUrl, markdownDownload, markdownDownloadFilename } from '../src/refactor/features/document-actions.js';
import { parseRoute } from '../src/refactor/core/router.js';

const first = { editionId: 'a'.repeat(32), title: '哲学入门', partIndex: 0, platform: 'bilibili' };
const second = { ...first, editionId: 'b'.repeat(32), partIndex: 1 };
const original = '\uFEFF# 原标题\r\n\r\n未经改写的 *Markdown* & <原文>\r\n';
function session(view = 'read') {
  return { route: { name: view, editionId: first.editionId }, entry: second, documents: new Map([
    [first.editionId, { entry: first, source: original, prepared: { body: '<p>此处是渲染HTML</p>' } }],
    [second.editionId, { entry: second, source: '# 第二部分\n\n真实正文\n', prepared: { body: '<p>另一段HTML</p>' } }],
  ]) };
}

test('document links preserve exact edition, view, canonical paragraph and site subpath', () => {
  const url = documentShareUrl({ entry: second, view: 'read', anchor: '论证-2', flow: true, baseUrl: 'https://example.test/reading-site/?old=query#/read/' + first.editionId });
  const target = new URL(url);
  assert.equal(target.pathname, '/reading-site/');
  assert.equal(target.search, '');
  assert.deepEqual(parseRoute(target.hash), { name: 'read', editionId: second.editionId, flow: true, block: '论证-2' });
  const review = documentShareUrl({ entry: first, view: 'verify', anchor: 'passage-3', flow: true, baseUrl: 'http://127.0.0.1:5180/' });
  assert.deepEqual(parseRoute(new URL(review).hash), { name: 'verify', editionId: first.editionId, flow: false, block: 'passage-3' });
  assert.throws(() => documentShareUrl({ entry: first, anchor: '<unsafe>', baseUrl: 'https://example.test/' }), TypeError);
  assert.throws(() => documentShareUrl({ entry: first, baseUrl: 'javascript:alert(1)' }), TypeError);
});

test('copy and download select current loaded edition source exactly, never rendered HTML or first route P', () => {
  const loaded = session();
  assert.equal(currentDocumentSource(loaded), '# 第二部分\n\n真实正文\n');
  const download = markdownDownload(loaded, { editionId: first.editionId });
  assert.equal(download.text, original);
  assert.equal(download.filename, '哲学入门-P1-正文.md');
  assert.equal(download.type, 'text/markdown;charset=utf-8');
  assert.equal(download.editionId, first.editionId);
  assert.equal(download.view, 'read');
  assert.equal(markdownDownload(session('verify')).filename, '哲学入门-P2-核验参照.md');
  assert.throws(() => currentDocumentSource(loaded, { view: 'verify' }), TypeError);
  assert.throws(() => currentDocumentSource(loaded, { editionId: 'c'.repeat(32) }), /not loaded/u);
  loaded.documents.get(second.editionId).source = null;
  assert.throws(() => markdownDownload(loaded), /not loaded/u);
});

test('download filenames tolerate traversal, Windows reserved names, controls and long Unicode', () => {
  for (const title of ['../../CON', '..\\..\\aux:bad?*<>|"', '\u0000\u202e稿件\n标题', '.', '  ... ', 'CON', 'NUL.txt', '😀'.repeat(500)]) {
    const filename = markdownDownloadFilename({ ...first, title });
    assert.ok(filename.endsWith('-P1-正文.md'));
    assert.equal(/[\p{Cc}\p{Cf}<>:"/\\|?*]/u.test(filename), false);
    assert.equal(/^[ .]|[ .]$/u.test(filename), false);
    assert.equal(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(filename), false);
    assert.ok(filename.length <= 180);
  }
  assert.equal(markdownDownloadFilename({ ...first, title: '中文长文', platform: 'youtube' }, 'verify'), '中文长文-单视频-核验参照.md');
  assert.throws(() => markdownDownloadFilename({ ...first, partIndex: -1 }), TypeError);
  assert.throws(() => markdownDownloadFilename(first, 'body'), TypeError);
});

test('browser action controller targets the same exact document and ignores stale async clipboard completion', async () => {
  const status = { isConnected: true, textContent: '', parentNode: null };
  const links = [];
  const root = {
    ownerDocument: { createElement: (tag) => tag === 'a' ? { click: () => links.push(true) } : { dataset: {}, setAttribute() {}, readOnly: false, rows: 0, append() {} } },
    querySelector: (selector) => selector === '[data-document-action-status]' ? status : null,
    contains: (node) => node === status,
  };
  let target = { entry: first, source: original, mode: 'body', flow: false, anchor: 'passage-1', baseUrl: 'https://example.test/' };
  let resolveClipboard;
  const clipboard = { writeText: () => new Promise((resolve) => { resolveClipboard = resolve; }) };
  const environment = { navigator: { clipboard }, URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} }, Blob, setTimeout };
  const controller = createDocumentActionsController({ root, getDocument: () => target, environment });
  const pending = controller.perform('copy-markdown');
  target = { ...target, entry: second, source: '# 第二篇' };
  resolveClipboard();
  assert.deepEqual(await pending, { ok: true, stale: true });
  assert.equal(status.textContent, '正在复制…');
  clipboard.writeText = async () => {};
  assert.deepEqual(await controller.perform('copy-paragraph-link'), { ok: true });
  assert.match(status.textContent, /准确版本链接/u);
});

test('copy failure exposes unmodified manual text and downloads use the original UTF8 bytes then revoke URL', async () => {
  const status = { isConnected: true, textContent: '' };
  const output = { value: '', hidden: true };
  let downloaded, capturedBlob, revokeCallback, revoked;
  const root = {
    contains: (node) => node === status,
    ownerDocument: { createElement: () => ({ click() { downloaded = { href: this.href, filename: this.download }; } }) },
    querySelector: (selector) => selector === '[data-document-action-status]' ? status : selector === '[data-document-action-output]' ? output : null,
  };
  const environment = { navigator: { clipboard: { async writeText() { throw Error('denied'); } } }, Blob,
    URL: { createObjectURL(blob) { capturedBlob = blob; return 'blob:original'; }, revokeObjectURL(url) { revoked = url; } },
    setTimeout(callback) { revokeCallback = callback; },
  };
  const controller = createDocumentActionsController({ root, getDocument: () => ({ entry: first, source: original, mode: 'read', baseUrl: 'https://example.test/' }), environment });
  assert.deepEqual(await controller.perform('copy-markdown'), { ok: false, reason: 'copy-failed' });
  assert.equal(output.value, original);
  assert.equal(output.hidden, false);
  assert.match(status.textContent, /手动复制/u);
  assert.deepEqual(await controller.perform('download-markdown'), { ok: true });
  assert.deepEqual(downloaded, { href: 'blob:original', filename: '哲学入门-P1-正文.md' });
  assert.deepEqual(new Uint8Array(await capturedBlob.arrayBuffer()), new TextEncoder().encode(original));
  assert.equal(capturedBlob.type, 'text/markdown;charset=utf-8');
  assert.equal(revoked, undefined);
  revokeCallback(); assert.equal(revoked, 'blob:original');
  environment.navigator.clipboard.writeText = async () => {};
  assert.deepEqual(await controller.perform('copy-markdown'), { ok: true });
  assert.equal(output.value, '');
  assert.equal(output.hidden, true);
});
