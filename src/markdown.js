import MarkdownIt from "markdown-it";

export const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });

markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const href = token.attrGet("href") || "";
  if (/^https?:\/\//i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return renderer.renderToken(tokens, index, options);
};
