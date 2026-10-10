import { workKey } from "../src/source-identity.js";
import test from "node:test";
import assert from "node:assert/strict";
import { directoryResults } from "../src/directory-view.js";
import { sanitizeSearchOrigin } from "../src/directory-state.js";
import { passageNavigationMarkup } from "../src/search-navigation.js";
import { resolveReaderRoute } from "../src/manuscripts.js";
import { parseMatchHash } from "../src/search.js";

const entry = (partIndex) => ({ partIndex, contentVersion: 2, platform: "bilibili", externalVideoId: "BVscope", manuscriptType: "publication-draft",
  editionId: String(partIndex + 1).padStart(32, "0"), title: "自由的讨论", slug: `p-${partIndex}`,
  reviewStatus: "pending-review", sourceMetadata: { title: "合成来源", metadataObservedAt: null, creatorName: null, creatorId: null, tags: [] }, tags: [], sourceUrl: "https://example.test/video" });
const first = entry(0), second = entry(2);
const body = { id: "passage-8", text: "自由", terms: ["自由"] };
const options = { view: "drafts", query: "自由 人格", mode: "keywords", visibleCount: 24, expanded: [], passages: [], counts: { drafts: 2 } };
const summaries = Object.fromEntries([first, second].map((item) => [`${item.manuscriptType}:${item.editionId}`, { minutes: 1 }]));
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));

test("directory title selects first real body hit across source parts and preserves the complete request", () => {
  const html = directoryResults([{ entry: first, match: { id: null, label: "标题", text: first.title } },
    { entry: second, match: body, matches: [body] }], options, summaries).html;
  const title = new URL(hrefs(html)[0], "https://example.test/");
  const route = resolveReaderRoute(title.search, [], [first, second]);
  assert.equal(route.entry, second);
  assert.deepEqual(route.videoSearch, { query: "自由 人格", mode: "keywords", view: "drafts" });
  assert.deepEqual(parseMatchHash(title.hash), { id: "passage-8", query: "自由", mode: "keywords" });
  for (const href of hrefs(html).filter((href) => href.startsWith("?"))) {
    assert.equal(new URL(href, "https://example.test/").searchParams.get("vq"), options.query);
  }
  assert.match(html, /h2><a data-directory-search/);
});

test("metadata-only title has a shareable query but no invented passage; ordinary directory remains a plain link", () => {
  const match = { entry: first, match: { id: null, label: "标题", text: first.title } };
  const search = new URL(hrefs(directoryResults([match], options, summaries).html)[0], "https://example.test/");
  assert.equal(search.hash, "");
  assert.equal(search.searchParams.get("vq"), options.query);
  const plain = directoryResults([{ entry: first }], { ...options, query: "" }, summaries).html;
  assert.equal(hrefs(plain)[0], `?draft=${first.editionId}`);
  assert.doesNotMatch(plain, /data-directory-search/);
});

test("only an explicit same-video search origin exposes restore; invalid or cached directory state cannot establish origin", () => {
  const directory = { query: "自由", mode: "phrase", sort: "title", tag: "哲学", scroll: 721,
    visibleCount: 72, expanded: ["bilibili.BVscope"], passages: [`publication-draft:${first.editionId}`] };
  const raw = { kind: "directory-search", videoKey: "bilibili.BVscope", view: "drafts", directory };
  const origin = sanitizeSearchOrigin(raw, workKey(first));
  assert.deepEqual(origin.directory, directory);
  assert.equal(sanitizeSearchOrigin(raw, "BVother"), null);
  assert.equal(sanitizeSearchOrigin({ ...raw, kind: undefined }, workKey(first)), null);
  assert.equal(sanitizeSearchOrigin({ ...raw, view: "bad" }, workKey(first)), null);
  assert.equal(sanitizeSearchOrigin({ ...raw, directory: { ...directory, query: " " } }, workKey(first)), null);
  const request = { query: "新的本视频查询", mode: "general", view: "all" };
  const state = { current: 0, total: 1, previous: null, next: null };
  const withOrigin = passageNavigationMarkup(state, request, origin);
  const global = new URL(hrefs(withOrigin)[0], "https://example.test/");
  assert.equal(global.searchParams.get("q"), "自由");
  assert.equal(global.searchParams.get("mode"), "phrase");
  assert.equal(global.searchParams.get("tag"), "哲学");
  assert.equal(global.searchParams.get("sort"), "title");
  assert.match(withOrigin, /data-return-global/);
  assert.match(withOrigin, /查看本视频命中/);
  const direct = passageNavigationMarkup(state, request);
  assert.doesNotMatch(direct, /data-return-global|返回全站搜索结果/);
  assert.match(direct, /重新全站搜索/);
});
