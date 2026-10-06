// ---------------------------------------------------------------------------
// Campos personalizados de contactos, v1 (B6, 06/10/2026): la validación de
// los VALORES contra las DEFINICIONES, pura y sin base.
//
// Las definiciones viven en contact_custom_field_definitions (una tabla por
// organización, hasta MAX_CAMPOS_POR_ORGANIZACION, las define un ADMIN); los
// valores, en la columna Contact.customFields que ya existía: un objeto
// { [key]: valor } con la `key` de cada definición. Cinco tipos:
//   TEXT     string de hasta MAX_LARGO_DE_TEXTO
//   NUMBER   número finito
//   DATE     "YYYY-MM-DD" (una fecha de calendario, sin hora ni zona)
//   BOOLEAN  true / false
//   SELECT   una de las opciones de la definición (texto exacto)
// `null` borra el valor. Una key que no es de ninguna definición, o un valor
// del tipo equivocado, es un error con el nombre del campo: lo lee tanto el
// 400 del endpoint como el modelo de la tool del agente.
// ---------------------------------------------------------------------------

export const MAX_CAMPOS_POR_ORGANIZACION = 30;
export const MAX_LARGO_DE_TEXTO = 500;
export const MAX_OPCIONES = 50;
export const MAX_LARGO_DE_OPCION = 100;
export const MAX_LARGO_DE_ETIQUETA = 100;

export const TIPOS_DE_CAMPO = ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"] as const;
export type TipoDeCampo = (typeof TIPOS_DE_CAMPO)[number];

export interface DefinicionDeCampo {
  key: string;
  label: string;
  type: TipoDeCampo;
  // Solo para SELECT; vacío en los demás.
  options: string[];
  // Si el agente de IA puede escribirlo (leerlos puede todos).
  agentEditable: boolean;
}

export type ValorDeCampo = string | number | boolean | null;

export type ResultadoDeValidacion =
  { ok: true; valor: ValorDeCampo } | { ok: false; error: string };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function esFechaDeCalendario(texto: string): boolean {
  if (!FECHA.test(texto)) return false;
  const [a, m, d] = texto.split("-").map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  return fecha.getUTCFullYear() === a && fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d;
}

// Un valor para una definición. null siempre vale (borra).
export function validarValorDeCampo(def: DefinicionDeCampo, valor: unknown): ResultadoDeValidacion {
  if (valor === null || valor === undefined) {
    return { ok: true, valor: null };
  }
  switch (def.type) {
    case "TEXT": {
      if (typeof valor !== "string") {
        return { ok: false, error: `«${def.label}» tiene que ser un texto` };
      }
      const texto = valor.trim();
      if (texto.length === 0) return { ok: true, valor: null };
      if (texto.length > MAX_LARGO_DE_TEXTO) {
        return {
          ok: false,
          error: `«${def.label}» no puede superar los ${String(MAX_LARGO_DE_TEXTO)} caracteres`,
        };
      }
      return { ok: true, valor: texto };
    }
    case "NUMBER": {
      if (typeof valor !== "number" || !Number.isFinite(valor)) {
        return { ok: false, error: `«${def.label}» tiene que ser un número` };
      }
      return { ok: true, valor };
    }
    case "DATE": {
      if (typeof valor !== "string" || !esFechaDeCalendario(valor.trim())) {
        return {
          ok: false,
          error: `«${def.label}» tiene que ser una fecha con formato AAAA-MM-DD`,
        };
      }
      return { ok: true, valor: valor.trim() };
    }
    case "BOOLEAN": {
      if (typeof valor !== "boolean") {
        return { ok: false, error: `«${def.label}» tiene que ser sí o no (true o false)` };
      }
      return { ok: true, valor };
    }
    case "SELECT": {
      if (typeof valor !== "string") {
        return { ok: false, error: `«${def.label}» tiene que ser una de sus opciones` };
      }
      const texto = valor.trim();
      if (texto.length === 0) return { ok: true, valor: null };
      if (!def.options.includes(texto)) {
        return {
          ok: false,
          error: `«${def.label}» tiene que ser una de estas opciones: ${def.options.join(", ")}`,
        };
      }
      return { ok: true, valor: texto };
    }
  }
}

export type ResultadoDeValores =
  { ok: true; valores: Record<string, ValorDeCampo> } | { ok: false; errores: string[] };

// Un objeto { key: valor } entero, contra las definiciones de la organización.
// `soloEditablesPorElAgente`: la tool del agente solo puede tocar las marcadas.
export function validarValoresDeCampos(
  definiciones: DefinicionDeCampo[],
  entrada: unknown,
  opciones: { soloEditablesPorElAgente?: boolean } = {},
): ResultadoDeValores {
  if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) {
    return {
      ok: false,
      errores: ["Los campos personalizados tienen que ser un objeto { campo: valor }"],
    };
  }
  const porKey = new Map(definiciones.map((d) => [d.key, d]));
  const valores: Record<string, ValorDeCampo> = {};
  const errores: string[] = [];
  for (const [key, valor] of Object.entries(entrada as Record<string, unknown>)) {
    const def = porKey.get(key);
    if (!def) {
      errores.push(`«${key}» no es un campo personalizado de esta organización`);
      continue;
    }
    if (opciones.soloEditablesPorElAgente && !def.agentEditable) {
      errores.push(`«${def.label}» no lo puede modificar el agente`);
      continue;
    }
    const resultado = validarValorDeCampo(def, valor);
    if (!resultado.ok) {
      errores.push(resultado.error);
      continue;
    }
    valores[key] = resultado.valor;
  }
  return errores.length > 0 ? { ok: false, errores } : { ok: true, valores };
}

// Los valores vigentes después de aplicar `cambios` sobre `actuales`: una key
// con null se saca, el resto se pisa. Solo quedan keys con definición.
export function aplicarCambiosDeCampos(
  definiciones: DefinicionDeCampo[],
  actuales: unknown,
  cambios: Record<string, ValorDeCampo>,
): Record<string, Exclude<ValorDeCampo, null>> {
  const conDefinicion = new Set(definiciones.map((d) => d.key));
  const base =
    actuales && typeof actuales === "object" && !Array.isArray(actuales)
      ? (actuales as Record<string, unknown>)
      : {};
  const resultado: Record<string, Exclude<ValorDeCampo, null>> = {};
  for (const [key, valor] of Object.entries(base)) {
    if (conDefinicion.has(key) && valor !== null && valor !== undefined) {
      resultado[key] = valor as Exclude<ValorDeCampo, null>;
    }
  }
  for (const [key, valor] of Object.entries(cambios)) {
    if (valor === null) {
      delete resultado[key];
    } else {
      resultado[key] = valor;
    }
  }
  return resultado;
}

// Los valores de `cambios` que de verdad cambian respecto de lo guardado. La
// ficha del contacto manda TODOS sus campos al guardar, también los que nadie
// tocó, y uno de esos puede haber dejado de validar sin que el contacto tenga
// la culpa: la opción de una lista que un ADMIN eliminó, o un campo que se
// borró. Antes ese valor viejo daba 400 y no dejaba guardar NADA del contacto.
// Lo que no cambia no se vuelve a validar: queda como estaba.
export function soloLosQueCambian(
  actuales: unknown,
  cambios: Record<string, unknown>,
): Record<string, unknown> {
  const guardados =
    actuales && typeof actuales === "object" && !Array.isArray(actuales)
      ? (actuales as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(cambios).filter(([key, valor]) => guardados[key] !== valor),
  );
}

// Cómo se compara una opción con otra para decidir si están repetidas: sin
// distinguir mayúsculas, acentos ni espacios de más. «Contado» y «contado»
// son la misma opción para quien elige de la lista. El frontend aplica la
// misma regla (features/contactCustomField/opciones.ts).
export function claveDeOpcion(opcion: string): string {
  return opcion.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

// Los mensajes de las opciones de una lista. El formulario del frontend valida
// lo mismo antes de mandar y muestra estos mismos textos (opciones.ts).
export const MENSAJE_LISTA_SIN_OPCIONES = "Un campo de lista necesita al menos una opción";
export const MENSAJE_DEMASIADAS_OPCIONES = `Una lista no puede tener más de ${String(MAX_OPCIONES)} opciones`;
export const MENSAJE_OPCION_MUY_LARGA = `Una opción no puede superar los ${String(MAX_LARGO_DE_OPCION)} caracteres`;

export function mensajeDeOpcionRepetida(opcion: string): string {
  return `La opción «${opcion}» está repetida (no se distinguen mayúsculas ni acentos)`;
}

export type ResultadoDeOpciones = { ok: true; opciones: string[] } | { ok: false; error: string };

// Las opciones de un SELECT listas para guardar: recortadas, sin vacías, entre
// 1 y MAX_OPCIONES, y ninguna repetida según claveDeOpcion. Una repetida es un
// error y no se descarta en silencio: «Contado» y «contado» juntas son casi
// siempre un error de tipeo que quien las carga quiere ver.
export function limpiarOpcionesDeLista(options: readonly string[]): ResultadoDeOpciones {
  const vistas = new Set<string>();
  const opciones: string[] = [];
  for (const opcion of options) {
    const texto = opcion.trim();
    if (texto.length === 0) continue;
    if (texto.length > MAX_LARGO_DE_OPCION) {
      return { ok: false, error: MENSAJE_OPCION_MUY_LARGA };
    }
    const clave = claveDeOpcion(texto);
    if (vistas.has(clave)) {
      return { ok: false, error: mensajeDeOpcionRepetida(texto) };
    }
    vistas.add(clave);
    opciones.push(texto);
  }
  if (opciones.length === 0) {
    return { ok: false, error: MENSAJE_LISTA_SIN_OPCIONES };
  }
  if (opciones.length > MAX_OPCIONES) {
    return { ok: false, error: MENSAJE_DEMASIADAS_OPCIONES };
  }
  return { ok: true, opciones };
}

export interface RenombreDeOpcion {
  from: string;
  to: string;
}

export type ResultadoDeRenombres =
  { ok: true; renombres: RenombreDeOpcion[] } | { ok: false; error: string };

// Los renombres de opciones que acompañan a un cambio de `options`, validados:
// cada `from` es una opción GUARDADA (y no se repite) y cada `to` una de las
// NUEVAS. Los que no cambian nada (from === to) se descartan. Con esto el
// service sabe qué valores mover en los contactos; sin esto, un renombre es
// indistinguible de borrar una opción y agregar otra.
export function validarRenombresDeOpciones(
  guardadas: readonly string[],
  nuevas: readonly string[],
  pedidos: readonly RenombreDeOpcion[],
): ResultadoDeRenombres {
  const renombres: RenombreDeOpcion[] = [];
  const yaRenombradas = new Set<string>();
  for (const pedido of pedidos) {
    const from = pedido.from.trim();
    const to = pedido.to.trim();
    if (!guardadas.includes(from)) {
      return { ok: false, error: `«${from}» no es una opción guardada de este campo` };
    }
    if (!nuevas.includes(to)) {
      return { ok: false, error: `«${to}» no está entre las opciones nuevas del campo` };
    }
    if (yaRenombradas.has(from)) {
      return { ok: false, error: `La opción «${from}» no se puede renombrar a dos textos` };
    }
    yaRenombradas.add(from);
    if (from !== to) {
      renombres.push({ from, to });
    }
  }
  return { ok: true, renombres };
}

// La `key` de una definición a partir de su etiqueta: minúsculas, sin
// acentos, guiones bajos. Es lo que el agente y el frontend usan para nombrar
// el campo; una vez creada no cambia aunque se renombre la etiqueta.
export function keyDesdeEtiqueta(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

// Una línea legible por campo, para el prompt del agente y para la ficha.
export function describirValor(def: DefinicionDeCampo, valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (def.type === "BOOLEAN") return valor === true ? "sí" : "no";
  return String(valor);
}
