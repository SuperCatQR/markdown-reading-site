import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHref } from "../src/refactor/core/router.js";

const edition = "a".repeat(32);
test("routes round trip exact edition, flow, Unicode blocks and search context", () => {
  assert.deepEqual(parseRoute(routeHref("read", { editionId: edition, flow: true, block: "论证-2" })), { name: "read", editionId: edition, flow: true, block: "论证-2" });
  assert.deepEqual(parseRoute(routeHref("search", { q: "what? 哲学 & 自由", view: "drafts", mode: "keywords", tag: "人文", sort: "title" })), {
    name: "search", query: "what? 哲学 & 自由", view: "drafts", mode: "keywords", tag: "人文", sort: "title",
  });
  assert.equal(parseRoute("#/search?q=what?now").query, "what?now");
  assert.equal(parseRoute("").name, "library");
});

test("duplicate, unknown, empty enum, invalid block and malformed percent values reject routes", () => {
  for (const route of [
    `#/read/${edition}?block=passage-1&block=passage-2`, `#/read/${edition}?%62lock=passage-1&block=passage-2`,
    `#/read/${edition}?flow=wrong`, `#/read/${edition}?flow=`, `#/read/${edition}?block=`, `#/read/${edition}?block=x.y`,
    `#/read/${edition}?q=title`, `#/read/${edition}?block=%`, `#/read/${edition}?block=%FF`,
    `#/read/${edition}?block=passage-1?bad`, `#/read/${edition.toUpperCase()}`, `#/read/${edition.slice(1)}`,
    "#/library?unknown=x", "#/search?q=x&q=y", "#/library?view=hidden", "#/library?view=", "#/search?mode=other", "#/search?sort=wrong",
    "#/recent?q=x", "#/search?q=%00", "#/search?q=%F0%28%8C%28", "#/search?q=" + "a".repeat(4001),
  ]) assert.equal(parseRoute(route).name, "missing", route);
});

test("href construction rejects routes that cannot be safely consumed", () => {
  assert.throws(() => routeHref("read", { editionId: "bad" }), TypeError);
  assert.throws(() => routeHref("read", { editionId: edition, block: '<script>' }), TypeError);
  assert.throws(() => routeHref("search", { view: "invalid" }), TypeError);
  assert.throws(() => routeHref("unknown"), TypeError);
});
