import DOMPurify from "dompurify";
import { Marked, type Tokens } from "marked";

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

const SUFIJO_DE_ANCLA = /\s*\{#([a-z0-9-]+)\}\s*$/;

export function slugDe(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const LINEA_DE_ENCABEZADO = /^(#{2,6}) (.+?)(?:\s*\{#([a-z0-9-]+)\})?\s*$/;

// Deja TODO encabezado ## a ###### con su `{#ancla}` explícita: la que trae,
// o el slug del texto, con un sufijo -2, -3… si ya se usó en el archivo (dos
// "### Filtros" en secciones distintas son normales). Una sola función para
// el índice (secciones.ts) y el HTML (renderizarMarkdown), así los dos ven
// exactamente los mismos ids. Los bloques de código se saltean.
export function asignarAnclas(markdown: string): string {
  const usadas = new Set<string>();
  let enBloqueDeCodigo = false;
  return markdown
    .split("\n")
    .map((linea) => {
      if (linea.startsWith("```")) {
        enBloqueDeCodigo = !enBloqueDeCodigo;
        return linea;
      }
      if (enBloqueDeCodigo) return linea;
      const match = LINEA_DE_ENCABEZADO.exec(linea);
      if (!match) return linea;
      const base = match[3] ?? slugDe(match[2]);
      let ancla = base;
      for (let n = 2; usadas.has(ancla); n++) ancla = `${base}-${n}`;
      usadas.add(ancla);
      return `${match[1]} ${match[2]} {#${ancla}}`;
    })
    .join("\n");
}

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
