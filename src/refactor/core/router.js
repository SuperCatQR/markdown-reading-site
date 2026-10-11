const allowedViews = new Set(["all", "drafts", "published"]);
const allowedModes = new Set(["general", "phrase", "keywords"]);

function queryFromRoute(value) {
  const query = new URLSearchParams(value);
  const view = query.get("view") || "all";
  const mode = query.get("mode") || "general";
  return {
    query: query.get("q") || "",
    view: allowedViews.has(view) ? view : "all",
    mode: allowedModes.has(mode) ? mode : "general",
    tag: query.get("tag") || "",
    sort: query.get("sort") === "title" ? "title" : "relevance",
  };
}

export function parseRoute(hash = location.hash) {
  const value = hash.replace(/^#/, "") || "/library";
  const [path, rawQuery = ""] = value.split("?");
  const query = queryFromRoute(rawQuery);
  if (path === "/library" || path === "/") return { name: "library", ...query };
  if (path === "/search") return { name: "search", ...query };
  if (path === "/recent") return { name: "recent" };
  const read = path.match(/^\/(read|verify)\/([0-9a-f]{32})$/u);
  const routeQuery = new URLSearchParams(rawQuery);
  if (read) return { name: read[1] === "verify" ? "verify" : "read", editionId: read[2], flow: routeQuery.get("flow") === "continuous", block: routeQuery.get("block") || "" };
  return { name: "missing" };
}

export function routeHref(name, params = {}) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.view && params.view !== "all") query.set("view", params.view);
  if (params.mode && params.mode !== "general") query.set("mode", params.mode);
  if (params.tag) query.set("tag", params.tag);
  if (params.sort && params.sort !== "relevance") query.set("sort", params.sort);
  if (name === "library") return `#/library${query.toString() ? `?${query}` : ""}`;
  if (name === "recent") return "#/recent";
  if (name === "read" || name === "verify") {
    const query = new URLSearchParams();
    if (params.flow) query.set("flow", "continuous");
    if (params.block) query.set("block", params.block);
    return `#/${name}/${params.editionId}${query.toString() ? `?${query}` : ""}`;
  }
  return `#/search${query.toString() ? `?${query}` : ""}`;
}

export function navigate(name, params = {}) {
  location.hash = routeHref(name, params);
}
