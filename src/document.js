import { markdown } from "./markdown.js";

function inlineText(token) {
  if (!token.children) return token.content || "";
  return token.children.map((child) => {
    if (child.type === "softbreak" || child.type === "hardbreak") return " ";
    if (child.type === "image") return inlineText(child);
    return ["text", "code_inline"].includes(child.type) ? child.content : "";
  }).join("");
}

export function prepareDocument(source) {
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
      id = `${slug}-${headings.length + 1}`;
      headings.push({ id, text, level: Number(token.tag.slice(1)) });
    } else if (token.type === "paragraph_open") {
      text = inlineText(tokens[index + 1]);
      id = `passage-${blocks.length + 1}`;
    } else if (["fence", "code_block"].includes(token.type)) {
      text = token.content;
      id = `passage-${blocks.length + 1}`;
    } else if (token.type === "table_open") {
      for (let next = index + 1; next < tokens.length && tokens[next].type !== "table_close"; next += 1) {
        if (tokens[next].type === "inline") text += `${inlineText(tokens[next])} `;
      }
      id = `passage-${blocks.length + 1}`;
    }
    if (!id) continue;
    token.attrSet("id", id);
    if (!(index === 0 && hasOpeningTitle)) {
      blocks.push({ id, text: text.replace(/\s+/gu, " ").trim() });
    }
  }
  const title = hasOpeningTitle ? markdown.renderer.render(tokens.slice(0, 3), markdown.options, {}) : "";
  const body = markdown.renderer.render(hasOpeningTitle ? tokens.slice(3) : tokens, markdown.options, {});
  return { title, body, headings, blocks };
}
