import { workKey } from "./source-identity.js";
import { continuousRoute, readerSearchRoute, isDraft } from "./manuscripts.js";
import { parseMatchHash, matchHash } from "./search.js";

export function readerPartRoute(entry, route, search = route.videoSearch || {}) {
  return route.kind === "continuous"
    ? continuousRoute(workKey(entry), route.view, entry.editionId, search)
    : readerSearchRoute(entry, search, route.mode === "review");
}

export function readerFormatRoute(entry, route, continuous, search = route.videoSearch || {}, hash = "") {
  const href = continuous
    ? continuousRoute(workKey(entry), isDraft(entry) ? "drafts" : "published", entry.editionId, search)
    : readerSearchRoute(entry, search, route.mode === "review");
  if (!hash || route.mode === "review") return href;
  const hit = parseMatchHash(hash);
  const prefix = `part-${entry.editionId}-`;
  let id;
  try { id = hit?.id || decodeURIComponent(hash.slice(1)); } catch { return href; }
  if (id.startsWith(prefix)) id = id.slice(prefix.length);
  else if (/^part-[0-9a-f]{32}-/.test(id)) return href;
  const targetId = `${continuous ? prefix : ""}${id}`;
  return href + (hit ? matchHash({ id: targetId }, hit.query, hit.mode) : `#${encodeURIComponent(targetId)}`);
}
