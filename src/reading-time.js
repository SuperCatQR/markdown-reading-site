const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/gu;
const WORD_PATTERN = /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g;

export function estimateReadingMinutes(text, { cjkCharactersPerMinute = 400, wordsPerMinute = 220 } = {}) {
  const value = String(text || "");
  const cjkCharacters = value.match(CJK_PATTERN)?.length || 0;
  const words = value.match(WORD_PATTERN)?.length || 0;
  return Math.max(1, Math.ceil(cjkCharacters / cjkCharactersPerMinute + words / wordsPerMinute));
}
