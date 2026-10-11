import urls from "virtual:reader-search-urls";
import { createSearchEngine } from "./search-engine.js";

export function createSearchService(repository, options = {}) {
  return createSearchEngine(repository, urls, options);
}
