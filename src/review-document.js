import { prepareDocument, inlineText } from "./document.js";
import { markdown } from "./markdown.js";
export { contributionVersion } from "./contribution-version.js";

export const normalizedQuote = (text) => text.replace(/\s+/gu, " ").trim();

// Work on the same tokens that own the original anchors. All unrecognised
// content is rendered too; this presentation never rewrites the frozen file.
export function prepareReviewDocument(source) {
  const document = prepareDocument(source);
  const chunks = [];
  for (let i = 0; i < document.tokens.length;) {
    const start = i++;
    const first = document.tokens[start];
    if (first.nesting === 1) while (i < document.tokens.length) {
      const token = document.tokens[i++];
      if (token.nesting === -1 && token.level === first.level) break;
    }
    const tokens = document.tokens.slice(start, i);
    chunks.push({ tokens, first, text: tokens.filter((token) => token.type === "inline").map(inlineText).join(" ") });
  }
  const groups = [];
  let currentGroup;
  for (const chunk of chunks) {
    if (chunk.first.tag === "h2" && chunk.first.type === "heading_open"
      && /^段落 \d+：\d{2}:\d{2}:\d{2} — \d{2}:\d{2}:\d{2}$/u.test(chunk.text)) {
      currentGroup = { heading: chunk, chunks: [] };
      groups.push(currentGroup);
    } else if (chunk.first.type === "heading_open" && ["h1", "h2"].includes(chunk.first.tag)) {
      currentGroup = null;
    } else if (currentGroup) currentGroup.chunks.push(chunk);
  }
  const structured = groups.length > 0 && groups.every((group) =>
    ["来源：", "原文：", "整理稿："].every((prefix) => group.chunks.some((chunk) =>
      chunk.first.type === "paragraph_open" && chunk.text.startsWith(prefix))));
  if (!structured) return { ...document, structured: false, passages: [] };
  // Markdown's tight lists hide paragraph tags, including their anchor IDs.
  // Expose those tags so doubts can be searched and deep-linked as well.
  for (const token of document.tokens) if (["paragraph_open", "paragraph_close"].includes(token.type)) token.hidden = false;
  const render = (tokens) => markdown.renderer.render(tokens, markdown.options, {});
  const firstGroup = chunks.indexOf(groups[0].heading);
  const metadata = chunks.slice(0, firstGroup);
  const passages = [];
  const renderGroup = (group) => `<section class="review-group">${render(group.heading.tokens)}${group.chunks.map((chunk) => {
      const role = chunk.first.type === "paragraph_open" ? ["来源", "原文", "整理稿"].find((label) => chunk.text.startsWith(`${label}：`)) : null;
      if (role) chunk.first.attrJoin("class", { 来源: "review-sources", 原文: "review-original", 整理稿: "review-edited" }[role]);
      if (role === "整理稿") passages.push({ id: chunk.first.attrGet("id"), text: normalizedQuote(chunk.text.slice(4)),
        heading: group.heading.text, sourceUrl: group.chunks.find((item) => item.text.startsWith("来源："))?.tokens
          .flatMap((token) => token.children || []).find((token) => token.type === "link_open")?.attrGet("href") });
      if (chunk.first.type === "bullet_list_open" && chunk.tokens.filter((token) => token.type === "inline").every((token) => inlineText(token).startsWith("疑点："))) return `<details class="review-doubts" open><summary>疑点与候选</summary>${render(chunk.tokens)}</details>`;
      return render(chunk.tokens);
    }).join("")}</section>`;
  let body = `<details class="review-metadata"><summary>生成信息与参照说明</summary>${metadata.map((chunk) => render(chunk.tokens)).join("")}</details>`;
  for (let index = firstGroup; index < chunks.length; index++) {
    const group = groups.find((candidate) => candidate.heading === chunks[index]);
    if (group) { body += renderGroup(group); index += group.chunks.length; }
    else body += render(chunks[index].tokens);
  }
  return { ...document, title: "", body, structured: true, passages };
}

export function matchReviewPassages(passages, quote) {
  const text = normalizedQuote(quote);
  if (!text) return [];
  return passages.filter((passage) => passage.text === text);
}
