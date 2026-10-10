import { workKey } from "../src/source-identity.js";
import { normalizeSearch } from "../src/search.js";
import { candidatePartitionCount, candidatePartition } from "../src/search-candidates.js";
import { entryKey } from "../src/manuscripts.js";
import { sha256 } from "./catalog.js";

export function buildCandidateData(entries, index) {
  const byKey = new Map(entries.map((entry) => [entryKey(entry), entry]));
  const keys = Object.keys(index);
  const fingerprint = sha256(JSON.stringify(index));
  const manifest = { version: 1, fingerprint, entries: keys.map((key) => [key, workKey(byKey.get(key))]) };
  const partitions = Array.from({ length: candidatePartitionCount }, () => ({ version: 1, fingerprint, postings: Object.create(null) }));
  for (const [id, key] of keys.entries()) {
    const grams = new Set();
    for (const block of index[key]) {
      const text = normalizeSearch(block.text);
      for (let position = 0; position < text.length - 1; position++) grams.add(text.slice(position, position + 2));
    }
    for (const gram of grams) (partitions[candidatePartition(gram)].postings[gram] ||= []).push(id);
  }
  return { manifest, partitions };
}
