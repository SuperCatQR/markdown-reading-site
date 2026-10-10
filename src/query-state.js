// Whitespace-only URLs/inputs are empty; preserve meaningful typing and IME spacing.
export const visibleQuery = (query = "") => query.trim() ? query : "";
