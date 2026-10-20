// ---------------------------------------------------------------------------
// La guía de uso (docs/guia-de-uso/) como datos: parseo de las secciones y
// qué ve cada quien. Código COMPARTIDO entre los dos paquetes:
//
//   - el frontend (features/guia/secciones.ts) lo importa con un path relativo
//     y le pasa los markdown que Vite mete en el bundle;
//   - el backend (services/guiaDeUso.service.ts) le pasa los mismos markdown
//     leídos del disco, para el asistente "¿Cómo se hace?".
//
// Una sola lógica para los dos, así la pantalla Ayuda y el asistente nunca
// difieren en qué bloques ve una persona. Por eso este archivo no importa
// NADA: ni React ni Vite (no compilan en el backend) ni @prisma/client ni
// src/config (no existen en el frontend). Tiene que pasar el tsconfig de los
// dos paquetes; lo que necesita de afuera (los módulos activables, la regla
// de módulos) lo recibe por parámetro.
//
// Vive dentro de src/ y no en una carpeta de la raíz porque el build del
// backend compila solo src/ (rootDir); el frontend ya lee fuera de su carpeta
// (docs/guia-de-uso), y Vercel incluye esos archivos en el build.
// ---------------------------------------------------------------------------

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

/** Las dos guías: la de la raíz (automotora) y la de docs/guia-de-uso/clinicas/. */
export interface Guia {
  raiz: Seccion[];
  clinica: Seccion[];
}

/** Quién lee la guía. Todo lo decide quien llama, desde la sesión. */
export interface Lector {
  esPlatformAdmin: boolean;
  /** Rol ADMIN de su organización. USER y RECEPCION no ven los bloques de
   *  SOLO_ADMIN_DE_ANCLA (docs-privados: asistente-de-ayuda, P6). */
  esAdmin: boolean;
  esClinica: boolean;
  /** La regla de módulos de la organización (useModulo en el frontend,
   *  modulosDe en el backend). */
  tiene: (modulo: string) => boolean;
  /** MODULOS_ACTIVABLES (src/config/ediciones.ts y su copia del frontend). */
  modulosActivables: ReadonlySet<string>;
}

export interface OpcionesDeVista {
  /** Para el asistente: un bloque de administrador no desaparece, queda su
   *  título con AVISO_DE_ADMIN, así puede contestar "eso lo hace un
   *  administrador" en vez de "la guía no lo cubre". La pantalla Ayuda los
   *  omite. */
  conAvisosDeAdmin?: boolean;
}

// ---------------------------------------------------------------------------
// Anclas
// ---------------------------------------------------------------------------

export function slugDe(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const LINEA_DE_ENCABEZADO = /^(#{2,6}) (.+?)(?:\s*\{#([a-z0-9-]+)\})?\s*$/;

// Deja TODO encabezado ## a ###### con su `{#ancla}` explícita: la que trae,
// o el slug del texto, con un sufijo -2, -3… si ya se usó en el archivo (dos
// "### Filtros" en secciones distintas son normales). Una sola función para
// el índice (parsearSeccion) y el HTML (renderizarMarkdown del frontend), así
// los dos ven exactamente los mismos ids. Los bloques de código se saltean.
//
// Las anclas explícitas se reservan antes: un "### Responder" sin ancla que
// aparece ANTES de "## Responder {#responder}" se lleva "responder-2", y no al
// revés. Si no, el link /ayuda/conversaciones#responder caía en el ###.
export function asignarAnclas(markdown: string): string {
  const lineas = markdown.split("\n");
  const esEncabezado = encabezadosFueraDeCodigo(lineas);
  const reservadas = new Set<string>();
  lineas.forEach((linea, i) => {
    const explicita = esEncabezado[i] ? LINEA_DE_ENCABEZADO.exec(linea)?.[3] : undefined;
    if (explicita !== undefined) reservadas.add(explicita);
  });
  const usadas = new Set<string>();
  return lineas
    .map((linea, i) => {
      const match = esEncabezado[i] ? LINEA_DE_ENCABEZADO.exec(linea) : null;
      if (!match) return linea;
      const explicita = match[3];
      const base = explicita ?? slugDe(match[2]);
      const ocupada = (ancla: string) =>
        usadas.has(ancla) || (explicita === undefined && reservadas.has(ancla));
      let ancla = base;
      for (let n = 2; ocupada(ancla); n++) ancla = `${base}-${n}`;
      usadas.add(ancla);
      return `${match[1]} ${match[2]} {#${ancla}}`;
    })
    .join("\n");
}

/** Para cada línea, si es un encabezado (## a ######) fuera de un bloque de
 *  código. */
function encabezadosFueraDeCodigo(lineas: string[]): boolean[] {
  let enBloqueDeCodigo = false;
  return lineas.map((linea) => {
    if (linea.startsWith("```")) {
      enBloqueDeCodigo = !enBloqueDeCodigo;
      return false;
    }
    return !enBloqueDeCodigo && LINEA_DE_ENCABEZADO.test(linea);
  });
}

// ---------------------------------------------------------------------------
// Parseo
// ---------------------------------------------------------------------------

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

/** Las secciones de un conjunto de archivos `{ruta: markdown}`, ordenadas por
 *  el prefijo numérico. */
export function parsearSecciones(archivos: Record<string, string>): Seccion[] {
  return Object.entries(archivos)
    .map(([ruta, markdown]) => parsearSeccion(ruta, markdown))
    .sort((a, b) => a.orden - b.orden);
}

// ---------------------------------------------------------------------------
// Rubros (docs/rubros.md §1.3, R17): las secciones de la raíz que una clínica
// no ve nunca, y las que ve solo si tiene su módulo. Las demás las reemplaza
// su versión de docs/guia-de-uso/clinicas/ (mismo número).
// ---------------------------------------------------------------------------

const FUERA_DE_CLINICA: ReadonlySet<string> = new Set([
  "oportunidades-y-procesos-de-venta",
  "stock",
]);
export const MODULO_DE_SECCION: Readonly<Record<string, string>> = {
  "cupones-y-qr": "cupones_y_qr",
  "campos-personalizados": "campos_personalizados",
  // El taller (docs/servicios.md §11): un módulo activable, solo automotora.
  servicios: "servicios",
};

/** Las secciones del rubro. Una automotora: las de la raíz, las MISMAS, salvo
 *  las de un módulo activable que no tiene (docs/servicios.md §13.1: sin el
 *  módulo, la guía es la de siempre). Una clínica: cada sección de la raíz
 *  reemplazada por la de clinicas/ con el mismo número; nunca stock ni
 *  oportunidades; y solo las de módulos que tiene. */
export function seccionesDelRubro(
  guia: Guia,
  esClinica: boolean,
  tiene: (modulo: string) => boolean,
  modulosActivables: ReadonlySet<string>,
): Seccion[] {
  if (!esClinica) {
    const visibles = guia.raiz.filter((seccion) => {
      const modulo = MODULO_DE_SECCION[seccion.slug];
      return modulo === undefined || !modulosActivables.has(modulo) || tiene(modulo);
    });
    // Si no saca nada, el MISMO arreglo de siempre (lo fija secciones.test.ts).
    return visibles.length === guia.raiz.length ? guia.raiz : visibles;
  }
  const propias = new Map(guia.clinica.map((seccion) => [seccion.orden, seccion]));
  return guia.raiz.flatMap((seccion) => {
    if (FUERA_DE_CLINICA.has(seccion.slug)) return [];
    const modulo = MODULO_DE_SECCION[seccion.slug];
    if (modulo !== undefined && !tiene(modulo)) return [];
    return [propias.get(seccion.orden) ?? seccion];
  });
}

// ---------------------------------------------------------------------------
// Bloques. Un bloque es un ## (con sus ###) o un ### con {#ancla} propia
// (hasta el próximo ### o ##), identificado como `<slug>#<ancla>`.
//
// Ediciones (docs/ediciones.md §9): los bloques que dependen de un módulo.
//
//   - MODULO_DE_ANCLA: el bloque explica algo de ese módulo; sin el módulo,
//     no se muestra.
//   - SOLO_SIN_MODULO: el bloque explica cómo se hace SIN ese módulo (lo de la
//     edición Esencial); con el módulo, no se muestra.
//
// Con la regla de useModulo, una automotora en COMPLETA ve los primeros y no
// los segundos; en ESENCIAL, al revés. Un bloque que no está en
// ninguno de los dos se muestra siempre.
// ---------------------------------------------------------------------------

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
  // S7: el próximo service (docs/servicios.md §6), solo con el módulo.
  "automatizaciones#evento-proximo-service": "servicios",
  // S11: el bloque del taller en el inicio.
  "primeros-pasos#dashboard-taller": "servicios",
  "automatizaciones#accion-proximo-service": "servicios",
  // S8: los eventos de la orden (docs/servicios.md §9).
  "automatizaciones#evento-orden-cambia-de-estado": "servicios",
  "automatizaciones#evento-orden-entregada": "servicios",
  // S13: el recambio (docs/servicios.md §7).
  "automatizaciones#evento-recambio": "servicios",
};

export const SOLO_SIN_MODULO: Readonly<Record<string, string>> = {
  "oportunidades-y-procesos-de-venta#oportunidades-esencial": "procesos_de_venta",
};

// Roles: los bloques que explican algo que solo puede hacer un ADMIN —una
// pantalla de AdminRoute o una acción que el backend restringe con
// authorize("ADMIN")—. USER (automotora) y RECEPCION (clínica) no los ven. Un
// bloque que sirve para el trabajo de todos los días y tiene una frase "solo
// un administrador puede…" NO va acá, ni uno que explica qué hace el sistema
// (qué manda una automatización, cuándo deriva el agente) aunque se configure
// en una pantalla de administrador.
//
// Un registro por guía, porque el mismo `<slug>#<ancla>` no siempre es lo
// mismo: en una automotora los eventos de una automatización le explican al
// vendedor qué le llega al cliente; en una clínica, recepción no tiene QR en
// el menú. El de clínica vale para toda la guía que ve una clínica.
//
// Un ### con ancla dentro de un ## oculto se oculta con él.
// guia-roles.test.ts (frontend) verifica que cada ancla exista, que ninguna
// pantalla de todos los roles apunte con su "?" a un bloque de acá, y que cada
// pantalla de AdminRoute apunte a uno (o esté en su lista de excepciones).
export const SOLO_ADMIN_DE_ANCLA: ReadonlySet<string> = new Set<string>([
  "contactos-y-consultas#unir-contactos",
  "contactos-y-consultas#borrar-datos-personales",
  "contactos-y-consultas#nueva-empresa",
  "oportunidades-y-procesos-de-venta#crear-cotizacion",
  "oportunidades-y-procesos-de-venta#acciones-de-la-cotizacion",
  "oportunidades-y-procesos-de-venta#registrar-pago",
  "oportunidades-y-procesos-de-venta#permuta",
  "oportunidades-y-procesos-de-venta#entrega",
  "oportunidades-y-procesos-de-venta#crear-proceso-de-venta",
  "oportunidades-y-procesos-de-venta#agregar-etapa",
  "oportunidades-y-procesos-de-venta#editar-reordenar-eliminar-etapas",
  "stock#nueva-unidad",
  "stock#fotos",
  "stock#publicar",
  "actividades-y-agenda#actividades",
  "actividades-y-agenda#recursos",
  "actividades-y-agenda#horario-de-trabajo",
  "actividades-y-agenda#tipos-de-servicio",
  "cupones-y-qr#nuevo-qr",
  "agentes-de-ia#agentes",
  "agentes-de-ia#nuevo-agente",
  "agentes-de-ia#instrucciones",
  "agentes-de-ia#canales",
  "agentes-de-ia#reglas",
  "agentes-de-ia#instalar-en-un-sitio",
  "agentes-de-ia#probar",
  "agentes-de-ia#agente-interno",
  "base-de-conocimiento#entradas",
  "base-de-conocimiento#nueva-entrada",
  "base-de-conocimiento#subir-documento",
  "base-de-conocimiento#sincronizar-stock",
  "automatizaciones#reglas",
  "automatizaciones#nueva-regla",
  "automatizaciones#mensaje-de-whatsapp",
  "automatizaciones#aprobacion",
  "campos-personalizados#nuevo-campo",
  "campos-personalizados#tipos",
  "campos-personalizados#opciones",
  "campos-personalizados#editable-por-el-agente",
  "usuarios-y-permisos#usuarios",
  "usuarios-y-permisos#invitaciones",
  "usuarios-y-permisos#invitar",
  "organizacion-y-sucursales#organizacion",
  "organizacion-y-sucursales#sucursales",
  "organizacion-y-sucursales#nueva-sucursal",
  "organizacion-y-sucursales#horario",
  "organizacion-y-sucursales#google-calendar",
  "organizacion-y-sucursales#fuentes-de-ingesta",
  "organizacion-y-sucursales#nueva-fuente",
  "organizacion-y-sucursales#claves-de-ingesta",
  "organizacion-y-sucursales#eventos-de-ingesta",
  "organizacion-y-sucursales#importar-archivo",
  "servicios#configuracion",
  "servicios#eliminar-vehiculo",
]);

export const SOLO_ADMIN_DE_ANCLA_DE_CLINICA: ReadonlySet<string> = new Set<string>([
  "contactos-y-consultas#unir-contactos",
  "contactos-y-consultas#borrar-datos-personales",
  "actividades-y-agenda#profesionales",
  "actividades-y-agenda#recursos",
  "actividades-y-agenda#horario-de-trabajo",
  "actividades-y-agenda#archivar-profesional",
  "actividades-y-agenda#prestaciones",
  "actividades-y-agenda#tipos-de-servicio",
  "actividades-y-agenda#recordar-control",
  "actividades-y-agenda#actividades",
  // Recepción no tiene QR en el menú (MenuDeClinica).
  "cupones-y-qr#qr",
  "cupones-y-qr#nuevo-qr",
  "cupones-y-qr#enviar-qr",
  "cupones-y-qr#qr-de-resena",
  "agentes-de-ia#agentes",
  "agentes-de-ia#nuevo-agente",
  "agentes-de-ia#instrucciones",
  "agentes-de-ia#canales",
  "agentes-de-ia#acciones",
  "agentes-de-ia#reglas",
  "agentes-de-ia#anticipacion-minima",
  "agentes-de-ia#aviso-de-privacidad",
  "agentes-de-ia#instalar-en-un-sitio",
  "agentes-de-ia#probar",
  "agentes-de-ia#agente-interno",
  "base-de-conocimiento#entradas",
  "base-de-conocimiento#nueva-entrada",
  "base-de-conocimiento#subir-documento",
  "base-de-conocimiento#indicaciones-de-prestaciones",
  "automatizaciones#reglas",
  "automatizaciones#nueva-regla",
  "automatizaciones#eventos",
  "automatizaciones#acciones",
  "automatizaciones#retomar-la-consulta",
  "automatizaciones#activar-recordatorio",
  "automatizaciones#mensaje-de-whatsapp",
  "automatizaciones#aprobacion",
  "campos-personalizados#campos",
  "campos-personalizados#nuevo-campo",
  "campos-personalizados#tipos",
  "campos-personalizados#opciones",
  "campos-personalizados#editable-por-el-agente",
  "usuarios-y-permisos#usuarios",
  "usuarios-y-permisos#cambiar-rol",
  "usuarios-y-permisos#cambiar-sedes",
  "usuarios-y-permisos#invitaciones",
  "usuarios-y-permisos#invitar",
  "organizacion-y-sucursales#organizacion",
  "organizacion-y-sucursales#mensajes-de-salud",
  "organizacion-y-sucursales#sucursales",
  "organizacion-y-sucursales#nueva-sucursal",
  "organizacion-y-sucursales#horario",
  "organizacion-y-sucursales#google-calendar",
  "organizacion-y-sucursales#recordatorios",
  "organizacion-y-sucursales#turnos-por-chat",
]);

/** El registro de bloques de administrador de la guía que lee esa persona. */
export function soloAdminDe(esClinica: boolean): ReadonlySet<string> {
  return esClinica ? SOLO_ADMIN_DE_ANCLA_DE_CLINICA : SOLO_ADMIN_DE_ANCLA;
}

/** El texto que reemplaza a un bloque de administrador cuando se pide
 *  conAvisosDeAdmin. */
export const AVISO_DE_ADMIN = "lo hace un administrador.";

const ENCABEZADO_CUALQUIERA = /^(##|###) /;
const ANCLA_EXPLICITA = /\{#([a-z0-9-]+)\}\s*$/;
const SUFIJO_DE_ANCLA = /\s*\{#[a-z0-9-]+\}\s*$/;

type Motivo = "modulo" | "rol";

/** La sección sin los bloques que `oculta` marca. Si no oculta nada,
 *  devuelve la MISMA sección. Con `avisar`, un bloque oculto por rol deja su
 *  título con AVISO_DE_ADMIN (sin ancla: no se puede linkear). */
function filtrarBloques(
  seccion: Seccion,
  oculta: (ancla: string) => Motivo | null,
  avisar: boolean,
): Seccion {
  if (!seccion.encabezados.some((e) => oculta(e.ancla) !== null)) return seccion;

  // El nivel del bloque que se está ocultando (2 o 3), o null.
  let ocultandoDesde: number | null = null;
  const entra = (nivel: number, ancla: string | undefined): Motivo | null => {
    if (ocultandoDesde !== null && nivel <= ocultandoDesde) ocultandoDesde = null;
    if (ocultandoDesde !== null || ancla === undefined) return null;
    const motivo = oculta(ancla);
    if (motivo !== null) ocultandoDesde = nivel;
    return motivo;
  };

  const lineas: string[] = [];
  let enBloqueDeCodigo = false;
  for (const linea of seccion.markdown.split("\n")) {
    if (linea.startsWith("```")) enBloqueDeCodigo = !enBloqueDeCodigo;
    const encabezado = enBloqueDeCodigo ? null : ENCABEZADO_CUALQUIERA.exec(linea);
    const motivo = encabezado
      ? entra(encabezado[1].length, ANCLA_EXPLICITA.exec(linea)?.[1])
      : null;
    if (motivo === "rol" && avisar) {
      lineas.push(`${linea.replace(SUFIJO_DE_ANCLA, "")} — ${AVISO_DE_ADMIN}`, "");
    }
    if (ocultandoDesde === null) lineas.push(linea);
  }

  ocultandoDesde = null;
  const encabezados = seccion.encabezados.filter((e) => {
    entra(e.nivel, e.ancla);
    return ocultandoDesde === null;
  });
  return { ...seccion, markdown: lineas.join("\n"), encabezados };
}

/** La sección sin los bloques que no van con los módulos de la organización.
 *  Si no oculta nada, devuelve la MISMA sección. */
export function filtrarPorModulos(seccion: Seccion, tiene: (modulo: string) => boolean): Seccion {
  return filtrarBloques(
    seccion,
    (ancla) => (ocultaPorModulo(seccion.slug, ancla, tiene) ? "modulo" : null),
    false,
  );
}

function ocultaPorModulo(slug: string, ancla: string, tiene: (modulo: string) => boolean): boolean {
  const clave = `${slug}#${ancla}`;
  const sinElModulo = MODULO_DE_ANCLA[clave];
  const soloSinElModulo = SOLO_SIN_MODULO[clave];
  return (
    (sinElModulo !== undefined && !tiene(sinElModulo)) ||
    (soloSinElModulo !== undefined && tiene(soloSinElModulo))
  );
}

// ---------------------------------------------------------------------------
// Links. Nunca queda un link a algo que esa persona no puede abrir:
//
//   - a un bloque oculto: lleva a la sección, sin el ancla;
//   - a una sección que no ve: queda el texto, sin link;
//   - a una pantalla de AdminRoute (si no es ADMIN) o de PlatformAdminRoute (si
//     no es platform admin): queda el texto, sin link. Las listas son las
//     rutas de frontend/src/app/router.tsx; guia-roles.test.ts las compara con
//     el router real.
// ---------------------------------------------------------------------------

export const RUTAS_DE_ADMIN: readonly string[] = [
  "/taller/configuracion",
  "/users",
  "/invitations",
  "/invitations/new",
  "/sources",
  "/sources/new",
  "/sources/:id/edit",
  "/sources/:id/import",
  "/api-keys",
  "/ingestion-events",
  "/organization",
  "/whatsapp-template",
  "/whatsapp-template/:automationId",
  "/branches",
  "/branches/new",
  "/branches/:id/edit",
  "/agents",
  "/agents/new",
  "/agents/:id/edit",
  "/agents/:id/embed",
  "/agents/:id/playground",
  "/knowledge-base",
  "/knowledge-base/new",
  "/knowledge-base/:id/edit",
  "/automations",
  "/automations/new",
  "/automations/:id/edit",
  "/internal-agent/settings",
  "/resources",
  "/resources/new",
  "/resources/:id/edit",
  "/service-types",
  "/service-types/new",
  "/service-types/:id/edit",
  "/clinica/prestaciones",
  "/clinica/profesionales",
  "/contact-custom-fields",
  "/contact-custom-fields/new",
  "/contact-custom-fields/:id/edit",
  "/companies/new",
  "/companies/:id/edit",
  "/pipelines/new",
  "/pipelines/:id/edit",
  "/pipelines/:pipelineId/stages/new",
  "/pipelines/:pipelineId/stages/:stageId/edit",
  "/activities",
  "/vehicles/new",
  "/vehicles/:id/edit",
];

export const RUTAS_DE_PLATAFORMA: readonly string[] = [
  "/admin/organizations/new",
  "/admin/organizations",
  "/admin/agents/whatsapp-number",
  "/admin/organizations/whatsapp-business",
  "/admin/agents/facebook-page",
  "/admin/agents/model",
  "/admin/llm-usage",
  "/admin/imports",
];

function patronDeRuta(ruta: string): RegExp {
  const cuerpo = ruta
    .split("/")
    .map((parte) =>
      parte.startsWith(":") ? "[^/]+" : parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${cuerpo}$`);
}

/** true si el link (`/ruta`, sin query ni hash) es una pantalla de esa lista. */
export function esRutaDe(rutas: readonly string[], href: string): boolean {
  const camino = href.split(/[?#]/)[0];
  return rutas.some((ruta) => patronDeRuta(ruta).test(camino));
}

const LINK_INTERNO = /\[([^\]]+)\]\((\/[^)\s]*|#[a-z0-9-]+)\)/g;

function sinLinksANoVisibles(
  seccion: Seccion,
  slugsVisibles: ReadonlySet<string>,
  ocultas: ReadonlySet<string>,
  lector: Lector,
): Seccion {
  const markdown = seccion.markdown.replace(LINK_INTERNO, (link, texto: string, href: string) => {
    if (href.startsWith("#")) {
      const ancla = href.slice(1);
      return ocultas.has(`${seccion.slug}#${ancla}`) ? `[${texto}](/ayuda/${seccion.slug})` : link;
    }
    const ayuda = /^\/ayuda\/([a-z0-9-]+)(?:#([a-z0-9-]+))?$/.exec(href);
    if (ayuda) {
      const [, slug, ancla] = ayuda;
      if (!slugsVisibles.has(slug)) return texto;
      if (ancla !== undefined && ocultas.has(`${slug}#${ancla}`))
        return `[${texto}](/ayuda/${slug})`;
      return link;
    }
    if (!lector.esAdmin && esRutaDe(RUTAS_DE_ADMIN, href)) return texto;
    if (!lector.esPlatformAdmin && esRutaDe(RUTAS_DE_PLATAFORMA, href)) return texto;
    return link;
  });
  return markdown === seccion.markdown ? seccion : { ...seccion, markdown };
}

// ---------------------------------------------------------------------------
// La vista
// ---------------------------------------------------------------------------

/** Las secciones que ve esa persona: las de su rubro, "Plataforma" solo el
 *  platform admin, los bloques que van con los módulos de la organización y,
 *  si no es ADMIN, sin los de administrador. Una sección que se queda sin
 *  ningún ## no se muestra. Si no cambia nada, las MISMAS secciones. */
export function seccionesVisibles(
  guia: Guia,
  lector: Lector,
  opciones: OpcionesDeVista = {},
): Seccion[] {
  const avisar = opciones.conAvisosDeAdmin === true;
  const soloAdmin = soloAdminDe(lector.esClinica);
  const oculta = (slug: string, ancla: string): Motivo | null => {
    if (ocultaPorModulo(slug, ancla, lector.tiene)) return "modulo";
    if (!lector.esAdmin && soloAdmin.has(`${slug}#${ancla}`)) return "rol";
    return null;
  };

  const originales = seccionesDelRubro(
    guia,
    lector.esClinica,
    lector.tiene,
    lector.modulosActivables,
  ).filter((seccion) => !seccion.soloPlataforma || lector.esPlatformAdmin);
  const filtradas = originales.map((seccion) =>
    filtrarBloques(seccion, (ancla) => oculta(seccion.slug, ancla), avisar),
  );

  const ocultas = new Set<string>();
  filtradas.forEach((seccion, i) => {
    const visibles = new Set(seccion.encabezados.map((e) => e.ancla));
    for (const e of originales[i].encabezados) {
      if (!visibles.has(e.ancla)) ocultas.add(`${seccion.slug}#${e.ancla}`);
    }
  });
  // Sin ningún ## visible, la sección es solo su título: no se muestra. Con
  // avisos (el asistente) se queda, para que se sepa que existe.
  const conContenido = filtradas.filter(
    (seccion) => avisar || seccion.encabezados.some((e) => e.nivel === 2),
  );
  const slugsVisibles = new Set(conContenido.map((seccion) => seccion.slug));

  const sinCambios = ocultas.size === 0 && conContenido.length === filtradas.length;
  const hayLinksQueRevisar = !lector.esAdmin || !lector.esPlatformAdmin || !sinCambios;
  if (!hayLinksQueRevisar) return filtradas;
  return conContenido.map((seccion) =>
    sinLinksANoVisibles(seccion, slugsVisibles, ocultas, lector),
  );
}

// ---------------------------------------------------------------------------
// Buscador de títulos (pantalla Ayuda)
// ---------------------------------------------------------------------------

export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
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
