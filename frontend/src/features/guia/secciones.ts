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

// Ediciones (docs/ediciones.md §9): los bloques de la guía que dependen de un
// módulo, como `<slug>#<ancla>` → módulo. Un bloque es un ## (con sus ###) o
// un ### con {#ancla} propia (hasta el próximo ### o ##).
//
//   - MODULO_DE_ANCLA: el bloque explica algo de ese módulo; sin el módulo,
//     no se muestra.
//   - SOLO_SIN_MODULO: el bloque explica cómo se hace SIN ese módulo (lo de la
//     edición Esencial); con el módulo, no se muestra.
//
// Con la regla de useModulo, en COMPLETA (también una clínica) se ven los
// primeros y no los segundos; en ESENCIAL, al revés. Un bloque que no está en
// ninguno de los dos se muestra siempre.
export const MODULO_DE_ANCLA: Readonly<Record<string, string>> = {
  "contactos-y-consultas#empresas": "empresas",
  "contactos-y-consultas#nueva-empresa": "empresas",
  "oportunidades-y-procesos-de-venta#oportunidades": "procesos_de_venta",
  "oportunidades-y-procesos-de-venta#embudo": "procesos_de_venta",
  "oportunidades-y-procesos-de-venta#nueva-oportunidad": "procesos_de_venta",
  "oportunidades-y-procesos-de-venta#ficha-de-oportunidad": "procesos_de_venta",
  "oportunidades-y-procesos-de-venta#cotizaciones": "cotizaciones",
  "oportunidades-y-procesos-de-venta#pagos": "pagos",
  "oportunidades-y-procesos-de-venta#permuta": "permutas",
  "oportunidades-y-procesos-de-venta#entrega": "entregas",
  "oportunidades-y-procesos-de-venta#cerrar": "procesos_de_venta",
  "oportunidades-y-procesos-de-venta#procesos-de-venta": "procesos_de_venta",
  "oportunidades-y-procesos-de-venta#etapas": "procesos_de_venta",
  "stock#desde-una-permuta": "permutas",
};

export const SOLO_SIN_MODULO: Readonly<Record<string, string>> = {
  "oportunidades-y-procesos-de-venta#oportunidades-esencial": "procesos_de_venta",
};

const ENCABEZADO_CUALQUIERA = /^(##|###) /;
const ANCLA_EXPLICITA = /\{#([a-z0-9-]+)\}\s*$/;

/** La sección sin los bloques que no van con los módulos de la organización.
 *  Si no oculta nada, devuelve la MISMA sección. */
export function filtrarPorModulos(seccion: Seccion, tiene: (modulo: string) => boolean): Seccion {
  const oculta = (ancla: string) => {
    const clave = `${seccion.slug}#${ancla}`;
    const sinElModulo = MODULO_DE_ANCLA[clave];
    const soloSinElModulo = SOLO_SIN_MODULO[clave];
    return (
      (sinElModulo !== undefined && !tiene(sinElModulo)) ||
      (soloSinElModulo !== undefined && tiene(soloSinElModulo))
    );
  };
  if (!seccion.encabezados.some((e) => oculta(e.ancla))) return seccion;

  // El nivel del bloque que se está ocultando (2 o 3), o null.
  let ocultandoDesde: number | null = null;
  const entra = (nivel: number, ancla: string | undefined) => {
    if (ocultandoDesde !== null && nivel <= ocultandoDesde) ocultandoDesde = null;
    if (ocultandoDesde === null && ancla !== undefined && oculta(ancla)) ocultandoDesde = nivel;
    return ocultandoDesde === null;
  };

  const lineas: string[] = [];
  let enBloqueDeCodigo = false;
  for (const linea of seccion.markdown.split("\n")) {
    if (linea.startsWith("```")) enBloqueDeCodigo = !enBloqueDeCodigo;
    const encabezado = enBloqueDeCodigo ? null : ENCABEZADO_CUALQUIERA.exec(linea);
    if (encabezado) entra(encabezado[1].length, ANCLA_EXPLICITA.exec(linea)?.[1]);
    if (ocultandoDesde === null) lineas.push(linea);
  }

  ocultandoDesde = null;
  const encabezados = seccion.encabezados.filter((e) => entra(e.nivel, e.ancla));
  return { ...seccion, markdown: lineas.join("\n"), encabezados };
}

// Un link a un bloque que quedó oculto lleva a la sección, sin el ancla: así
// nunca hay un link a algo que no se ve. Cubre los links a otra sección
// (/ayuda/<slug>#<ancla>) y los de la misma (#<ancla>).
function sinLinksAOcultos(
  seccion: Seccion,
  original: Seccion,
  ocultas: ReadonlySet<string>,
): Seccion {
  const markdown = seccion.markdown
    .replace(/\]\(\/ayuda\/([a-z0-9-]+)#([a-z0-9-]+)\)/g, (link, slug: string, ancla: string) =>
      ocultas.has(`${slug}#${ancla}`) ? `](/ayuda/${slug})` : link,
    )
    .replace(/\]\(#([a-z0-9-]+)\)/g, (link, ancla: string) =>
      ocultas.has(`${original.slug}#${ancla}`) ? `](/ayuda/${original.slug})` : link,
    );
  return markdown === seccion.markdown ? seccion : { ...seccion, markdown };
}

/** Las secciones que ve quien está en la app: "Plataforma" solo el platform
 *  admin, y los bloques que van con los módulos de la organización (`tiene`,
 *  la regla de useModulo). */
export function seccionesVisibles(
  esPlatformAdmin: boolean,
  tiene: (modulo: string) => boolean = () => true,
): Seccion[] {
  const originales = SECCIONES.filter((seccion) => !seccion.soloPlataforma || esPlatformAdmin);
  const filtradas = originales.map((seccion) => filtrarPorModulos(seccion, tiene));
  const ocultas = new Set<string>();
  filtradas.forEach((seccion, i) => {
    const visibles = new Set(seccion.encabezados.map((e) => e.ancla));
    for (const e of originales[i].encabezados) {
      if (!visibles.has(e.ancla)) ocultas.add(`${seccion.slug}#${e.ancla}`);
    }
  });
  if (ocultas.size === 0) return filtradas;
  return filtradas.map((seccion, i) => sinLinksAOcultos(seccion, originales[i], ocultas));
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
