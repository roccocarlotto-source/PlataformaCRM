import { createHash } from "node:crypto";
import type { LifecycleStage } from "@prisma/client";
import { normalizarTelefono, soloDigitos } from "../lib/telefono";
import {
  claveDeOpcion,
  validarValorDeCampo,
  type DefinicionDeCampo,
  type ValorDeCampo,
} from "./camposPersonalizados";
import {
  interpretarEntero,
  interpretarFecha,
  interpretarNumero,
  interpretarOpcion,
  interpretarOpciones,
  interpretarSiNo,
  mapearValor,
  partirNombreCompleto,
  SI_NO_POR_DEFECTO,
  type FormatoDeFecha,
  type Interpretado,
  type SeparadorDecimal,
  type SeparadorDeOpciones,
} from "./importacionValores";
import type { FilaCruda, ValorDeCelda } from "./spreadsheet";

// ---------------------------------------------------------------------------
// El núcleo PURO del asistente de importación para empresas y contactos
// (docs/importacion-de-datos.md §3, §5 y §8.2): de una fila cruda del staging
// y los ajustes del lote, al candidato; y del candidato y el registro que ya
// existe, al plan campo por campo.
//
// Lo usan IGUAL el análisis de la vista previa y la promoción: la vista previa
// es un pronóstico de lo que la promoción va a hacer, y si cada uno tuviera su
// propia traducción, el pronóstico mentiría. Lo que cambia entre los dos es de
// dónde sale el registro existente (el análisis lo trae en tanda, la
// promoción lo busca bajo el lock), no qué se hace con él.
// ---------------------------------------------------------------------------

export const LIFECYCLE_STAGES = ["LEAD", "MQL", "SQL", "CUSTOMER", "CHURNED"] as const;

// ---------------------------------------------------------------------------
// Destinos del mapeo
// ---------------------------------------------------------------------------

export const DESTINOS_DE_CONTACTO = [
  "externalId",
  "firstName",
  "lastName",
  "fullName",
  "email",
  "phone",
  "jobTitle",
  "notes",
  "lifecycleStage",
  "source",
  "ownerEmail",
  "vehicleRef",
  "companyName",
  "customerSince",
] as const;
export type DestinoDeContacto = (typeof DESTINOS_DE_CONTACTO)[number];

export const DESTINOS_DE_EMPRESA = [
  "externalId",
  "name",
  "domain",
  "industry",
  "phone",
  "city",
  "country",
  "ownerEmail",
] as const;
export type DestinoDeEmpresa = (typeof DESTINOS_DE_EMPRESA)[number];

// Un campo personalizado se mapea como "custom:<key>".
export const PREFIJO_CAMPO_PERSONALIZADO = "custom:";

export function claveDeCampoPersonalizado(destino: string): string | null {
  return destino.startsWith(PREFIJO_CAMPO_PERSONALIZADO)
    ? destino.slice(PREFIJO_CAMPO_PERSONALIZADO.length)
    : null;
}

export const DESTINOS_DE_HISTORIAL = [
  "externalId",
  "type",
  "contactExternalId",
  "contactEmail",
  "contactPhone",
  "subject",
  "body",
  "occurredAt",
  "dueDate",
  "done",
  "authorName",
  "assigneeEmail",
] as const;
export type DestinoDeHistorial = (typeof DESTINOS_DE_HISTORIAL)[number];

export const DESTINOS_DE_STOCK = [
  "externalId",
  "stockCode",
  "make",
  "model",
  "trim",
  "year",
  "mileage",
  "condition",
  "price",
  "currency",
  "priceUsd",
  "priceLocal",
  "cost",
  "minPrice",
  "status",
  "color",
  "fuelType",
  "transmission",
  "licensePlate",
  "vin",
  "photos",
] as const;
export type DestinoDeStock = (typeof DESTINOS_DE_STOCK)[number];

export type TipoImportable = "COMPANY" | "CONTACT" | "ACTIVITY" | "VEHICLE";

// Los estados que aparecen en un archivo de stock (§5.4, decisiones 12 y la
// del 06/10 sobre reservadas). La importación escribe solo AVAILABLE,
// IN_PREPARATION, IN_TRANSIT y UNAVAILABLE; RESERVED entra como UNAVAILABLE;
// SOLD y DELIVERED son "vendidas": se omiten salvo la casilla del lote, y
// entonces entran como SOLD.
export const ESTADOS_DE_STOCK = [
  "AVAILABLE",
  "IN_PREPARATION",
  "IN_TRANSIT",
  "UNAVAILABLE",
  "RESERVED",
  "SOLD",
  "DELIVERED",
] as const;
export type EstadoDeStock = (typeof ESTADOS_DE_STOCK)[number];
export const CONDICIONES = ["NEW", "USED"] as const;
export const COMBUSTIBLES = [
  "GASOLINE",
  "DIESEL",
  "HYBRID",
  "ELECTRIC",
  "CNG",
  "GASOLINE_CNG",
] as const;
export const TRANSMISIONES = ["MANUAL", "AUTOMATIC", "AUTOMATIC_SEQUENTIAL", "CVT"] as const;

// Los tipos de actividad que se importan (decisión del 06/10/2026: notas,
// llamadas y tareas).
export const TIPOS_DE_HISTORIAL = ["NOTE", "CALL", "TASK"] as const;
export type TipoDeHistorial = (typeof TIPOS_DE_HISTORIAL)[number];

// ---------------------------------------------------------------------------
// Ajustes del lote (paso 3 y 4 del asistente). Los valida
// schemas/importacion.schema.ts; acá está la forma ya validada.
// ---------------------------------------------------------------------------

export type Politica = "FILL_EMPTY" | "OVERWRITE" | "SKIP";

export interface AjustesDeImportacion {
  // encabezado del archivo -> destino. Una columna que no está, se ignora.
  mapeo: Record<string, string>;
  formato: {
    fecha: FormatoDeFecha;
    separadorDecimal: SeparadorDecimal;
    si: string[];
    no: string[];
    separadorDeOpciones: SeparadorDeOpciones;
  };
  // Valores del origen -> etapa ("Cliente" -> CUSTOMER).
  etapas: Record<string, LifecycleStage>;
  duplicados: Politica;
  // Empresas que no existen al importar contactos: se crean (decisión 10).
  crearEmpresas: boolean;
  // Solo en un lote de historial (§5.3).
  historial?: AjustesDeHistorial;
  // Solo en un lote de stock (§5.4).
  stock?: AjustesDeStock;
}

export interface AjustesDeStock {
  // La sucursal de las unidades nuevas (branchId es NOT NULL).
  branchId: string;
  // Quién firma los cambios en el historial de la ficha (VehicleChangeLog
  // exige un usuario de la organización; el platform admin no es miembro).
  responsableId: string;
  // Sin columna de condición, o con la celda vacía.
  condicionPorDefecto: (typeof CONDICIONES)[number];
  // La moneda de "precio", "costo" y "precio mínimo" sin columna de moneda.
  monedaPorDefecto: "USD" | "LOCAL";
  // Las vendidas en el origen se omiten salvo esta casilla (decisión 12).
  importarVendidas: boolean;
  estados: Record<string, EstadoDeStock>;
  condiciones: Record<string, (typeof CONDICIONES)[number]>;
  combustibles: Record<string, (typeof COMBUSTIBLES)[number]>;
  transmisiones: Record<string, (typeof TRANSMISIONES)[number]>;
}

export interface AjustesDeHistorial {
  // El usuario de la organización que figura como autor (decisión 5): el
  // platform admin no es miembro. Por defecto, el ADMIN más antiguo (lo
  // propone la pantalla).
  autorId: string;
  // El tipo cuando no hay columna de tipo, o la celda está vacía.
  tipoPorDefecto?: TipoDeHistorial;
  // Valores del origen -> tipo ("Llamada" -> CALL).
  tipos: Record<string, TipoDeHistorial>;
}

// ---------------------------------------------------------------------------
// Largos del modelo (schema.prisma), para que una fila que no entra falle con
// su motivo en vez de reventar el INSERT.
// ---------------------------------------------------------------------------

const LARGO = {
  firstName: 100,
  lastName: 100,
  email: 255,
  phone: 30,
  jobTitle: 100,
  source: 100,
  companyName: 255,
  domain: 255,
  industry: 100,
  city: 100,
  country: 100,
  externalId: 200,
} as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function vacia(valor: ValorDeCelda | undefined): boolean {
  return (
    valor === undefined || valor === null || (typeof valor === "string" && valor.trim() === "")
  );
}

function textoDe(valor: ValorDeCelda | undefined): string | undefined {
  return vacia(valor) ? undefined : String(valor).trim();
}

// La columna de la fila mapeada a un destino. undefined si no se mapeó.
function celda(
  fila: FilaCruda,
  ajustes: AjustesDeImportacion,
  destino: string,
): ValorDeCelda | undefined {
  for (const [encabezado, d] of Object.entries(ajustes.mapeo)) {
    if (d === destino && Object.hasOwn(fila, encabezado)) return fila[encabezado];
  }
  return undefined;
}

function nombreDeColumna(ajustes: AjustesDeImportacion, destino: string): string {
  return Object.entries(ajustes.mapeo).find(([, d]) => d === destino)?.[0] ?? destino;
}

class Acumulador {
  errores: string[] = [];
  advertencias: string[] = [];

  texto(
    fila: FilaCruda,
    ajustes: AjustesDeImportacion,
    destino: string,
    largo: number,
  ): string | undefined {
    const t = textoDe(celda(fila, ajustes, destino));
    if (t !== undefined && t.length > largo) {
      this.errores.push(
        `«${nombreDeColumna(ajustes, destino)}» supera los ${String(largo)} caracteres`,
      );
      return undefined;
    }
    return t;
  }

  interpretado<T>(r: Interpretado<T>, columna: string): T | undefined {
    if (!r.ok) {
      this.errores.push(`«${columna}»: ${r.error}`);
      return undefined;
    }
    return r.valor ?? undefined;
  }
}

export type Traduccion<T> =
  | { ok: true; candidato: T; advertencias: string[] }
  | { ok: false; errores: string[]; advertencias: string[] };

// ---------------------------------------------------------------------------
// Claves externas (§3.2). Con prefijo, para que pasar después de "email" a una
// columna de id no choque con los vínculos viejos.
// ---------------------------------------------------------------------------

export function claveDeId(id: string): string {
  return `id:${id}`;
}

export function claveDeEmail(email: string): string {
  return `email:${email.toLowerCase()}`;
}

export function claveDeTelefono(telefonoNormalizado: string): string {
  return `telefono:${soloDigitos(telefonoNormalizado)}`;
}

// El nombre de una empresa como clave: sin mayúsculas, tildes ni espacios de
// más (la misma regla que las opciones de una lista). "Ejemplo S.A." y
// "ejemplo s.a. " son la misma empresa; "Ejemplo SA" no.
export function claveDeNombreDeEmpresa(nombre: string): string {
  return `nombre:${claveDeOpcion(nombre)}`;
}

// ---------------------------------------------------------------------------
// Contactos
// ---------------------------------------------------------------------------

export interface CandidatoDeContacto {
  // La columna de id del origen, si se mapeó.
  externalId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  // Normalizado (lib/telefono.ts).
  phone?: string;
  jobTitle?: string;
  source?: string;
  lifecycleStage?: LifecycleStage;
  customerSince?: string;
  notas?: string;
  customFields: Record<string, Exclude<ValorDeCampo, null>>;
  ownerEmail?: string;
  vehicleRef?: string;
  companyName?: string;
}

function interpretarCampoPersonalizado(
  valor: ValorDeCelda | undefined,
  def: DefinicionDeCampo,
  ajustes: AjustesDeImportacion,
): Interpretado<Exclude<ValorDeCampo, null>> {
  if (vacia(valor)) return { ok: true, valor: null };
  const v = valor as ValorDeCelda;
  let interpretado: Interpretado<ValorDeCampo>;
  switch (def.type) {
    case "TEXT":
      interpretado = { ok: true, valor: String(v).trim() };
      break;
    case "NUMBER":
      interpretado = interpretarNumero(v, ajustes.formato.separadorDecimal);
      break;
    case "DATE":
      interpretado = interpretarFecha(v, ajustes.formato.fecha);
      break;
    case "BOOLEAN":
      interpretado = interpretarSiNo(v, { si: ajustes.formato.si, no: ajustes.formato.no });
      break;
    case "SELECT":
      interpretado = interpretarOpcion(v, def.options);
      break;
    case "MULTI_SELECT":
      interpretado = interpretarOpciones(v, def.options, ajustes.formato.separadorDeOpciones);
      break;
  }
  if (!interpretado.ok) return interpretado;
  // La misma validación que el endpoint y el agente: largo del texto, opción
  // vigente. Lo que pasa acá es lo que se puede guardar.
  const validado = validarValorDeCampo(def, interpretado.valor);
  if (!validado.ok) return { ok: false, error: validado.error };
  return { ok: true, valor: validado.valor };
}

export function traducirFilaDeContacto(
  fila: FilaCruda,
  ajustes: AjustesDeImportacion,
  definiciones: readonly DefinicionDeCampo[],
  codigoDePais: string | null,
): Traduccion<CandidatoDeContacto> {
  const a = new Acumulador();

  let firstName = a.texto(fila, ajustes, "firstName", LARGO.firstName);
  let lastName = a.texto(fila, ajustes, "lastName", LARGO.lastName);
  if (firstName === undefined && lastName === undefined) {
    const partido = partirNombreCompleto(celda(fila, ajustes, "fullName") ?? null);
    if (partido) {
      firstName = partido.firstName.slice(0, LARGO.firstName);
      lastName = partido.lastName.slice(0, LARGO.lastName);
      if (partido.advertencia) a.advertencias.push(partido.advertencia);
    }
  }
  if (firstName === undefined) a.errores.push("Falta el nombre");
  if (lastName === undefined) a.errores.push("Falta el apellido");

  const email = a.texto(fila, ajustes, "email", LARGO.email);
  if (email !== undefined && !EMAIL.test(email)) {
    a.errores.push(`«${nombreDeColumna(ajustes, "email")}»: «${email}» no es un email válido`);
  }

  // Un teléfono que no se puede normalizar no hace fallar la fila: el
  // contacto entra sin él y con advertencia, como en la ingesta (F5-a). Puede
  // ser lo único que tenga, pero no se inventa un país.
  const telefonoCrudo = a.texto(fila, ajustes, "phone", LARGO.phone);
  let phone: string | undefined;
  if (telefonoCrudo !== undefined) {
    const normalizado = normalizarTelefono(telefonoCrudo, codigoDePais);
    if (normalizado === null) {
      a.advertencias.push(
        `El teléfono «${telefonoCrudo}» no se pudo normalizar: el contacto queda sin teléfono`,
      );
    } else {
      phone = normalizado;
    }
  }

  const etapa = celda(fila, ajustes, "lifecycleStage");
  const lifecycleStage = a.interpretado(
    mapearValor(etapa ?? null, ajustes.etapas, LIFECYCLE_STAGES),
    nombreDeColumna(ajustes, "lifecycleStage"),
  );

  const customerSince = a.interpretado(
    interpretarFecha(celda(fila, ajustes, "customerSince") ?? null, ajustes.formato.fecha),
    nombreDeColumna(ajustes, "customerSince"),
  );

  const customFields: Record<string, Exclude<ValorDeCampo, null>> = {};
  for (const [encabezado, destino] of Object.entries(ajustes.mapeo)) {
    const key = claveDeCampoPersonalizado(destino);
    if (key === null) continue;
    const def = definiciones.find((d) => d.key === key);
    if (!def) {
      a.errores.push(`«${encabezado}» apunta a un campo personalizado que ya no existe`);
      continue;
    }
    const valor = a.interpretado(
      interpretarCampoPersonalizado(fila[encabezado], def, ajustes),
      encabezado,
    );
    if (valor !== undefined) customFields[key] = valor;
  }

  const candidato: CandidatoDeContacto = {
    externalId: a.texto(fila, ajustes, "externalId", LARGO.externalId),
    firstName: firstName ?? "",
    lastName: lastName ?? "",
    email,
    phone,
    jobTitle: a.texto(fila, ajustes, "jobTitle", LARGO.jobTitle),
    source: a.texto(fila, ajustes, "source", LARGO.source),
    lifecycleStage,
    customerSince,
    notas: textoDe(celda(fila, ajustes, "notes")),
    customFields,
    ownerEmail: textoDe(celda(fila, ajustes, "ownerEmail")),
    vehicleRef: textoDe(celda(fila, ajustes, "vehicleRef")),
    companyName: a.texto(fila, ajustes, "companyName", LARGO.companyName),
  };

  if (a.errores.length > 0) {
    return { ok: false, errores: a.errores, advertencias: a.advertencias };
  }
  return { ok: true, candidato, advertencias: a.advertencias };
}

// Las claves con las que se busca un contacto, en orden: el id del origen, el
// email, el teléfono. La primera es la que se guarda en el vínculo.
export function clavesDeContacto(c: CandidatoDeContacto): string[] {
  const claves: string[] = [];
  if (c.externalId !== undefined) claves.push(claveDeId(c.externalId));
  if (c.email !== undefined) claves.push(claveDeEmail(c.email));
  if (c.phone !== undefined) claves.push(claveDeTelefono(c.phone));
  return claves;
}

// ---------------------------------------------------------------------------
// Empresas
// ---------------------------------------------------------------------------

export interface CandidatoDeEmpresa {
  externalId?: string;
  name: string;
  domain?: string;
  industry?: string;
  phone?: string;
  city?: string;
  country?: string;
  ownerEmail?: string;
}

export function traducirFilaDeEmpresa(
  fila: FilaCruda,
  ajustes: AjustesDeImportacion,
): Traduccion<CandidatoDeEmpresa> {
  const a = new Acumulador();
  const name = a.texto(fila, ajustes, "name", LARGO.companyName);
  if (name === undefined) a.errores.push("Falta el nombre de la empresa");
  const candidato: CandidatoDeEmpresa = {
    externalId: a.texto(fila, ajustes, "externalId", LARGO.externalId),
    name: name ?? "",
    domain: a.texto(fila, ajustes, "domain", LARGO.domain),
    industry: a.texto(fila, ajustes, "industry", LARGO.industry),
    // El teléfono de una empresa es texto libre en el modelo: no se normaliza.
    phone: a.texto(fila, ajustes, "phone", LARGO.phone),
    city: a.texto(fila, ajustes, "city", LARGO.city),
    country: a.texto(fila, ajustes, "country", LARGO.country),
    ownerEmail: textoDe(celda(fila, ajustes, "ownerEmail")),
  };
  if (a.errores.length > 0) {
    return { ok: false, errores: a.errores, advertencias: a.advertencias };
  }
  return { ok: true, candidato, advertencias: a.advertencias };
}

export function clavesDeEmpresa(c: CandidatoDeEmpresa): string[] {
  const claves: string[] = [];
  if (c.externalId !== undefined) claves.push(claveDeId(c.externalId));
  claves.push(claveDeNombreDeEmpresa(c.name));
  return claves;
}

// ---------------------------------------------------------------------------
// Historial: notas, llamadas y tareas pasadas (§5.3)
// ---------------------------------------------------------------------------

export interface CandidatoDeActividad {
  externalId?: string;
  type: TipoDeHistorial;
  // A qué contacto va: el id del origen, el email o el teléfono normalizado.
  contactExternalId?: string;
  contactEmail?: string;
  contactPhone?: string;
  subject: string;
  body?: string;
  // "YYYY-MM-DD": cuándo pasó (decisión 23). Sin columna, la importación.
  occurredAt?: string;
  dueDate?: string;
  done?: boolean;
  authorName?: string;
  assigneeEmail?: string;
}

const ETIQUETA_DE_TIPO: Record<TipoDeHistorial, string> = {
  NOTE: "Nota",
  CALL: "Llamada",
  TASK: "Tarea",
};

function diaParaMostrar(fecha: string): string {
  const [a, m, d] = fecha.split("-");
  return `${d}/${m}/${a}`;
}

export function traducirFilaDeActividad(
  fila: FilaCruda,
  ajustes: AjustesDeImportacion,
  codigoDePais: string | null,
): Traduccion<CandidatoDeActividad> {
  const a = new Acumulador();
  const historial = ajustes.historial;
  if (!historial)
    return { ok: false, errores: ["El lote no tiene los ajustes del historial"], advertencias: [] };

  const celdaDeTipo = celda(fila, ajustes, "type");
  let type: TipoDeHistorial | undefined = a.interpretado(
    mapearValor(celdaDeTipo ?? null, historial.tipos, TIPOS_DE_HISTORIAL),
    nombreDeColumna(ajustes, "type"),
  );
  type ??= historial.tipoPorDefecto;
  if (type === undefined && a.errores.length === 0)
    a.errores.push("Falta el tipo (nota, llamada o tarea)");

  const contactExternalId = a.texto(fila, ajustes, "contactExternalId", LARGO.externalId);
  const contactEmail = a.texto(fila, ajustes, "contactEmail", LARGO.email);
  const telefono = a.texto(fila, ajustes, "contactPhone", LARGO.phone);
  const contactPhone =
    telefono === undefined ? undefined : (normalizarTelefono(telefono, codigoDePais) ?? undefined);
  if (telefono !== undefined && contactPhone === undefined) {
    a.advertencias.push(
      `El teléfono «${telefono}» no se pudo normalizar: no se usa para buscar el contacto`,
    );
  }
  if (contactExternalId === undefined && contactEmail === undefined && contactPhone === undefined) {
    a.errores.push("Falta a qué contacto va: el id del origen, el email o el teléfono");
  }

  const occurredAt = a.interpretado(
    interpretarFecha(celda(fila, ajustes, "occurredAt") ?? null, ajustes.formato.fecha),
    nombreDeColumna(ajustes, "occurredAt"),
  );
  const dueDate = a.interpretado(
    interpretarFecha(celda(fila, ajustes, "dueDate") ?? null, ajustes.formato.fecha),
    nombreDeColumna(ajustes, "dueDate"),
  );
  const done = a.interpretado(
    interpretarSiNo(celda(fila, ajustes, "done") ?? null, {
      si: ajustes.formato.si,
      no: ajustes.formato.no,
    }),
    nombreDeColumna(ajustes, "done"),
  );
  const body = textoDe(celda(fila, ajustes, "body"));
  let subject = a.texto(fila, ajustes, "subject", 255);
  if (subject === undefined && type !== undefined) {
    // Asunto obligatorio en el modelo (§5.3): sin columna, el tipo y la fecha.
    subject = occurredAt
      ? `${ETIQUETA_DE_TIPO[type]} del ${diaParaMostrar(occurredAt)}`
      : ETIQUETA_DE_TIPO[type];
  }

  if (a.errores.length > 0 || type === undefined || subject === undefined) {
    return { ok: false, errores: a.errores, advertencias: a.advertencias };
  }
  return {
    ok: true,
    candidato: {
      externalId: a.texto(fila, ajustes, "externalId", LARGO.externalId),
      type,
      contactExternalId,
      contactEmail,
      contactPhone,
      subject,
      body,
      occurredAt,
      dueDate,
      done,
      authorName: textoDe(celda(fila, ajustes, "authorName")),
      assigneeEmail: textoDe(celda(fila, ajustes, "assigneeEmail")),
    },
    advertencias: a.advertencias,
  };
}

// La identidad de una actividad: el id del origen o, sin él, un hash de lo
// que la define (a qué contacto, de qué tipo, cuándo, qué dice). Así volver a
// subir el archivo no la duplica (§3.2).
export function claveDeActividad(c: CandidatoDeActividad): string {
  if (c.externalId !== undefined) return claveDeId(c.externalId);
  const huella = JSON.stringify([
    c.contactExternalId ?? null,
    c.contactEmail?.toLowerCase() ?? null,
    c.contactPhone ? soloDigitos(c.contactPhone) : null,
    c.type,
    c.occurredAt ?? null,
    c.subject,
    c.body ?? null,
  ]);
  return `hash:${createHash("sha256").update(huella).digest("hex")}`;
}

// El texto de la actividad: el del archivo y, si el origen trae autor, su
// nombre al final (decisión 5).
export function cuerpoDeActividad(c: CandidatoDeActividad): string | null {
  const autor = c.authorName ? `Autor original: ${c.authorName}` : null;
  const partes = [c.body, autor].filter((p): p is string => p !== undefined && p !== null);
  return partes.length > 0 ? partes.join("\n\n") : null;
}

// ---------------------------------------------------------------------------
// Stock de vehículos (§5.4)
// ---------------------------------------------------------------------------

export type Moneda = "USD" | "LOCAL";
export interface Monto {
  monto: number;
  moneda: Moneda;
}

export interface CandidatoDeVehiculo {
  externalId?: string;
  stockCode?: string;
  make: string;
  model: string;
  trim?: string;
  year: number;
  mileage?: number;
  condition: (typeof CONDICIONES)[number];
  priceListUsd?: number;
  priceListLocal?: number;
  // En la moneda de la fila: la promoción los pasa a USD con la cotización.
  costo?: Monto;
  minimo?: Monto;
  // El estado que se escribe (ya traducido), o undefined si no vino.
  status?: "AVAILABLE" | "IN_PREPARATION" | "IN_TRANSIT" | "UNAVAILABLE" | "SOLD";
  vendidaEnOrigen: boolean;
  exteriorColor?: string;
  fuelType?: (typeof COMBUSTIBLES)[number];
  transmission?: (typeof TRANSMISIONES)[number];
  licensePlate?: string;
  vin?: string;
  // Los links de las fotos, tal como vienen en la celda (los separa y encola
  // importacionFotos.service.ts).
  fotos?: string;
}

// Las monedas que se reconocen en una celda: USD, o la local de la
// organización (su código, "$" o "pesos").
const USD = new Set(["usd", "us$", "u$s", "u$d", "dolar", "dolares", "dólar", "dólares"]);

export function interpretarMoneda(
  valor: ValorDeCelda | undefined,
  porDefecto: Moneda,
  codigoLocal: string | null,
): Interpretado<Moneda> {
  if (vacia(valor)) return { ok: true, valor: porDefecto };
  const t = claveDeOpcion(String(valor));
  if (USD.has(t)) return { ok: true, valor: "USD" };
  if (
    t === "$" ||
    t === "pesos" ||
    t === "local" ||
    (codigoLocal && t === codigoLocal.toLowerCase())
  ) {
    return { ok: true, valor: "LOCAL" };
  }
  return {
    ok: false,
    error: `«${String(valor)}» no es USD ni la moneda local${codigoLocal ? ` (${codigoLocal})` : ""}`,
  };
}

// Un monto local a dólares con la cotización USD -> local, redondeado al
// centavo.
export function aDolares(montoLocal: number, cotizacion: number): number {
  return Math.round((montoLocal / cotizacion) * 100) / 100;
}

export function normalizarPatente(patente: string): string {
  return patente.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function traducirFilaDeVehiculo(
  fila: FilaCruda,
  ajustes: AjustesDeImportacion,
  codigoLocal: string | null,
): Traduccion<CandidatoDeVehiculo> {
  const a = new Acumulador();
  const stock = ajustes.stock;
  if (!stock)
    return { ok: false, errores: ["El lote no tiene los ajustes del stock"], advertencias: [] };
  const decimal = ajustes.formato.separadorDecimal;

  const make = a.texto(fila, ajustes, "make", 100);
  const model = a.texto(fila, ajustes, "model", 100);
  if (make === undefined) a.errores.push("Falta la marca");
  if (model === undefined) a.errores.push("Falta el modelo");
  const year = a.interpretado(
    interpretarEntero(celda(fila, ajustes, "year") ?? null, decimal),
    nombreDeColumna(ajustes, "year"),
  );
  if (year === undefined) {
    if (!a.errores.some((e) => e.includes(nombreDeColumna(ajustes, "year"))))
      a.errores.push("Falta el año");
  } else if (year < 1900 || year > 2100) {
    a.errores.push(`El año ${String(year)} no es válido`);
  }
  const mileage = a.interpretado(
    interpretarEntero(celda(fila, ajustes, "mileage") ?? null, decimal),
    nombreDeColumna(ajustes, "mileage"),
  );
  const condition =
    a.interpretado(
      mapearValor(celda(fila, ajustes, "condition") ?? null, stock.condiciones, CONDICIONES),
      nombreDeColumna(ajustes, "condition"),
    ) ?? stock.condicionPorDefecto;

  const moneda =
    a.interpretado(
      interpretarMoneda(celda(fila, ajustes, "currency"), stock.monedaPorDefecto, codigoLocal),
      nombreDeColumna(ajustes, "currency"),
    ) ?? stock.monedaPorDefecto;
  const monto = (destino: string) =>
    a.interpretado(
      interpretarNumero(celda(fila, ajustes, destino) ?? null, decimal),
      nombreDeColumna(ajustes, destino),
    );
  const precio = monto("price");
  let priceListUsd = monto("priceUsd");
  let priceListLocal = monto("priceLocal");
  if (precio !== undefined) {
    if (moneda === "USD") priceListUsd ??= precio;
    else priceListLocal ??= precio;
  }
  const costo = monto("cost");
  const minimo = monto("minPrice");
  for (const [nombre, v] of [
    ["precio", precio],
    ["costo", costo],
    ["precio mínimo", minimo],
  ] as const) {
    if (v !== undefined && v < 0) a.errores.push(`El ${nombre} no puede ser negativo`);
  }

  // Estado.
  const crudo = a.interpretado(
    mapearValor(celda(fila, ajustes, "status") ?? null, stock.estados, ESTADOS_DE_STOCK),
    nombreDeColumna(ajustes, "status"),
  );
  let status: CandidatoDeVehiculo["status"];
  let vendidaEnOrigen = false;
  if (crudo === "SOLD" || crudo === "DELIVERED") {
    vendidaEnOrigen = true;
    status = "SOLD";
  } else if (crudo === "RESERVED") {
    status = "UNAVAILABLE";
    a.advertencias.push(
      "Reservada en el origen: entra como «No disponible» hasta que se reserve en el CRM",
    );
  } else {
    status = crudo;
  }

  const licensePlate = a.texto(fila, ajustes, "licensePlate", 20);
  const vin = a.texto(fila, ajustes, "vin", 30);

  const candidato: CandidatoDeVehiculo = {
    externalId: a.texto(fila, ajustes, "externalId", LARGO.externalId),
    stockCode: a.texto(fila, ajustes, "stockCode", LARGO.externalId),
    make: make ?? "",
    model: model ?? "",
    trim: a.texto(fila, ajustes, "trim", 100),
    year: year ?? 0,
    mileage,
    condition,
    priceListUsd,
    priceListLocal,
    costo: costo === undefined ? undefined : { monto: costo, moneda },
    minimo: minimo === undefined ? undefined : { monto: minimo, moneda },
    status,
    vendidaEnOrigen,
    exteriorColor: a.texto(fila, ajustes, "color", 50),
    fuelType: a.interpretado(
      mapearValor(celda(fila, ajustes, "fuelType") ?? null, stock.combustibles, COMBUSTIBLES),
      nombreDeColumna(ajustes, "fuelType"),
    ),
    transmission: a.interpretado(
      mapearValor(celda(fila, ajustes, "transmission") ?? null, stock.transmisiones, TRANSMISIONES),
      nombreDeColumna(ajustes, "transmission"),
    ),
    licensePlate: licensePlate?.toUpperCase(),
    vin: vin?.toUpperCase(),
    fotos: textoDe(celda(fila, ajustes, "photos")),
  };
  if (a.errores.length > 0) return { ok: false, errores: a.errores, advertencias: a.advertencias };
  return { ok: true, candidato, advertencias: a.advertencias };
}

// Las claves de un vehículo (§3.2): el id del origen, el código de stock del
// origen, la patente, el VIN. Los vínculos de "codigo:" son los que busca el
// vehículo de interés de un contacto (importacionResolutor.ts).
export function clavesDeVehiculo(c: CandidatoDeVehiculo): string[] {
  const claves: string[] = [];
  if (c.externalId !== undefined) claves.push(claveDeId(c.externalId));
  if (c.stockCode !== undefined) claves.push(`codigo:${c.stockCode}`);
  if (c.licensePlate !== undefined) claves.push(`patente:${normalizarPatente(c.licensePlate)}`);
  if (c.vin !== undefined) claves.push(`vin:${c.vin.toUpperCase()}`);
  return claves;
}

// Lo que el plan necesita de la unidad existente. Los montos, en número.
export interface VehiculoExistente {
  id: string;
  make: string;
  model: string;
  trim: string | null;
  year: number;
  mileage: number | null;
  condition: string;
  priceListUsd: number | null;
  priceListLocal: number | null;
  acquisitionCostUsd: number | null;
  minAcceptablePriceUsd: number | null;
  status: string;
  exteriorColor: string | null;
  fuelType: string | null;
  transmission: string | null;
  licensePlate: string | null;
  vin: string | null;
  // Una oportunidad la retiene (reservada o vendida por el CRM).
  retenida: boolean;
}

export const MOTIVO_ESTADO_DEL_CRM =
  "el estado lo maneja el CRM (reservada, vendida o retenida por una oportunidad): no se pisa";

// Montos ya en USD (los convierte quien llama, con la cotización).
export function planearVehiculo(
  c: CandidatoDeVehiculo,
  existente: VehiculoExistente,
  montosUsd: { costo?: number; minimo?: number },
  identificadoPor: "vinculo" | "patente" | "vin",
): CambioPlaneado[] {
  const estadoDelCrm =
    existente.retenida || ["RESERVED", "SOLD", "DELIVERED"].includes(existente.status);
  const cambios: (CambioPlaneado | null)[] = [
    comparar("make", existente.make, c.make),
    comparar("model", existente.model, c.model),
    comparar("trim", existente.trim, c.trim),
    comparar("year", existente.year, c.year),
    comparar("mileage", existente.mileage, c.mileage),
    comparar("condition", existente.condition, c.condition),
    comparar("priceListUsd", existente.priceListUsd, c.priceListUsd),
    comparar("priceListLocal", existente.priceListLocal, c.priceListLocal),
    comparar("acquisitionCostUsd", existente.acquisitionCostUsd, montosUsd.costo),
    comparar("minAcceptablePriceUsd", existente.minAcceptablePriceUsd, montosUsd.minimo),
    comparar(
      "status",
      existente.status,
      c.status,
      estadoDelCrm ? { bloqueado: MOTIVO_ESTADO_DEL_CRM } : {},
    ),
    comparar("exteriorColor", existente.exteriorColor, c.exteriorColor),
    comparar("fuelType", existente.fuelType, c.fuelType),
    comparar("transmission", existente.transmission, c.transmission),
    comparar("licensePlate", existente.licensePlate, c.licensePlate, {
      igual: (x, y) => normalizarPatente(String(x)) === normalizarPatente(String(y)),
      ...(identificadoPor === "patente"
        ? { bloqueado: "la patente identifica a la unidad: no se pisa" }
        : {}),
    }),
    comparar("vin", existente.vin, c.vin, {
      igual: (x, y) => String(x).toUpperCase() === String(y).toUpperCase(),
      ...(identificadoPor === "vin"
        ? { bloqueado: "el VIN identifica a la unidad: no se pisa" }
        : {}),
    }),
  ];
  return cambios.filter((x): x is CambioPlaneado => x !== null);
}

// ---------------------------------------------------------------------------
// EL PLAN, campo por campo (§8.2)
//
//   completar          el CRM no tiene valor: se escribe (con FILL_EMPTY y con
//                      OVERWRITE)
//   agregar            notas: se agregan al final si no están ya
//   difiere            los dos tienen valor y son distintos: con FILL_EMPTY se
//                      conserva el del CRM (y queda anotado); con OVERWRITE se
//                      pisa, guardando el antes y el después
//   difiere_bloqueado  distintos, pero no se pisa NUNCA: el email y el
//                      teléfono que identifican al contacto, y la etapa que
//                      retrocedería (decisión 4)
//   igual              mismo valor, nada que hacer
//
// Con SKIP, un registro existente no se toca, sea cual sea el plan.
// ---------------------------------------------------------------------------

export type AccionDeCampo = "completar" | "agregar" | "difiere" | "difiere_bloqueado" | "igual";

export interface CambioPlaneado {
  campo: string;
  actual: unknown;
  entrante: unknown;
  accion: AccionDeCampo;
  motivo?: string;
}

// SKIP: la fila no se importa a propósito (una unidad vendida en el origen,
// sin la casilla de importar vendidas), no por un error.
export type TipoDePlan = "CREATE" | "UPDATE" | "CONFLICT" | "UNCHANGED" | "SKIP" | "FAIL";

export function tipoDePlan(cambios: readonly CambioPlaneado[]): TipoDePlan {
  if (cambios.some((c) => c.accion === "difiere" || c.accion === "difiere_bloqueado")) {
    return "CONFLICT";
  }
  if (cambios.some((c) => c.accion === "completar" || c.accion === "agregar")) return "UPDATE";
  return "UNCHANGED";
}

function sinValor(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function iguales(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

function comparar(
  campo: string,
  actual: unknown,
  entrante: unknown,
  opciones: { igual?: (a: unknown, b: unknown) => boolean; bloqueado?: string } = {},
): CambioPlaneado | null {
  if (sinValor(entrante)) return null;
  if (sinValor(actual)) return { campo, actual: null, entrante, accion: "completar" };
  if ((opciones.igual ?? iguales)(actual, entrante)) {
    return { campo, actual, entrante, accion: "igual" };
  }
  return opciones.bloqueado !== undefined
    ? { campo, actual, entrante, accion: "difiere_bloqueado", motivo: opciones.bloqueado }
    : { campo, actual, entrante, accion: "difiere" };
}

// LA ETAPA SOLO AVANZA (decisión 4) en un contacto que ya existe, con este
// orden: LEAD < MQL < SQL < CUSTOMER. CHURNED NO SIGUE EL ORDEN DEL ENUM
// (decisión 24, P2 de docs/importacion-de-datos.md §13):
//   - solo se pasa a CHURNED desde CUSTOMER (se perdió un cliente);
//   - de CHURNED se puede volver a CUSTOMER (volvió a comprar);
//   - cualquier otro cambio hacia o desde CHURNED se omite y queda anotado.
// En un contacto NUEVO no se compara nada: se toma el valor del archivo,
// CHURNED incluido (lo resuelve la promoción, no esta función).
const ORDEN_DE_ETAPA: Record<Exclude<LifecycleStage, "CHURNED">, number> = {
  LEAD: 0,
  MQL: 1,
  SQL: 2,
  CUSTOMER: 3,
};

export const MOTIVO_CHURNED =
  "a la etapa «Perdido» (CHURNED) solo se pasa desde Cliente, y desde ahí solo se vuelve a Cliente: el cambio se omitió";

export function compararEtapa(
  actual: LifecycleStage | null,
  entrante: LifecycleStage | undefined,
): CambioPlaneado | null {
  if (entrante === undefined) return null;
  if (actual === entrante) return { campo: "lifecycleStage", actual, entrante, accion: "igual" };
  if (actual === null) return { campo: "lifecycleStage", actual, entrante, accion: "completar" };
  if (entrante === "CHURNED" || actual === "CHURNED") {
    const permitido =
      (actual === "CUSTOMER" && entrante === "CHURNED") ||
      (actual === "CHURNED" && entrante === "CUSTOMER");
    return permitido
      ? { campo: "lifecycleStage", actual, entrante, accion: "difiere" }
      : {
          campo: "lifecycleStage",
          actual,
          entrante,
          accion: "difiere_bloqueado",
          motivo: MOTIVO_CHURNED,
        };
  }
  return ORDEN_DE_ETAPA[entrante] > ORDEN_DE_ETAPA[actual]
    ? { campo: "lifecycleStage", actual, entrante, accion: "difiere" }
    : {
        campo: "lifecycleStage",
        actual,
        entrante,
        accion: "difiere_bloqueado",
        motivo: "la etapa no retrocede",
      };
}

// Lo que el plan necesita del contacto existente.
export interface ContactoExistente {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  source: string | null;
  lifecycleStage: LifecycleStage;
  customerSince: string | null;
  leadNotes: string | null;
  customFields: Record<string, unknown>;
  ownerId: string | null;
  companyId: string | null;
  vehicleOfInterestId: string | null;
}

// Las referencias ya resueltas (vendedor por email, empresa por nombre,
// vehículo por código o patente): ids, o null si no se encontraron.
export interface ReferenciasResueltas {
  ownerId?: string | null;
  companyId?: string | null;
  vehicleOfInterestId?: string | null;
}

const MOTIVO_IDENTIDAD = "el email y el teléfono que ya identifican al contacto no se pisan";

export function planearContacto(
  c: CandidatoDeContacto,
  existente: ContactoExistente,
  refs: ReferenciasResueltas,
): CambioPlaneado[] {
  const cambios: (CambioPlaneado | null)[] = [
    comparar("firstName", existente.firstName, c.firstName),
    comparar("lastName", existente.lastName, c.lastName),
    comparar("email", existente.email, c.email, {
      igual: (a, b) => String(a).toLowerCase() === String(b).toLowerCase(),
      bloqueado: MOTIVO_IDENTIDAD,
    }),
    comparar("phone", existente.phone, c.phone, {
      igual: (a, b) => soloDigitos(String(a)) === soloDigitos(String(b)),
      bloqueado: MOTIVO_IDENTIDAD,
    }),
    comparar("jobTitle", existente.jobTitle, c.jobTitle),
    comparar("source", existente.source, c.source),
    compararEtapa(existente.lifecycleStage, c.lifecycleStage),
    comparar("customerSince", existente.customerSince, c.customerSince),
    comparar("ownerId", existente.ownerId, refs.ownerId ?? undefined),
    comparar("companyId", existente.companyId, refs.companyId ?? undefined),
    comparar(
      "vehicleOfInterestId",
      existente.vehicleOfInterestId,
      refs.vehicleOfInterestId ?? undefined,
    ),
  ];
  for (const [key, valor] of Object.entries(c.customFields)) {
    cambios.push(comparar(`custom:${key}`, existente.customFields[key], valor));
  }
  if (c.notas !== undefined) {
    const yaEsta = (existente.leadNotes ?? "").includes(c.notas);
    cambios.push({
      campo: "notes",
      actual: null,
      entrante: c.notas,
      accion: yaEsta ? "igual" : "agregar",
    });
  }
  return cambios.filter((x): x is CambioPlaneado => x !== null);
}

export interface EmpresaExistente {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  ownerId: string | null;
}

export function planearEmpresa(
  c: CandidatoDeEmpresa,
  existente: EmpresaExistente,
  refs: Pick<ReferenciasResueltas, "ownerId">,
): CambioPlaneado[] {
  return [
    comparar("name", existente.name, c.name, {
      igual: (a, b) => claveDeOpcion(String(a)) === claveDeOpcion(String(b)),
    }),
    comparar("domain", existente.domain, c.domain),
    comparar("industry", existente.industry, c.industry),
    comparar("phone", existente.phone, c.phone),
    comparar("city", existente.city, c.city),
    comparar("country", existente.country, c.country),
    comparar("ownerId", existente.ownerId, refs.ownerId ?? undefined),
  ].filter((x): x is CambioPlaneado => x !== null);
}

// Qué cambios se aplican con una política. SKIP no aplica nada.
export function cambiosAAplicar(
  cambios: readonly CambioPlaneado[],
  politica: Politica,
): CambioPlaneado[] {
  if (politica === "SKIP") return [];
  return cambios.filter(
    (c) =>
      c.accion === "completar" ||
      c.accion === "agregar" ||
      (c.accion === "difiere" && politica === "OVERWRITE"),
  );
}

// ---------------------------------------------------------------------------
// Sugerencia de mapeo (§9.12 de ingestion-architecture.md, ampliada). Misma
// regla: encabezado normalizado contra una tabla fija de sinónimos, sin fuzzy
// matching. Lo que no matchea queda sin destino.
// ---------------------------------------------------------------------------

const SINONIMOS: Record<TipoImportable, Record<string, readonly string[]>> = {
  CONTACT: {
    externalId: ["id", "codigo", "codigo cliente", "id cliente", "id contacto"],
    firstName: ["nombre", "nombres", "first name", "firstname"],
    lastName: ["apellido", "apellidos", "last name", "lastname"],
    fullName: ["nombre completo", "nombre y apellido", "cliente", "contacto", "full name"],
    email: ["email", "e-mail", "mail", "correo", "correo electronico"],
    phone: ["telefono", "tel", "celular", "movil", "whatsapp", "phone"],
    jobTitle: ["puesto", "cargo", "rol", "job title"],
    notes: ["notas", "nota", "observaciones", "observacion", "comentarios"],
    lifecycleStage: ["etapa", "estado", "lifecycle", "lifecycle stage"],
    source: ["origen", "fuente", "canal", "source"],
    ownerEmail: ["vendedor", "asesor", "responsable", "email vendedor", "owner"],
    vehicleRef: ["vehiculo de interes", "vehiculo", "auto de interes", "patente de interes"],
    companyName: ["empresa", "compania", "razon social", "company"],
    customerSince: ["cliente desde", "fecha de alta", "alta", "fecha alta", "created"],
  },
  VEHICLE: {
    externalId: ["id", "id unidad", "id vehiculo"],
    stockCode: ["codigo", "codigo de stock", "cod", "stock", "nro de stock", "numero de stock"],
    make: ["marca", "make"],
    model: ["modelo", "model"],
    trim: ["version", "versión", "trim"],
    year: ["ano", "año", "modelo ano", "year"],
    mileage: ["km", "kms", "kilometros", "kilometraje", "mileage"],
    condition: ["condicion", "estado del vehiculo", "nuevo/usado", "0km", "condition"],
    price: ["precio", "precio de lista", "precio venta", "price"],
    currency: ["moneda", "currency"],
    priceUsd: ["precio usd", "precio u$s", "precio dolares", "usd"],
    priceLocal: ["precio pesos", "precio local", "precio $"],
    cost: ["costo", "costo de compra", "cost"],
    minPrice: ["precio minimo", "minimo", "piso"],
    status: ["estado", "situacion", "status"],
    color: ["color"],
    fuelType: ["combustible", "fuel"],
    transmission: ["transmision", "caja", "transmission"],
    licensePlate: ["patente", "matricula", "placa", "dominio", "plate"],
    vin: ["vin", "chasis", "numero de chasis", "nro de chasis"],
    photos: ["fotos", "imagenes", "imágenes", "links de fotos", "photos"],
  },
  ACTIVITY: {
    externalId: ["id", "id actividad", "id nota", "codigo"],
    type: ["tipo", "tipo de actividad", "type"],
    contactExternalId: ["id cliente", "id contacto", "codigo cliente"],
    contactEmail: ["email", "mail", "correo", "email cliente", "email contacto"],
    contactPhone: ["telefono", "celular", "telefono cliente"],
    subject: ["asunto", "titulo", "subject"],
    body: ["texto", "nota", "detalle", "descripcion", "comentario", "body"],
    occurredAt: ["fecha", "fecha de la actividad", "date"],
    dueDate: ["vencimiento", "vence", "fecha limite", "due date"],
    done: ["hecha", "completada", "realizada", "done"],
    authorName: ["autor", "usuario", "creado por", "author"],
    assigneeEmail: ["responsable", "asignado a", "assignee"],
  },
  COMPANY: {
    externalId: ["id", "codigo", "id empresa"],
    name: ["nombre", "empresa", "razon social", "name"],
    domain: ["dominio", "web", "sitio web", "website", "domain"],
    industry: ["rubro", "industria", "sector", "industry"],
    phone: ["telefono", "tel", "phone"],
    city: ["ciudad", "localidad", "city"],
    country: ["pais", "country"],
    ownerEmail: ["vendedor", "asesor", "responsable", "owner"],
  },
};

export function normalizarEncabezado(encabezado: string): string {
  return claveDeOpcion(encabezado).replace(/[_.]/g, " ").replace(/\s+/g, " ").trim();
}

// encabezado -> destino sugerido, solo para los que matchean. Un destino se
// sugiere una sola vez (el primer encabezado que lo pide). Los campos
// personalizados matchean por su etiqueta.
export function sugerirMapeo(
  tipo: TipoImportable,
  encabezados: readonly string[],
  definiciones: readonly DefinicionDeCampo[] = [],
): Record<string, string> {
  const tabla = SINONIMOS[tipo];
  const usados = new Set<string>();
  const sugerido: Record<string, string> = {};
  for (const encabezado of encabezados) {
    const n = normalizarEncabezado(encabezado);
    let destino = Object.entries(tabla).find(([, sinonimos]) => sinonimos.includes(n))?.[0];
    if (destino === undefined && tipo === "CONTACT") {
      const def = definiciones.find((d) => normalizarEncabezado(d.label) === n);
      if (def) destino = `${PREFIJO_CAMPO_PERSONALIZADO}${def.key}`;
    }
    if (destino !== undefined && !usados.has(destino)) {
      usados.add(destino);
      Object.defineProperty(sugerido, encabezado, {
        value: destino,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return sugerido;
}

// Los valores de sí/no del lote, con los por defecto si no se fijaron.
export function siNoDelLote(formato: { si?: string[]; no?: string[] }): {
  si: string[];
  no: string[];
} {
  return {
    si: formato.si && formato.si.length > 0 ? formato.si : [...SI_NO_POR_DEFECTO.si],
    no: formato.no && formato.no.length > 0 ? formato.no : [...SI_NO_POR_DEFECTO.no],
  };
}
