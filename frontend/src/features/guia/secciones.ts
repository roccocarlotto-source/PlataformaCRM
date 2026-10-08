import { asignarAnclas } from "./markdown";

// Las secciones de la guía de uso, leídas de docs/guia-de-uso/ EN EL BUILD:
// Vite las mete en el bundle como strings (`?raw`), así que la pantalla de
// Ayuda no le pide nada al backend y la guía se actualiza con cada deploy del
// frontend. Las convenciones (nombres de archivo, anclas) están en
// docs/guia-de-uso/README.md.
//
// El patrón `[0-9][0-9]-*.md` excluye al README a propósito.
const ARCHIVOS = import.meta.glob<string>("../../../../docs/guia-de-uso/[0-9][0-9]-*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export interface Encabezado {
  nivel: 2 | 3;
  titulo: string;
  ancla: string;
}

export interface Seccion {
  /** La parte de la URL: /ayuda/<slug>. Es el nombre del archivo sin el
   *  prefijo numérico ni la extensión. */
  slug: string;
  orden: number;
  titulo: string;
  markdown: string;
  encabezados: Encabezado[];
  /** La sección "Plataforma" la ve solo el platform admin. */
  soloPlataforma: boolean;
}

const NOMBRE_DE_ARCHIVO = /(\d\d)-([a-z0-9-]+)\.md$/;
const TITULO = /^# (.+?)\s*$/m;
// Después de asignarAnclas, todo ## y ### trae su {#ancla}.
const ENCABEZADO = /^(##|###) (.+?)\s*\{#([a-z0-9-]+)\}\s*$/;
const SLUG_DE_PLATAFORMA = "plataforma";

export function parsearSeccion(ruta: string, markdown: string): Seccion {
  const nombre = NOMBRE_DE_ARCHIVO.exec(ruta);
  if (!nombre) throw new Error(`Archivo de guía con nombre inesperado: ${ruta}`);
  const titulo = TITULO.exec(markdown)?.[1] ?? nombre[2];
  const encabezados: Encabezado[] = [];
  let enBloqueDeCodigo = false;
  for (const linea of asignarAnclas(markdown).split("\n")) {
    if (linea.startsWith("```")) {
      enBloqueDeCodigo = !enBloqueDeCodigo;
      continue;
    }
    if (enBloqueDeCodigo) continue;
    const match = ENCABEZADO.exec(linea);
    if (!match) continue;
    encabezados.push({
      nivel: match[1] === "##" ? 2 : 3,
      titulo: match[2],
      ancla: match[3],
    });
  }
  return {
    slug: nombre[2],
    orden: Number(nombre[1]),
    titulo,
    markdown,
    encabezados,
    soloPlataforma: nombre[2] === SLUG_DE_PLATAFORMA,
  };
}

export const SECCIONES: Seccion[] = Object.entries(ARCHIVOS)
  .map(([ruta, markdown]) => parsearSeccion(ruta, markdown))
  .sort((a, b) => a.orden - b.orden);

export function seccionesVisibles(esPlatformAdmin: boolean): Seccion[] {
  return SECCIONES.filter((seccion) => !seccion.soloPlataforma || esPlatformAdmin);
}

export function seccionPorSlug(slug: string | undefined): Seccion | undefined {
  return SECCIONES.find((seccion) => seccion.slug === slug);
}

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export interface ResultadoDeBusqueda {
  seccion: Seccion;
  /** Los encabezados que coinciden; vacío si coincidió el título de la sección. */
  encabezados: Encabezado[];
}

// Buscador simple sobre los títulos (de sección, ## y ###), sin acentos ni
// mayúsculas. No busca en el cuerpo del texto a propósito: el índice tiene
// que seguir leyéndose como un índice.
export function buscarEnTitulos(secciones: Seccion[], consulta: string): ResultadoDeBusqueda[] {
  const q = normalizar(consulta);
  if (!q) return secciones.map((seccion) => ({ seccion, encabezados: [] }));
  const resultados: ResultadoDeBusqueda[] = [];
  for (const seccion of secciones) {
    const encabezados = seccion.encabezados.filter((e) => normalizar(e.titulo).includes(q));
    if (encabezados.length > 0 || normalizar(seccion.titulo).includes(q)) {
      resultados.push({ seccion, encabezados });
    }
  }
  return resultados;
}
