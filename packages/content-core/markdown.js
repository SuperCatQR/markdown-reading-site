import MarkdownIt from "markdown-it";

export const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });

for (const type of ["fence", "code_block"]) {
  const render = markdown.renderer.rules[type];
  markdown.renderer.rules[type] = (tokens, index, ...args) => {
    const html = render(tokens, index, ...args);
    const id = tokens[index].attrGet("id");
    return id ? html.replace("<pre>", `<pre id="${markdown.utils.escapeHtml(id)}">`) : html;
  };
}

markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const href = token.attrGet("href") || "";
  if (/^https?:\/\//i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return renderer.renderToken(tokens, index, options);
};
