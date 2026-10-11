import directory from "virtual:reader-directory";
import summaries from "virtual:reader-summaries";
import { createRepository } from "./repository.js";

export function createContentRepository(options = {}) {
  return createRepository(directory, { summaries, ...options });
}
