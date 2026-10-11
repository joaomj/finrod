import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: true });
markdown.validateLink = href => {
  try { return ["https:", "http:"].includes(new URL(href, document.baseURI).protocol); }
  catch (error) { if (error instanceof TypeError) return false; throw error; }
};
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index]!.attrSet("target", "_blank");
  tokens[index]!.attrSet("rel", "noopener noreferrer");
  return renderer.renderToken(tokens, index, options);
};
// Do not fetch images supplied by model output or retrieved pages.
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index]!.content);

export function renderMarkdown(body: HTMLElement, text: string) {
  body.innerHTML = markdown.render(text);
}
