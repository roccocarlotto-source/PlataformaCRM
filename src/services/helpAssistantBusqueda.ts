import type { Seccion } from "../compartido/guia/guia";

// ---------------------------------------------------------------------------
// La búsqueda del asistente "¿Cómo se hace?" sobre la guía que ve esa persona
// (decisión del 2026-10-20, después del eval: la guía entera de un ADMIN
// medía 82-93k tokens de Haiku 5.5 y se acercaba al límite de 100k, donde el
// prompt cuesta 5 veces más).
//
// En vez de la guía entera, el modelo recibe:
//   - el ÍNDICE de todos los temas que esa persona ve (títulos y anclas), para
//     que sepa qué existe aunque no le llegue el texto;
//   - el TEXTO de los bloques que importan: el de la pantalla en la que está y
//     los que mejor coinciden con la pregunta, hasta un presupuesto.
//
// Un bloque es un `##` con sus `###` (o la introducción de una sección, antes
// del primer `##`). El puntaje es BM25 sobre el título (que pesa más) y el
// texto, sin acentos, con un recorte simple de plurales y unos sinónimos de
// cómo pregunta la gente contra cómo escribe la guía. Funciones puras.
// ---------------------------------------------------------------------------

export interface Bloque {
  slug: string;
  tituloDeLaSeccion: string;
  /** El ancla del `##`, o null para la introducción de la sección. */
  ancla: string | null;
  titulo: string;
  texto: string;
}

// Lo que se manda de texto, en caracteres (~2,3 por token en Haiku 5.5:
// unos 26k tokens), además del índice.
export const PRESUPUESTO_DE_CARACTERES = 60_000;

const ENCABEZADO_2 = /^## (.+?)(?:\s*\{#([a-z0-9-]+)\})?\s*$/;

/** Los bloques de las secciones visibles, en orden. */
export function bloquesDe(secciones: Seccion[]): Bloque[] {
  const bloques: Bloque[] = [];
  for (const seccion of secciones) {
    let actual: Bloque = {
      slug: seccion.slug,
      tituloDeLaSeccion: seccion.titulo,
      ancla: null,
      titulo: seccion.titulo,
      texto: "",
    };
    let enCodigo = false;
    for (const linea of seccion.markdown.split("\n")) {
      if (linea.startsWith("```")) enCodigo = !enCodigo;
      const encabezado = enCodigo ? null : ENCABEZADO_2.exec(linea);
      if (encabezado) {
        if (actual.texto.trim()) bloques.push(actual);
        actual = {
          slug: seccion.slug,
          tituloDeLaSeccion: seccion.titulo,
          ancla: encabezado[2] ?? null,
          titulo: encabezado[1],
          texto: `${linea}\n`,
        };
        continue;
      }
      if (/^# /.test(linea)) continue;
      actual.texto += `${linea}\n`;
    }
    if (actual.texto.trim()) bloques.push(actual);
  }
  return bloques;
}

/** El índice: cada sección con sus `##` y `###`, con el ancla citable. Los
 *  bloques de administrador llegan como su aviso (sin ancla). */
export function indiceDe(secciones: Seccion[]): string {
  return secciones
    .map((seccion) => {
      const lineas = [`- ${seccion.titulo} (${seccion.slug})`];
      let enCodigo = false;
      for (const linea of seccion.markdown.split("\n")) {
        if (linea.startsWith("```")) enCodigo = !enCodigo;
        if (enCodigo) continue;
        const m = /^(##|###) (.+?)(?:\s*\{#([a-z0-9-]+)\})?\s*$/.exec(linea);
        if (!m) continue;
        const sangria = m[1] === "##" ? "  " : "    ";
        lineas.push(`${sangria}- ${m[2]}${m[3] ? ` (${seccion.slug}#${m[3]})` : ""}`);
      }
      return lineas.join("\n");
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Puntaje
// ---------------------------------------------------------------------------

const VACIAS = new Set(
  (
    "a al algo ante como con cual cuando de del desde donde el ella ellos en entre es esa ese esta este " +
    "hay la las le les lo los me mi mis muy no o para pero por que se si sin sobre su sus te tengo tiene " +
    "tu un una uno unos y ya yo hago hacer puedo quiero cómo como"
  ).split(" "),
);

// Cómo pregunta la gente → cómo lo escribe la guía. Se suman, no reemplazan.
const SINONIMOS: Readonly<Record<string, string[]>> = {
  juntar: ["unir", "duplicado"],
  combinar: ["unir"],
  repetido: ["duplicado", "unir"],
  borrar: ["eliminar"],
  sacar: ["eliminar", "quitar"],
  vendedor: ["usuario", "invitar"],
  empleado: ["usuario", "invitar"],
  sumar: ["invitar", "nuevo"],
  agregar: ["nuevo", "crear"],
  cargar: ["nuevo", "crear"],
  alta: ["nuevo", "crear"],
  baja: ["desactivar", "eliminar"],
  auto: ["unidad", "vehiculo"],
  coche: ["unidad", "vehiculo"],
  turno: ["reserva", "agenda"],
  cita: ["turno", "reserva"],
  vacacion: ["bloqueo"],
  ausencia: ["bloqueo"],
  doctor: ["profesional"],
  doctora: ["profesional"],
  medico: ["profesional"],
  presupuesto: ["cotizacion"],
  cobro: ["pago"],
  cliente: ["contacto"],
  paciente: ["contacto"],
  whatsapp: ["mensaje", "conversacion"],
  chat: ["conversacion"],
  mensaje: ["conversacion", "responder"],
  avisar: ["aviso", "mensaje"],
  listo: ["entregar", "aviso"],
  contrasena: ["contrasena", "recuperar"],
  clave: ["contrasena"],
  publicar: ["publicar", "sitio"],
  falto: ["no vino", "atendido"],
  vino: ["atendido", "no vino"],
};

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Un recorte de plurales y de algunas terminaciones, suficiente para que
// "oportunidades" encuentre "oportunidad" y "invitaciones", "invitar".
function raiz(palabra: string): string {
  let p = palabra;
  for (const sufijo of ["aciones", "acion", "iones", "ion", "es", "s"]) {
    if (p.length > sufijo.length + 3 && p.endsWith(sufijo)) {
      p = p.slice(0, -sufijo.length);
      break;
    }
  }
  for (const sufijo of ["ar", "er", "ir"]) {
    if (p.length > 5 && p.endsWith(sufijo)) return p.slice(0, -sufijo.length);
  }
  return p;
}

function terminos(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length > 1 && !VACIAS.has(p))
    .map(raiz);
}

function terminosDeLaConsulta(consulta: string): string[] {
  const palabras = normalizar(consulta)
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length > 1 && !VACIAS.has(p));
  const con = [...palabras];
  for (const palabra of palabras) {
    const singular = palabra.replace(/(es|s)$/, "");
    for (const sinonimo of SINONIMOS[palabra] ?? SINONIMOS[singular] ?? []) {
      con.push(...normalizar(sinonimo).split(" "));
    }
  }
  return [...new Set(con.filter((p) => !VACIAS.has(p)).map(raiz))];
}

const K1 = 1.2;
const B = 0.75;
const PESO_DEL_TITULO = 3;

/** El puntaje BM25 de cada bloque para la consulta. */
export function puntajes(bloques: Bloque[], consulta: string): number[] {
  const consultaT = terminosDeLaConsulta(consulta);
  const docs = bloques.map((b) => {
    const tf = new Map<string, number>();
    for (const t of terminos(b.texto)) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of terminos(`${b.titulo} ${b.tituloDeLaSeccion}`)) {
      tf.set(t, (tf.get(t) ?? 0) + PESO_DEL_TITULO);
    }
    const largo = [...tf.values()].reduce((a, n) => a + n, 0);
    return { tf, largo };
  });
  const promedio = docs.reduce((a, d) => a + d.largo, 0) / Math.max(docs.length, 1);
  const df = new Map<string, number>();
  for (const t of consultaT) df.set(t, docs.filter((d) => d.tf.has(t)).length);
  return docs.map((d) => {
    let s = 0;
    for (const t of consultaT) {
      const f = d.tf.get(t) ?? 0;
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      s += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.largo) / promedio));
    }
    return s;
  });
}

/** Los bloques que van con su texto: el de la pantalla (si está en la guía de
 *  esa persona) y después los de mejor puntaje, mientras entren en el
 *  presupuesto. Vuelven en el orden de la guía. */
export function elegirBloques(
  bloques: Bloque[],
  consulta: string,
  destinoDeLaPantalla: string | null,
  presupuesto = PRESUPUESTO_DE_CARACTERES,
): Bloque[] {
  const elegidos = new Set<number>();
  let usado = 0;
  const sumar = (i: number) => {
    if (elegidos.has(i) || usado + bloques[i].texto.length > presupuesto) return;
    elegidos.add(i);
    usado += bloques[i].texto.length;
  };

  if (destinoDeLaPantalla) {
    const [slug, ancla] = destinoDeLaPantalla.split("#");
    const i = bloques.findIndex((b) => b.slug === slug && b.ancla === ancla);
    if (i >= 0) sumar(i);
  }
  const s = puntajes(bloques, consulta);
  bloques
    .map((_, i) => i)
    .filter((i) => s[i] > 0)
    .sort((a, b) => s[b] - s[a])
    .forEach(sumar);
  return [...elegidos].sort((a, b) => a - b).map((i) => bloques[i]);
}

/** El texto de los bloques elegidos, agrupados por sección como en la guía. */
export function textoDeLosBloques(bloques: Bloque[]): string {
  const porSeccion = new Map<string, Bloque[]>();
  for (const b of bloques) porSeccion.set(b.slug, [...(porSeccion.get(b.slug) ?? []), b]);
  return [...porSeccion.entries()]
    .map(
      ([slug, de]) =>
        `<seccion slug="${slug}">\n# ${de[0].tituloDeLaSeccion}\n\n${de
          .map((b) => b.texto.trim())
          .join("\n\n")}\n</seccion>`,
    )
    .join("\n\n");
}
