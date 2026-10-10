import test from "node:test";
import assert from "node:assert/strict";
import { passageNavigation, passageNavigationState, passageNavigationMarkup } from "../src/search-navigation.js";
import { parseMatchHash } from "../src/search.js";
import { resolveReaderRoute } from "../src/manuscripts.js";

const entry = (partIndex, kind = "publication-draft") => ({ partIndex, contentVersion: 2, platform: "bilibili", externalVideoId: "BVone", manuscriptType: kind,
  editionId: `${partIndex + 1}`.padStart(32, kind === "publication" ? "f" : "0"), slug: `part-${partIndex}`, sourceMetadata: { title: "合成来源", metadataObservedAt: null, creatorName: null, creatorId: null, tags: [] }, tags: [], title: "标题" });
const block = (id) => ({ id, text: "自由原句", terms: ["自由"] });

test("reading hits traverse actual body order within one category, exclude metadata, and keep clear boundaries", () => {
  const first = entry(0), second = entry(9), published = entry(0, "publication");
  const matches = [
    { entry: second, matches: [block("passage-10"), block("passage-11")] },
    { entry: published, matches: [block("passage-1")] },
    { entry: first, matches: [block("passage-2"), block("passage-12"), block("passage-12")] },
    { entry: entry(3), match: { label: "标题", id: null }, matches: [] },
  ];
  const passages = passageNavigation(matches, "publication-draft");
  assert.deepEqual(passages.map(({ match }) => match.id), ["passage-2", "passage-12", "passage-10", "passage-11"]);
  assert.equal(passages[0].entry, first);
  const start = passageNavigationState(passages, first, "#hit=passage-2&q=自由");
  assert.equal(start.previous, null);
  assert.equal(start.total, 4);
  const crossing = passageNavigationState(passages, first, "#hit=passage-12&q=自由");
  assert.equal(crossing.next.entry, second);
  assert.equal(passageNavigationState(passages, first, `#hit=part-${second.editionId}-passage-10&q=自由`).current, 2);
  const last = passageNavigationState(passages, second, "#hit=passage-11&q=自由");
  assert.equal(last.next, null);
  assert.equal(passageNavigationState(passages, first, "#hit=missing&q=自由").current, -1);
  assert.equal(passageNavigationState(passages, published, "#hit=passage-2&q=自由").current, -1);
  const html = passageNavigationMarkup(crossing, { query: "自由 人格", mode: "keywords", view: "all", manuscriptType: first.manuscriptType });
  const href = html.match(/data-search-hit="next" href="([^"]+)"/)[1].replaceAll("&amp;", "&");
  const url = new URL(href, "https://example.test/");
  const route = resolveReaderRoute(url.search, [published], [first, second]);
  assert.equal(route.entry, second);
  assert.deepEqual(route.videoSearch, { query: "自由 人格", mode: "keywords", view: "all" });
  assert.deepEqual(parseMatchHash(url.hash), { id: "passage-10", query: "自由", mode: "keywords" });
  assert.match(html, /2 \/ 4/);
  assert.match(html, /data-search-results/);
  assert.match(html, /data-search-end data-reading-tool-return/);
});

test("metadata-only and empty matches yield no passage navigation and quoted queries cannot inject markup", () => {
  const draft = entry(0);
  assert.deepEqual(passageNavigation([{ entry: draft, match: { id: null }, matches: [] }], draft.manuscriptType), []);
  const state = passageNavigationState([], draft, "#hit=passage-1&q=test");
  assert.equal(state.current, -1);
  const html = passageNavigationMarkup({ current: 0, total: 1, previous: null, next: { entry: draft, match: block("passage-1") } }, { query: '<img src=x onerror="bad">', mode: "general", view: "drafts" });
  assert.doesNotMatch(html, /<img|onerror="bad"/);
  assert.match(html, /aria-disabled="true"/);
});
