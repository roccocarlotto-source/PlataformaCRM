import DOMPurify from "dompurify";
import { Marked, type Tokens } from "marked";
import { asignarAnclas, slugDe } from "../../../../src/compartido/guia/guia";

// Markdown de docs/guia-de-uso/ → HTML sanitizado. Dos cosas propias, y
// nada más:
//
// - `## Título {#ancla}` genera `<h2 id="ancla">Título</h2>`: el id es lo que
//   usa el ícono "?" de cada pantalla (features/guia/anclas.ts), así que tiene
//   que ser estable aunque el título cambie. Sin el sufijo, el id sale del
//   texto (slugDe) — sirve para los ### que nadie linkea.
// - Los links externos abren en otra pestaña; los internos (`/contacts`,
//   `/ayuda/...#ancla`) quedan como <a href> comunes y GuiaPage los intercepta
//   para navegar sin recargar.
//
// DOMPurify al final, siempre: el markdown viene del repo y no de un usuario,
// pero se inyecta con dangerouslySetInnerHTML y el día que alguien pegue un
// <script> en una guía no tiene por qué ejecutarse.
//
// slugDe y asignarAnclas viven en la guía compartida (src/compartido/guia/):
// así el índice, este HTML y el asistente "¿Cómo se hace?" ven los mismos ids.
export { asignarAnclas, slugDe };

const SUFIJO_DE_ANCLA = /\s*\{#([a-z0-9-]+)\}\s*$/;

function escaparAtributo(valor: string): string {
  return valor.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth, text }: Tokens.Heading) {
      const match = SUFIJO_DE_ANCLA.exec(text);
      const id = match ? match[1] : slugDe(text);
      const html = this.parser.parseInline(tokens).replace(SUFIJO_DE_ANCLA, "");
      return `<h${depth} id="${id}">${html}</h${depth}>\n`;
    },
    link({ href, title, tokens }: Tokens.Link) {
      const html = this.parser.parseInline(tokens);
      const titulo = title ? ` title="${escaparAtributo(title)}"` : "";
      const externo = /^https?:\/\//i.test(href);
      const extra = externo ? ` target="_blank" rel="noopener noreferrer"` : "";
      return `<a href="${escaparAtributo(href)}"${titulo}${extra}>${html}</a>`;
    },
  },
});

export function renderizarMarkdown(markdown: string): string {
  const html = marked.parse(asignarAnclas(markdown), { async: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ["target"] });
}
