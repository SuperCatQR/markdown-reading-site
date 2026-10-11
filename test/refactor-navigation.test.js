import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationSession } from '../src/refactor/services/navigation-session.js';

const key = 'reader-refactor-navigation-v1';
function storage(initial = null) {
  let saved = initial;
  return { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
}
function environment() {
  return { scrollY: 450, scrollTo(value) { this.scrollY = value.top; } };
}
function root() {
  const details = [{ open: false }, { open: true }];
  return { details, querySelectorAll: (query) => query === 'details[open]' ? details.filter((node) => node.open) : details };
}

test('navigation persists actual query, pagination, disclosure and position through reload', () => {
  const disk = storage(), env = environment(), page = root();
  const first = createNavigationSession({ storage: disk, environment: env });
  first.capture('#/search?q=自由&view=drafts', page, 64);
  const second = createNavigationSession({ storage: disk, environment: env });
  assert.equal(second.returnHref, '#/search?q=自由&view=drafts');
  assert.equal(second.page(second.returnHref).limit, 64);
  page.details[1].open = false; env.scrollY = 0;
  second.restore(second.returnHref, page);
  assert.equal(page.details[1].open, true);
  assert.equal(env.scrollY, 450);
});

test('corrupt page values and ambiguous routes cannot enter navigation state', () => {
  const page = { y: 100, limit: 32, expanded: [0] };
  for (const bad of [null, [], { ...page, y: -1 }, { ...page, y: 1e12 }, { ...page, limit: -1 }, { ...page, limit: 1e12 },
    { ...page, expanded: [null] }, { ...page, expanded: ['__proto__'] }, { ...page, expanded: [{}] }, { ...page, expanded: [0.5] }, { ...page, expanded: [-1] }, { ...page, expanded: [10001] }, { ...page, expanded: Array(2001).fill(0) }]) {
    const state = createNavigationSession({ storage: storage(JSON.stringify({ pages: [['#/library', bad]] })), environment: environment() });
    assert.equal(state.page('#/library'), undefined);
  }
  for (const href of ['', '#/', '#/library?view=bad', '#/search?q=x&q=y', '#/read/' + 'a'.repeat(32), 'javascript:alert(1)']) {
    const state = createNavigationSession({ storage: storage(JSON.stringify({ pages: [[href, page]], returnHref: href })), environment: environment() });
    assert.equal(state.page(href), undefined);
    assert.equal(state.returnHref, '#/library');
  }
  for (const value of ['{', 'null', '[]', '{}']) assert.equal(createNavigationSession({ storage: storage(value), environment: environment() }).returnHref, '#/library');
});

test('navigation is bounded, defensive and usable with denied storage', () => {
  const env = environment(), page = root();
  const state = createNavigationSession({ storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } }, environment: env });
  for (let index = 0; index < 14; index++) state.capture('#/search?q=' + index, page, 32);
  assert.equal(state.page('#/search?q=0'), undefined);
  assert.equal(state.page('#/search?q=13').limit, 32);
  const copy = state.page('#/search?q=13'); copy.limit = -1; copy.expanded.push('__proto__');
  assert.equal(state.page('#/search?q=13').limit, 32);
  assert.deepEqual(state.page('#/search?q=13').expanded, [1]);
  state.capture('#/library', page, -50);
  assert.equal(state.page('#/library'), undefined);
  const edition = 'a'.repeat(32);
  state.saveReader('read', edition, { editionId: edition, anchor: 'passage-2', offset: 0.4, flow: true });
  assert.equal(state.reader('verify', edition), undefined);
  const location = state.reader('read', edition); location.offset = 0;
  assert.equal(state.reader('read', edition).offset, 0.4);
  state.saveReader('read', edition, { editionId: edition, anchor: 'passage-3', offset: NaN });
  assert.equal(state.reader('read', edition).anchor, 'passage-2');
});
