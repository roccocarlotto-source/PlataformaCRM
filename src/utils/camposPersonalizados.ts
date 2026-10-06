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
