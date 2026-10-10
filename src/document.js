import { markdown } from "./markdown.js";

export function inlineText(token) {
  if (!token.children) return token.content || "";
  return token.children.map((child) => {
    if (child.type === "softbreak" || child.type === "hardbreak") return " ";
    if (child.type === "image") return inlineText(child);
    return ["text", "code_inline"].includes(child.type) ? child.content : "";
  }).join("");
}

export function prepareDocument(source, { idPrefix = "", titleLevel = 1 } = {}) {
  const tokens = markdown.parse(source, {});
  const headings = [];
  const blocks = [];
  const hasOpeningTitle = tokens[0]?.type === "heading_open" && tokens[0].tag === "h1";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    let text = "";
    let id = "";
    if (token.type === "heading_open") {
      text = inlineText(tokens[index + 1]);
      const slug = text.toLocaleLowerCase("zh-Hans").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section";
      id = `${idPrefix}${slug}-${headings.length + 1}`;
      headings.push({ id, text, level: Number(token.tag.slice(1)) });
    } else if (token.type === "paragraph_open") {
      text = inlineText(tokens[index + 1]);
      id = `${idPrefix}passage-${blocks.length + 1}`;
    } else if (["fence", "code_block"].includes(token.type)) {
      text = token.content;
      id = `${idPrefix}passage-${blocks.length + 1}`;
    } else if (token.type === "table_open") {
      for (let next = index + 1; next < tokens.length && tokens[next].type !== "table_close"; next += 1) {
        if (tokens[next].type === "inline") text += `${inlineText(tokens[next])} `;
      }
      id = `${idPrefix}passage-${blocks.length + 1}`;
    }
    if (!id) continue;
    token.attrSet("id", id);
    if (!(index === 0 && hasOpeningTitle)) {
      blocks.push({ id, text: text.replace(/\s+/gu, " ").trim() });
    }
  }
  if (idPrefix) for (const token of tokens) for (const child of token.children || []) {
    const href = child.attrGet("href");
    if (child.type === "link_open" && href?.startsWith("#")) child.attrSet("href", `#${idPrefix}${href.slice(1)}`);
  }
  if (titleLevel !== 1) for (const token of tokens) {
    if (["heading_open", "heading_close"].includes(token.type)) token.tag = `h${Math.min(6, Number(token.tag.slice(1)) + titleLevel - 1)}`;
  }
  const title = hasOpeningTitle ? markdown.renderer.render(tokens.slice(0, 3), markdown.options, {}) : "";
  const body = markdown.renderer.render(hasOpeningTitle ? tokens.slice(3) : tokens, markdown.options, {});
  return { title, body, headings, blocks, tokens };
}
