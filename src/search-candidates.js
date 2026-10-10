import { sourceTags } from "./source-identity.js";
import { normalizeSearch, searchTerms } from "./search.js";
import { validWorkKey } from "./source-identity.js";

// UTF-16 pairs deliberately match String.includes, including surrogate pairs.
// Intersecting sampled pairs can admit false positives, never reject a match.
export const candidatePartitionCount = 64;
export const candidatePartition = (gram) => ((gram.charCodeAt(0) * 31 + gram.charCodeAt(1)) >>> 0) % candidatePartitionCount;

export function queryGrams(query, mode) {
  const grams = [...new Set(searchTerms(query, mode).flatMap((term) => {
    if (term.length < 2) return [];
    const positions = [...new Set([0, Math.floor((term.length - 2) / 3), Math.floor(2 * (term.length - 2) / 3), term.length - 2])];
    return positions.map((position) => term.slice(position, position + 2));
  }))];
  if (grams.length <= 8) return grams;
  return Array.from({ length: 8 }, (_, index) => grams[Math.floor(index * (grams.length - 1) / 7)]);
}

export function metadataMatches(entry, query) {
  const term = normalizeSearch(query);
  return term && [entry.title, entry.summary, sourceTags(entry).join(" · ")].some((text) => normalizeSearch(text).includes(term));
}

export function candidateIds(manifest, grams, partitions) {
  let candidates = null;
  for (const gram of grams) {
    const ids = partitions.get(candidatePartition(gram)).postings[gram] || [];
    const selected = new Set(ids);
    candidates = candidates === null ? ids : candidates.filter((id) => selected.has(id));
    if (!candidates.length) break;
  }
  return candidates || manifest.entries.map((_, id) => id);
}

export function validateCandidateManifest(manifest) {
  if (manifest?.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.fingerprint) || !Array.isArray(manifest.entries)
      || manifest.entries.some((record) => !Array.isArray(record) || record.length !== 2 || typeof record[0] !== "string" || !validWorkKey(record[1]))
      || new Set(manifest.entries.map(([key]) => key)).size !== manifest.entries.length) throw Error("Invalid search candidates");
  return manifest;
}

export function validateCandidatePartition(index, manifest, partition) {
  if (index?.version !== 1 || index.fingerprint !== manifest.fingerprint || !index.postings || typeof index.postings !== "object" || Array.isArray(index.postings)) throw Error("Search candidates version mismatch");
  for (const [gram, ids] of Object.entries(index.postings)) {
    if (gram.length !== 2 || candidatePartition(gram) !== partition || !Array.isArray(ids)
        || ids.some((id, position) => !Number.isInteger(id) || id < 0 || id >= manifest.entries.length || (position > 0 && id <= ids[position - 1]))) throw Error("Invalid search candidate postings");
  }
  return index;
}
