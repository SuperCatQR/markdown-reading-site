const allowedViews = new Set(["all", "drafts", "published"]);
const allowedModes = new Set(["general", "phrase", "keywords"]);
const allowedSorts = new Set(["title", "relevance"]);
const editionPattern = /^[0-9a-f]{32}$/u;
const blockPattern = /^[\p{L}\p{N}_-]{1,256}$/u;

function checkedQuery(raw, allowed) {
  try {
    for (const pair of raw.split("&")) for (const component of pair.split("=")) decodeURIComponent(component.replace(/\+/g, " "));
  } catch { return null; }
  const query = new URLSearchParams(raw);
  const keys = new Set();
  for (const [key] of query) {
    if (!allowed.has(key) || keys.has(key)) return null;
    keys.add(key);
  }
  return query;
}

export function parseRoute(hash = globalThis.location?.hash || "") {
  if (typeof hash !== "string") return { name: "missing" };
  const value = hash.replace(/^#/, "") || "/library";
  const separator = value.indexOf("?");
  const path = separator === -1 ? value : value.slice(0, separator);
  const raw = separator === -1 ? "" : value.slice(separator + 1);
  if (["/library", "/", "/search"].includes(path)) {
    const query = checkedQuery(raw, new Set(["q", "view", "mode", "tag", "sort"]));
    if (!query) return { name: "missing" };
    const view = query.has("view") ? query.get("view") : "all";
    const mode = query.has("mode") ? query.get("mode") : "general";
    const sort = query.has("sort") ? query.get("sort") : "relevance";
    const text = query.get("q") || "";
    const tag = query.get("tag") || "";
    if (!allowedViews.has(view) || !allowedModes.has(mode) || !allowedSorts.has(sort) || text.length > 4000 || tag.length > 200 || /[\u0000-\u001f\u007f]/u.test(text + tag)) return { name: "missing" };
    return { name: path === "/search" ? "search" : "library", query: text, view, mode, tag, sort };
  }
  if (path === "/recent") return raw ? { name: "missing" } : { name: "recent" };
  const read = path.match(/^\/(read|verify)\/([0-9a-f]{32})$/u);
  if (!read) return { name: "missing" };
  const query = checkedQuery(raw, new Set(["flow", "block"]));
  if (!query || (query.has("flow") && query.get("flow") !== "continuous") || (query.has("block") && !blockPattern.test(query.get("block")))) return { name: "missing" };
  return { name: read[1], editionId: read[2], flow: query.has("flow"), block: query.get("block") || "" };
}

export function routeHref(name, params = {}) {
  const query = new URLSearchParams();
  let path;
  if (["read", "verify"].includes(name)) {
    if (!editionPattern.test(params.editionId)) throw new TypeError("Invalid edition identity");
    path = "/" + name + "/" + params.editionId;
    if (params.flow) query.set("flow", "continuous");
    if (params.block) query.set("block", params.block);
  } else if (["library", "search"].includes(name)) {
    path = "/" + name;
    if (params.q) query.set("q", params.q);
    if (params.view && params.view !== "all") query.set("view", params.view);
    if (params.mode && params.mode !== "general") query.set("mode", params.mode);
    if (params.tag) query.set("tag", params.tag);
    if (params.sort && params.sort !== "relevance") query.set("sort", params.sort);
  } else if (name === "recent") path = "/recent";
  else throw new TypeError("Invalid route name");
  const href = "#" + path + (query.size ? "?" + query : "");
  if (parseRoute(href).name === "missing") throw new TypeError("Invalid route parameters");
  return href;
}

export function navigate(name, params = {}) {
  location.hash = routeHref(name, params);
}