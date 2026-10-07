import { claveDeOpcion } from "./camposPersonalizados";
import type { ValorDeCelda } from "./spreadsheet";

// ---------------------------------------------------------------------------
// Intérpretes de valores del asistente de importación
// (docs/importacion-de-datos.md §5 y §8.1, paso 4 "Ajustes de formato").
//
// Puros, sin base: reciben la celda TAL COMO QUEDÓ EN STAGING (texto, número,
// booleano o null; una fecha de un XLSX ya llega como ISO) y los ajustes del
// lote, y devuelven el valor del destino o el motivo por el que no se pudo.
// El motivo nombra lo que se esperaba, porque es lo que el admin lee en la
// vista previa y en el CSV de fallidas.
//
// Una celda vacía (null o solo espacios) es SIEMPRE "sin dato" —{ ok: true,
// valor: null }—, nunca un error ni un "borrar": la regla de §5 de que una
// celda vacía no pisa nada la aplica quien llama, sobre este null.
// ---------------------------------------------------------------------------

export type Interpretado<T> = { ok: true; valor: T | null } | { ok: false; error: string };

function vacia(valor: ValorDeCelda): boolean {
  return valor === null || (typeof valor === "string" && valor.trim() === "");
}

function texto(valor: ValorDeCelda): string {
  return String(valor).trim();
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

export const FORMATOS_DE_FECHA = ["DD/MM/AAAA", "MM/DD/AAAA", "AAAA-MM-DD"] as const;
export type FormatoDeFecha = (typeof FORMATOS_DE_FECHA)[number];

// Una celda de fecha de un XLSX: normalizarCelda la deja como ISO 8601 en UTC
// ("2025-03-14T00:00:00.000Z"). Se toma el día tal cual: exceljs arma la fecha
// en UTC a partir del número de serie, así que la parte de fecha es la que se
// ve en la celda.
const ISO_DE_XLSX = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
// Separadores "/", "-" o "."; un horario después se ignora ("14/03/2025 10:30").
const DIA_MES_ANIO = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T].*)?$/;
const ANIO_MES_DIA = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[ T].*)?$/;

function fechaValida(a: number, m: number, d: number): string | null {
  if (a < 1900 || a > 2100) return null;
  const fecha = new Date(Date.UTC(a, m - 1, d));
  if (fecha.getUTCFullYear() !== a || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) {
    return null;
  }
  return `${String(a)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function leerFecha(t: string, formato: FormatoDeFecha): string | null {
  const iso = ISO_DE_XLSX.exec(t);
  if (iso) return fechaValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  if (formato === "AAAA-MM-DD") {
    const m = ANIO_MES_DIA.exec(t);
    return m ? fechaValida(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  }
  const m = DIA_MES_ANIO.exec(t);
  if (!m) return null;
  const [primero, segundo, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return formato === "DD/MM/AAAA"
    ? fechaValida(anio, segundo, primero)
    : fechaValida(anio, primero, segundo);
}

// "YYYY-MM-DD", un día del calendario sin hora ni zona: lo mismo que guarda un
// campo personalizado DATE y una columna @db.Date. Años de dos cifras no se
// aceptan: "03/04/25" no dice de qué siglo es.
export function interpretarFecha(
  valor: ValorDeCelda,
  formato: FormatoDeFecha,
): Interpretado<string> {
  if (vacia(valor)) return { ok: true, valor: null };
  const leida = leerFecha(texto(valor), formato);
  return leida
    ? { ok: true, valor: leida }
    : { ok: false, error: `«${texto(valor)}» no es una fecha válida con el formato ${formato}` };
}

// El formato que explica las muestras (las primeras filas no vacías de una
// columna): el primero de FORMATOS_DE_FECHA con el que se leen TODAS. Si todos
// los días son <= 12, DD/MM y MM/DD las leen igual de bien y gana DD/MM, que es
// el de la región. null si ninguno las lee todas: el admin elige.
export function sugerirFormatoDeFecha(muestras: readonly ValorDeCelda[]): FormatoDeFecha | null {
  const textos = muestras.filter((m) => !vacia(m)).map(texto);
  if (textos.length === 0) return null;
  return FORMATOS_DE_FECHA.find((f) => textos.every((t) => leerFecha(t, f) !== null)) ?? null;
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

export type SeparadorDecimal = "," | ".";

// Símbolos y códigos de moneda que se toleran pegados al número ("US$ 12.500",
// "$1.200,50", "15000 USD"). La moneda la decide la columna de moneda o el
// ajuste del lote, nunca este símbolo.
const MONEDA = /^(?:US\$|U\$S|USD|UYU|ARS|\$|€|EUR)\s*|\s*(?:US\$|U\$S|USD|UYU|ARS|\$|€|EUR)$/gi;
// Los separadores de miles, si están, en grupos de tres: es lo que impide que
// un "1.5" escrito con punto decimal se lea como 15 cuando el ajuste dice que
// el decimal es la coma. Ese caso falla y lo dice, en vez de multiplicar por
// diez en silencio.
const CON_DECIMAL_COMA = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;
const CON_DECIMAL_PUNTO = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

// Con separador decimal ",", el punto es de miles ("1.234,56"); con ".", la
// coma es de miles ("1,234.56"). Un número de un XLSX ya es número y pasa tal
// cual.
export function interpretarNumero(
  valor: ValorDeCelda,
  separadorDecimal: SeparadorDecimal,
): Interpretado<number> {
  if (vacia(valor)) return { ok: true, valor: null };
  if (typeof valor === "number") {
    return Number.isFinite(valor)
      ? { ok: true, valor }
      : { ok: false, error: "no es un número válido" };
  }
  const original = texto(valor);
  const t = original.replace(MONEDA, "").replace(/\s/g, "");
  const forma = separadorDecimal === "," ? CON_DECIMAL_COMA : CON_DECIMAL_PUNTO;
  if (!forma.test(t)) {
    return {
      ok: false,
      error: `«${original}» no es un número (separador decimal: «${separadorDecimal}»)`,
    };
  }
  const normalizado =
    separadorDecimal === "," ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  return { ok: true, valor: Number(normalizado) };
}

// Entero no negativo (kilómetros, año).
export function interpretarEntero(
  valor: ValorDeCelda,
  separadorDecimal: SeparadorDecimal,
): Interpretado<number> {
  const n = interpretarNumero(valor, separadorDecimal);
  if (!n.ok || n.valor === null) return n;
  if (!Number.isInteger(n.valor) || n.valor < 0) {
    return { ok: false, error: `«${texto(valor)}» no es un número entero` };
  }
  return n;
}

// ---------------------------------------------------------------------------
// Sí / no
// ---------------------------------------------------------------------------

export interface ValoresSiNo {
  si: readonly string[];
  no: readonly string[];
}

export const SI_NO_POR_DEFECTO: ValoresSiNo = {
  si: ["sí", "si", "s", "x", "1", "true", "yes", "verdadero"],
  no: ["no", "n", "0", "false", "falso"],
};

export function interpretarSiNo(valor: ValorDeCelda, valores: ValoresSiNo): Interpretado<boolean> {
  if (vacia(valor)) return { ok: true, valor: null };
  if (typeof valor === "boolean") return { ok: true, valor };
  const clave = claveDeOpcion(texto(valor));
  if (valores.si.some((v) => claveDeOpcion(v) === clave)) return { ok: true, valor: true };
  if (valores.no.some((v) => claveDeOpcion(v) === clave)) return { ok: true, valor: false };
  return {
    ok: false,
    error: `«${texto(valor)}» no es sí ni no (sí: ${valores.si.join(", ")}; no: ${valores.no.join(", ")})`,
  };
}

// ---------------------------------------------------------------------------
// Listas: opciones de un campo personalizado y valores de un enum
// ---------------------------------------------------------------------------

// Una de las opciones, comparando sin mayúsculas, tildes ni espacios de más
// (claveDeOpcion, la misma regla que usa la definición del campo para decidir
// si dos opciones están repetidas). Devuelve el texto EXACTO de la opción, no
// el de la celda.
export function interpretarOpcion(
  valor: ValorDeCelda,
  opciones: readonly string[],
): Interpretado<string> {
  if (vacia(valor)) return { ok: true, valor: null };
  const clave = claveDeOpcion(texto(valor));
  const opcion = opciones.find((o) => claveDeOpcion(o) === clave);
  return opcion
    ? { ok: true, valor: opcion }
    : { ok: false, error: `«${texto(valor)}» no es una de las opciones: ${opciones.join(", ")}` };
}

export const SEPARADORES_DE_OPCIONES = [";", ","] as const;
export type SeparadorDeOpciones = (typeof SEPARADORES_DE_OPCIONES)[number];

// MULTI_SELECT: la celda partida por el separador, cada parte como en
// interpretarOpcion, sin repetidas y en el orden de la celda.
export function interpretarOpciones(
  valor: ValorDeCelda,
  opciones: readonly string[],
  separador: SeparadorDeOpciones,
): Interpretado<string[]> {
  if (vacia(valor)) return { ok: true, valor: null };
  const elegidas: string[] = [];
  for (const parte of texto(valor).split(separador)) {
    if (parte.trim() === "") continue;
    const una = interpretarOpcion(parte, opciones);
    if (!una.ok) return una;
    if (una.valor !== null && !elegidas.includes(una.valor)) elegidas.push(una.valor);
  }
  return { ok: true, valor: elegidas.length === 0 ? null : elegidas };
}

// Un valor del origen traducido con el mapeo de valores del lote ("Cliente"
// -> "CUSTOMER", "Nafta" -> "GASOLINE"), comparando las claves como opciones.
// Si la celda ya es uno de los valores del destino, pasa sin mapeo.
export function mapearValor<T extends string>(
  valor: ValorDeCelda,
  mapeo: Readonly<Record<string, T>>,
  permitidos: readonly T[],
): Interpretado<T> {
  if (vacia(valor)) return { ok: true, valor: null };
  const t = texto(valor);
  const directo = permitidos.find((p) => p === t.toUpperCase());
  if (directo) return { ok: true, valor: directo };
  const clave = claveDeOpcion(t);
  const entrada = Object.entries(mapeo).find(([origen]) => claveDeOpcion(origen) === clave);
  if (entrada && permitidos.includes(entrada[1])) return { ok: true, valor: entrada[1] };
  return { ok: false, error: `«${t}» no tiene un valor asignado en los ajustes` };
}

// ---------------------------------------------------------------------------
// Nombre completo en una columna (decisión 11)
// ---------------------------------------------------------------------------

// Apellido de relleno cuando hay una sola palabra: lastName es NOT NULL.
export const APELLIDO_FALTANTE = "-";

export interface NombrePartido {
  firstName: string;
  lastName: string;
  advertencia?: string;
}

// La primera palabra es el nombre y el resto el apellido ("Ana María Pérez" ->
// "Ana" / "María Pérez"). Una sola palabra: apellido "-" y advertencia.
export function partirNombreCompleto(valor: ValorDeCelda): NombrePartido | null {
  if (vacia(valor)) return null;
  const palabras = texto(valor).split(/\s+/);
  const [firstName, ...resto] = palabras;
  if (resto.length === 0) {
    return {
      firstName,
      lastName: APELLIDO_FALTANTE,
      advertencia: `«${firstName}» tiene una sola palabra: el apellido quedó «${APELLIDO_FALTANTE}»`,
    };
  }
  return { firstName, lastName: resto.join(" ") };
}
