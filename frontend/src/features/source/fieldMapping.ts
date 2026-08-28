import {
  CAMPOS_DE_CONTACTO,
  ETIQUETA_DE_CAMPO,
  MAX_COLUMNAS_MAPEADAS,
  MAX_LARGO_ENCABEZADO,
  type CampoDeContacto,
  type FieldMapping,
} from "./types";

// ---------------------------------------------------------------------------
// Conversión y validación del fieldMapping, SIN React.
//
// El backend persiste un MAPA PLANO (`{ "Nombre": "firstName" }`) pero un
// formulario necesita una LISTA ORDENADA de filas: un objeto no tiene orden
// estable ni admite una fila a medio completar, y las dos cosas hacen falta
// mientras alguien edita.
//
// Vive en su propio módulo, separado del componente, porque es la parte con
// reglas de verdad —duplicados, topes, cuándo es null— y así se prueba sin
// montar nada.
// ---------------------------------------------------------------------------

// `destino` vacío = fila recién agregada, todavía sin elegir. No se modela como
// `CampoDeContacto | undefined` porque el valor de un <select> es siempre un
// string, y "" es lo que representa la opción vacía.
export interface FieldMappingRow {
  encabezado: string;
  destino: CampoDeContacto | "";
}

export const FILA_VACIA: FieldMappingRow = { encabezado: "", destino: "" };

function esCampoDeContacto(valor: string): valor is CampoDeContacto {
  return (CAMPOS_DE_CONTACTO as readonly string[]).includes(valor);
}

// Mapa persistido -> filas del formulario.
//
// Se filtran los destinos que no reconocemos en vez de romper el formulario: la
// columna es JSONB y una escritura directa a la base (una migración de datos, un
// arreglo manual) puede dejar ahí algo que el endpoint jamás habría aceptado. La
// promoción ya revalida por su cuenta (traducirConMapeo en promotion.service.ts);
// acá lo que importa es que la pantalla siga siendo usable para corregirlo.
export function mapToRows(mapping: FieldMapping | null | undefined): FieldMappingRow[] {
  if (!mapping) return [];
  return Object.entries(mapping)
    .filter(([, destino]) => esCampoDeContacto(destino))
    .map(([encabezado, destino]) => ({ encabezado, destino }));
}

export type RowsToMappingResult =
  // `mapping: null` significa "no hay mapeo". Quien lo mande tiene que traducir
  // eso a `null` en un PATCH y a OMITIR el campo en un POST — ver types.ts.
  { ok: true; mapping: FieldMapping | null } | { ok: false; error: string };

function estaVacia(fila: FieldMappingRow): boolean {
  return fila.encabezado.trim() === "" && fila.destino === "";
}

// Filas del formulario -> mapa para el backend, o el error a mostrar.
//
// SE VALIDA ACÁ Y NO SE DEJA REBOTAR AL BACKEND porque los tres errores posibles
// son de forma, no de negocio: el backend los devolvería igual, pero recién
// después de un round-trip y con el texto de un mensaje de zod pensado para una
// API, no para la persona que está llenando el formulario.
export function rowsToMapping(filas: FieldMappingRow[]): RowsToMappingResult {
  // Una fila del todo vacía es una fila que alguien agregó y no usó. No es un
  // error: se descarta en silencio, igual que un input de texto vacío.
  const usadas = filas.filter((fila) => !estaVacia(fila));

  if (usadas.length === 0) {
    return { ok: true, mapping: null };
  }

  if (usadas.length > MAX_COLUMNAS_MAPEADAS) {
    return {
      ok: false,
      error: `El mapeo no puede tener más de ${MAX_COLUMNAS_MAPEADAS} columnas.`,
    };
  }

  const incompletaSinDestino = usadas.find((fila) => fila.destino === "");
  if (incompletaSinDestino) {
    return {
      ok: false,
      error: `Falta elegir el campo de destino de la columna "${incompletaSinDestino.encabezado.trim()}".`,
    };
  }

  const incompletaSinEncabezado = usadas.find((fila) => fila.encabezado.trim() === "");
  if (incompletaSinEncabezado) {
    return {
      ok: false,
      error: "Falta el nombre de la columna del archivo en una de las filas del mapeo.",
    };
  }

  const largoDeMas = usadas.find((fila) => fila.encabezado.trim().length > MAX_LARGO_ENCABEZADO);
  if (largoDeMas) {
    return {
      ok: false,
      error: `El nombre de una columna no puede superar los ${MAX_LARGO_ENCABEZADO} caracteres.`,
    };
  }

  // DOS COLUMNAS AL MISMO DESTINO SE RECHAZAN, mismo criterio que el backend: no
  // hay forma correcta de resolverlo, cuál gana dependería del orden de las
  // claves de un objeto JSON.
  const destinos = usadas.map((fila) => fila.destino as CampoDeContacto);
  const repetidos = [...new Set(destinos.filter((d, i) => destinos.indexOf(d) !== i))];
  if (repetidos.length > 0) {
    const nombres = repetidos.map((d) => ETIQUETA_DE_CAMPO[d]).join(", ");
    return {
      ok: false,
      error: `Dos columnas no pueden mapear al mismo campo: ${nombres}.`,
    };
  }

  // Encabezados repetidos: un objeto no puede tener la clave dos veces, así que
  // una de las dos filas desaparecería en silencio al construir el mapa. El
  // backend no puede detectarlo —le llega el objeto ya colapsado— así que esta
  // validación solo puede vivir acá.
  const encabezados = usadas.map((fila) => fila.encabezado.trim());
  const encabezadosRepetidos = [
    ...new Set(encabezados.filter((h, i) => encabezados.indexOf(h) !== i)),
  ];
  if (encabezadosRepetidos.length > 0) {
    return {
      ok: false,
      error: `Hay columnas del archivo repetidas en el mapeo: ${encabezadosRepetidos.join(", ")}.`,
    };
  }

  const mapping: FieldMapping = {};
  for (const fila of usadas) {
    mapping[fila.encabezado.trim()] = fila.destino as CampoDeContacto;
  }
  return { ok: true, mapping };
}

// ---------------------------------------------------------------------------
// SUGERENCIA DE DESTINO para un encabezado de archivo.
//
// ES UNA HEURÍSTICA, NO UNA PROMESA. Lo que devuelve se precarga en el editor
// como una fila más —editable, y visible antes de guardar— exactamente igual que
// si alguien la hubiera tipeado. Nada se aplica solo: el mapeo se persiste
// recién con el botón Guardar del formulario, como cualquier otro campo.
//
// La comparación es sobre el encabezado NORMALIZADO (minúsculas, sin tildes,
// espacios colapsados) contra una tabla fija de sinónimos. No hay fuzzy matching
// ni distancia de edición: un acierto parcial que se equivoca es peor que no
// sugerir nada, porque una fila mal sugerida que nadie revisa termina mapeando
// una columna al campo equivocado en silencio.
//
// SIN SUGERENCIA DEVUELVE "", que es exactamente el estado de una fila agregada
// a mano sin elegir destino todavía. No se inventa un destino "parecido" para no
// dejar ninguna fila vacía: una columna como "Observación" no tiene campo de
// destino razonable entre los cinco que la ingesta escribe, y forzarla a uno
// sería peor que dejarla para que la persona decida.
//
// La tabla se edita a mano cuando aparezca un caso real que no cubra. Incluye
// los nombres canónicos (firstname, lastname, email, phone, jobtitle) porque un
// archivo exportado por el propio sistema los trae así.
// ---------------------------------------------------------------------------
const SINONIMOS: Record<CampoDeContacto, readonly string[]> = {
  firstName: ["nombre", "nombres", "firstname"],
  lastName: ["apellido", "apellidos", "lastname"],
  email: ["email", "mail", "correo", "correo electronico"],
  phone: ["telefono", "celular", "phone"],
  jobTitle: ["puesto", "cargo", "rol", "jobtitle"],
};

// Minúsculas, sin tildes, recortado y con los espacios internos colapsados.
//
// NFD separa cada letra acentuada en letra + marca diacrítica, y el rango
// U+0300-U+036F borra esas marcas: "Teléfono" -> "telefono". Es la misma técnica
// que usa utils/slug.ts en el backend.
export function normalizarEncabezado(encabezado: string): string {
  return encabezado
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function sugerirDestino(encabezado: string): CampoDeContacto | "" {
  const normalizado = normalizarEncabezado(encabezado);
  if (normalizado === "") return "";

  for (const campo of CAMPOS_DE_CONTACTO) {
    if (SINONIMOS[campo].includes(normalizado)) {
      return campo;
    }
  }

  return "";
}

// Agrega una fila por cada encabezado del archivo que TODAVÍA NO ESTÁ en el
// mapeo, con su destino sugerido. Devuelve la lista nueva completa.
//
// ES UN MERGE, NUNCA UN REEMPLAZO: las filas que ya existen no se tocan, ni su
// encabezado ni su destino. Alguien que ya configuró "Mail" -> email a mano no
// puede perder ese trabajo por subir un archivo de muestra.
//
// LA COMPARACIÓN ES EXACTA, no normalizada, y es a propósito: el mapeo real que
// consume la promoción compara la clave del JSON contra el encabezado del
// archivo carácter por carácter (traducirConMapeo en promotion.service.ts), así
// que "Mail" y "mail" SON dos columnas distintas para el sistema. Deduplicar por
// la forma normalizada acá escondería una fila que después no matchearía nada.
export function agregarFilasSugeridas(
  filas: FieldMappingRow[],
  encabezados: readonly string[],
): FieldMappingRow[] {
  const yaPresentes = new Set(filas.map((fila) => fila.encabezado));

  const nuevas = encabezados
    .filter((encabezado) => !yaPresentes.has(encabezado))
    .map((encabezado) => ({ encabezado, destino: sugerirDestino(encabezado) }));

  return [...filas, ...nuevas];
}
