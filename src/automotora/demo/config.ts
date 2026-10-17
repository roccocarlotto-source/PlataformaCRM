import type {
  ConversationChannel,
  OpportunityLeadSource,
  VehicleBodyType,
  VehicleFuelType,
  VehicleTransmission,
  Weekday,
} from "@prisma/client";
import { MODELO_DEL_AGENTE_DE_LA_DEMO } from "../../clinicas/demo/config";
import { TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE } from "../../servicios/recordatorio/config";

// ---------------------------------------------------------------------------
// Los datos del Taller Demo (docs/taller-demo.md): una automotora de
// demostración con el módulo Servicios, en MODO DEMO (organizations.is_demo,
// src/services/modoDemo.service.ts): nada sale de la plataforma. TODO
// INVENTADO: nombres comunes, teléfonos uruguayos de forma válida que pueden
// existir (por eso el modo demo es obligatorio antes de sembrar un solo
// contacto), emails @example.com, links a example.com. Nada de ningún
// cliente real (el repo es público).
//
// Misma forma que la Clínica Demo (src/clinicas/demo/config.ts): constantes
// acá, carga en datosDeEjemplo.ts. Las fechas son RELATIVAS al momento de la
// carga: acá van en días (o meses) respecto de hoy, y datosDeEjemplo.ts las
// vuelve fechas en la zona de la demo.
// ---------------------------------------------------------------------------

export const NOMBRE_DE_LA_DEMO = "Taller Demo";

/** `taller-demo` o `taller-demo-<sufijo>`. NO entra en
 *  PATRONES_DE_SLUG_DE_PRUEBA: ninguna purga de organizaciones de test la toca.
 *  Rocco la borra a mano. */
export const SLUG_DE_LA_DEMO = "taller-demo";

export function esSlugDeTallerDemo(slug: string): boolean {
  return slug === SLUG_DE_LA_DEMO || slug.startsWith(`${SLUG_DE_LA_DEMO}-`);
}

export function nombreDeLaDemo(sufijo?: string): string {
  const limpio = sufijo?.trim();
  return limpio ? `${NOMBRE_DE_LA_DEMO} ${limpio}` : NOMBRE_DE_LA_DEMO;
}

export const ZONA_DE_LA_DEMO = "America/Montevideo";
/** País (598), moneda de ventas (USD) y moneda del taller (UYU). */
export const ORGANIZACION = {
  defaultPhoneCountryCode: "598",
  preferredCurrency: "USD",
  monedaDelTaller: "UYU",
} as const;

export { MODELO_DEL_AGENTE_DE_LA_DEMO };

// ---------------------------------------------------------------------------
// Usuarios. Los tres los elige quien crea la demo (nombre y email); acá solo
// qué rol tiene cada uno y qué hace en los datos. "vendedor" y "taller" se
// crean como usuarios de la organización desde el alta (ver
// tallerDemo.service.ts), así los datos de ejemplo ya pueden asignárseles.
// ---------------------------------------------------------------------------

export type ClaveDeUsuario = "admin" | "vendedor" | "taller";

export const ROL_DEL_USUARIO: Record<ClaveDeUsuario, "ADMIN" | "USER"> = {
  admin: "ADMIN",
  vendedor: "USER",
  taller: "USER",
};

// ---------------------------------------------------------------------------
// Sucursales y horarios
// ---------------------------------------------------------------------------

interface Franja {
  weekday: Weekday;
  startMinute: number;
  endMinute: number;
}

const h = (hora: number, minutos = 0) => hora * 60 + minutos;
const LUNES_A_VIERNES: Weekday[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

function franjas(dias: Weekday[], desde: number, hasta: number): Franja[] {
  return dias.map((weekday) => ({ weekday, startMinute: desde, endMinute: hasta }));
}

export type ClaveDeSucursal = "central" | "este";

export const SUCURSALES: Record<
  ClaveDeSucursal,
  { nombre: string; horario: Franja[]; responsable: ClaveDeUsuario }
> = {
  // Ventas y taller. Lunes a viernes de 9 a 18, sábados de 9 a 13.
  central: {
    nombre: "Casa Central",
    horario: [...franjas(LUNES_A_VIERNES, h(9), h(18)), ...franjas(["SATURDAY"], h(9), h(13))],
    responsable: "taller",
  },
  // Solo ventas.
  este: {
    nombre: "Sucursal Este",
    horario: franjas(LUNES_A_VIERNES, h(9), h(18)),
    responsable: "vendedor",
  },
};

/** La agenda del taller en Casa Central: un recurso y un tipo de turno, para
 *  los turnos vinculados a las órdenes (docs/servicios.md §4.4). */
export const AGENDA_DEL_TALLER = {
  recurso: "Taller",
  turno: "Turno de taller",
  duracionMin: 60,
} as const;

// ---------------------------------------------------------------------------
// Proceso de venta
// ---------------------------------------------------------------------------

export type ClaveDeEtapa = "nuevo" | "contactado" | "prueba" | "negociacion" | "ganada" | "perdida";

export const PROCESO_DE_VENTA = {
  nombre: "Venta de autos",
  etapas: [
    { clave: "nuevo", nombre: "Nuevo", probabilidad: 10 },
    { clave: "contactado", nombre: "Contactado", probabilidad: 25 },
    { clave: "prueba", nombre: "Prueba de manejo", probabilidad: 50 },
    { clave: "negociacion", nombre: "Negociación", probabilidad: 75 },
    { clave: "ganada", nombre: "Ganada", probabilidad: 100, ganada: true },
    { clave: "perdida", nombre: "Perdida", probabilidad: 0, perdida: true },
  ] as readonly {
    clave: ClaveDeEtapa;
    nombre: string;
    probabilidad: number;
    ganada?: true;
    perdida?: true;
  }[],
};

// ---------------------------------------------------------------------------
// Taller: configuración y tipos de service
// ---------------------------------------------------------------------------

export type ClaveDeTipoDeService =
  "service10" | "service20" | "aceite" | "alineacion" | "frenos" | "diagnostico";

export const TIPOS_DE_SERVICE: Record<
  ClaveDeTipoDeService,
  { nombre: string; meses: number | null }
> = {
  service10: { nombre: "Service 10.000 km", meses: 6 },
  service20: { nombre: "Service 20.000 km", meses: 12 },
  aceite: { nombre: "Cambio de aceite y filtro", meses: 6 },
  alineacion: { nombre: "Alineación y balanceo", meses: null },
  frenos: { nombre: "Frenos", meses: null },
  diagnostico: { nombre: "Diagnóstico electrónico", meses: null },
};

export const CONFIGURACION_DEL_TALLER = {
  currency: ORGANIZACION.monedaDelTaller,
  defaultNextServiceMonths: 12,
  firstServiceAfterMonths: 12,
} as const;

// ---------------------------------------------------------------------------
// Campos personalizados de contactos
// ---------------------------------------------------------------------------

export type ClaveDeCampo = "autoActual" | "formaDePago";

export const CAMPOS_PERSONALIZADOS: Record<
  ClaveDeCampo,
  { label: string; type: "TEXT" | "SELECT"; options?: string[] }
> = {
  autoActual: { label: "Auto actual", type: "TEXT" },
  formaDePago: {
    label: "Forma de pago",
    type: "SELECT",
    options: ["Contado", "Financiado", "Permuta"],
  },
};

// ---------------------------------------------------------------------------
// Contactos (todos inventados). Teléfonos uruguayos de forma válida; emails
// @example.com. `fuente` es el texto de "Fuente" del contacto; los de
// Instagram y Messenger tienen además una identidad de canal inventada.
// ---------------------------------------------------------------------------

export type FuenteDelContacto = "WhatsApp" | "Instagram" | "Messenger" | "Web" | "Referido";

export interface ContactoDeLaDemo {
  nombre: string;
  apellido: string;
  telefono: string;
  email: string;
  fuente: FuenteDelContacto;
  /** Días desde que se creó. */
  hace: number;
  sinInteres?: string;
  campos?: Partial<Record<ClaveDeCampo, string>>;
}

export const CONTACTOS: ContactoDeLaDemo[] = [
  // 0
  {
    nombre: "Lucía",
    apellido: "Fernández",
    telefono: "+59891234501",
    email: "lucia.fernandez@example.com",
    fuente: "WhatsApp",
    hace: 4,
    campos: { autoActual: "Chevrolet Celta 2012", formaDePago: "Financiado" },
  },
  // 1
  {
    nombre: "Jorge",
    apellido: "Méndez",
    telefono: "+59891234502",
    email: "jorge.mendez@example.com",
    fuente: "Referido",
    hace: 160,
  },
  // 2
  {
    nombre: "Nicolás",
    apellido: "Pereyra",
    telefono: "+59891234503",
    email: "nicolas.pereyra@example.com",
    fuente: "WhatsApp",
    hace: 12,
    campos: { formaDePago: "Contado" },
  },
  // 3
  {
    nombre: "Carolina",
    apellido: "Díaz",
    telefono: "+59891234504",
    email: "carolina.diaz@example.com",
    fuente: "WhatsApp",
    hace: 2,
    campos: { autoActual: "Fiat Mobi 2019", formaDePago: "Permuta" },
  },
  // 4
  {
    nombre: "Andrés",
    apellido: "Castro",
    telefono: "+59891234505",
    email: "andres.castro@example.com",
    fuente: "Messenger",
    hace: 40,
  },
  // 5
  {
    nombre: "Florencia",
    apellido: "Núñez",
    telefono: "+59891234506",
    email: "florencia.nunez@example.com",
    fuente: "Web",
    hace: 7,
    campos: { formaDePago: "Financiado" },
  },
  // 6
  {
    nombre: "Camila",
    apellido: "Rivera",
    telefono: "+59891234507",
    email: "camila.rivera@example.com",
    fuente: "Instagram",
    hace: 3,
  },
  // 7
  {
    nombre: "Martín",
    apellido: "Acosta",
    telefono: "+59891234508",
    email: "martin.acosta@example.com",
    fuente: "WhatsApp",
    hace: 20,
    campos: { autoActual: "Suzuki Celerio 2017", formaDePago: "Permuta" },
  },
  // 8
  {
    nombre: "Valeria",
    apellido: "Techera",
    telefono: "+59891234509",
    email: "valeria.techera@example.com",
    fuente: "WhatsApp",
    hace: 45,
    campos: { formaDePago: "Contado" },
  },
  // 9
  {
    nombre: "Gonzalo",
    apellido: "Olivera",
    telefono: "+59891234510",
    email: "gonzalo.olivera@example.com",
    fuente: "Instagram",
    hace: 50,
  },
  // 10
  {
    nombre: "Paula",
    apellido: "Benítez",
    telefono: "+59891234511",
    email: "paula.benitez@example.com",
    fuente: "Web",
    hace: 48,
    campos: { formaDePago: "Financiado" },
  },
  // 11
  {
    nombre: "Rodrigo",
    apellido: "Silveira",
    telefono: "+59891234512",
    email: "rodrigo.silveira@example.com",
    fuente: "WhatsApp",
    hace: 300,
  },
  // 12
  {
    nombre: "Natalia",
    apellido: "Píriz",
    telefono: "+59891234513",
    email: "natalia.piriz@example.com",
    fuente: "Instagram",
    hace: 70,
    sinInteres: "Compró en otra automotora",
  },
  // 13
  {
    nombre: "Sebastián",
    apellido: "Larrosa",
    telefono: "+59891234514",
    email: "sebastian.larrosa@example.com",
    fuente: "Messenger",
    hace: 55,
    sinInteres: "No contestó más",
  },
  // 14
  {
    nombre: "Raúl",
    apellido: "Gutiérrez",
    telefono: "+59891234515",
    email: "raul.gutierrez@example.com",
    fuente: "Referido",
    hace: 400,
  },
];

/** El contacto del probador del agente (§5 del diseño): sin teléfono ni
 *  email, para que las pruebas en vivo no ensucien una conversación de
 *  ejemplo. */
export const VISITANTE_WEB = { nombre: "Visitante", apellido: "Web" };

/** Identidades de canal inventadas (el PSID/IGSID que mandaría Meta). */
export const IDENTIDADES_DE_CANAL: { contacto: number; canal: ConversationChannel; id: string }[] =
  [
    { contacto: 6, canal: "INSTAGRAM", id: "demo-ig-0006" },
    { contacto: 9, canal: "INSTAGRAM", id: "demo-ig-0009" },
    { contacto: 12, canal: "INSTAGRAM", id: "demo-ig-0012" },
    { contacto: 4, canal: "MESSENGER", id: "demo-ms-0004" },
    { contacto: 13, canal: "MESSENGER", id: "demo-ms-0013" },
  ];

/** La fuente "Landing" y sus dos eventos promovidos (los contactos de la web). */
export const FUENTE_LANDING = {
  nombre: "Landing — formulario web",
  eventos: [
    { contacto: 5, externalId: "demo-landing-0001", formulario: "Quiero cotizar un usado" },
    { contacto: 10, externalId: "demo-landing-0002", formulario: "Consulta por financiación" },
  ],
};

// ---------------------------------------------------------------------------
// Stock. Precios USD publicados (y en pesos, ×41 a modo de ejemplo); una en
// pesos solamente y una "a consultar". Las publicadas y disponibles las
// conoce el agente por la sincronización con la base de conocimiento.
// ---------------------------------------------------------------------------

export type ClaveDeUnidad =
  | "onix"
  | "gol"
  | "cronos"
  | "corollaCross"
  | "hb20"
  | "p208"
  | "kwid"
  | "swift"
  | "kicks"
  | "ranger";

export interface UnidadDeLaDemo {
  marca: string;
  modelo: string;
  anio: number;
  carroceria: VehicleBodyType;
  combustible: VehicleFuelType;
  caja: VehicleTransmission;
  color: string;
  km: number;
  precioUsd: number | null;
  /** Solo pesos (publicationCurrency LOCAL_ONLY). */
  soloPesos?: number;
  aConsultar?: true;
  sucursal: ClaveDeSucursal;
  estado: "AVAILABLE" | "RESERVED" | "SOLD";
  descripcion: string;
}

export const COTIZACION_DE_EJEMPLO = 41;

export const STOCK: Record<ClaveDeUnidad, UnidadDeLaDemo> = {
  onix: {
    marca: "Chevrolet",
    modelo: "Onix 1.0 Turbo",
    anio: 2022,
    carroceria: "HATCHBACK",
    combustible: "GASOLINE",
    caja: "AUTOMATIC",
    color: "Blanco",
    km: 31000,
    precioUsd: 16900,
    sucursal: "central",
    estado: "RESERVED",
    descripcion: "Único dueño, service oficial al día. Reservado con seña.",
  },
  gol: {
    marca: "Volkswagen",
    modelo: "Gol Trend 1.6",
    anio: 2019,
    carroceria: "HATCHBACK",
    combustible: "GASOLINE",
    caja: "MANUAL",
    color: "Gris",
    km: 68000,
    precioUsd: 11500,
    sucursal: "este",
    estado: "AVAILABLE",
    descripcion: "Muy cuidado, cubiertas nuevas.",
  },
  cronos: {
    marca: "Fiat",
    modelo: "Cronos Drive 1.3",
    anio: 2021,
    carroceria: "SEDAN",
    combustible: "GASOLINE",
    caja: "MANUAL",
    color: "Rojo",
    km: 42000,
    precioUsd: 14900,
    sucursal: "central",
    estado: "AVAILABLE",
    descripcion: "Ideal para la ciudad, bajo consumo.",
  },
  corollaCross: {
    marca: "Toyota",
    modelo: "Corolla Cross XEi",
    anio: 2023,
    carroceria: "SUV",
    combustible: "GASOLINE",
    caja: "AUTOMATIC",
    color: "Gris plata",
    km: 18000,
    precioUsd: 26500,
    sucursal: "central",
    estado: "SOLD",
    descripcion: "Vendido este mes.",
  },
  hb20: {
    marca: "Hyundai",
    modelo: "HB20 1.6",
    anio: 2020,
    carroceria: "HATCHBACK",
    combustible: "GASOLINE",
    caja: "AUTOMATIC",
    color: "Azul",
    km: 55000,
    precioUsd: 15000,
    sucursal: "este",
    estado: "SOLD",
    descripcion: "Vendido este mes.",
  },
  p208: {
    marca: "Peugeot",
    modelo: "208 Active 1.6",
    anio: 2022,
    carroceria: "HATCHBACK",
    combustible: "GASOLINE",
    caja: "AUTOMATIC",
    color: "Negro",
    km: 27000,
    precioUsd: 15500,
    sucursal: "central",
    estado: "AVAILABLE",
    descripcion: "Pantalla táctil, cámara de retroceso.",
  },
  kwid: {
    marca: "Renault",
    modelo: "Kwid Zen 1.0",
    anio: 2021,
    carroceria: "HATCHBACK",
    combustible: "GASOLINE",
    caja: "MANUAL",
    color: "Blanco",
    km: 39000,
    precioUsd: 9800,
    sucursal: "central",
    estado: "AVAILABLE",
    descripcion: "El más económico del stock.",
  },
  swift: {
    marca: "Suzuki",
    modelo: "Swift GL 1.2",
    anio: 2018,
    carroceria: "HATCHBACK",
    combustible: "GASOLINE",
    caja: "MANUAL",
    color: "Rojo",
    km: 81000,
    precioUsd: null,
    soloPesos: 520000,
    sucursal: "este",
    estado: "AVAILABLE",
    descripcion: "Publicado en pesos. Financiación disponible.",
  },
  kicks: {
    marca: "Nissan",
    modelo: "Kicks Advance 1.6",
    anio: 2022,
    carroceria: "SUV",
    combustible: "GASOLINE",
    caja: "AUTOMATIC",
    color: "Gris oscuro",
    km: 24000,
    precioUsd: 19900,
    sucursal: "central",
    estado: "AVAILABLE",
    descripcion: "Garantía de fábrica vigente.",
  },
  ranger: {
    marca: "Ford",
    modelo: "Ranger XLT 3.2 4x4",
    anio: 2021,
    carroceria: "PICKUP",
    combustible: "DIESEL",
    caja: "AUTOMATIC",
    color: "Blanco",
    km: 62000,
    precioUsd: null,
    aConsultar: true,
    sucursal: "central",
    estado: "AVAILABLE",
    descripcion: "Precio a consultar. Única mano, lista para trabajar.",
  },
};

// ---------------------------------------------------------------------------
// Oportunidades. `creada` y `cerrada` son fechas relativas: { mes: 0 } es
// este mes (día k, nunca después de hoy), { mes: -1 } el mes pasado. Así el
// Dashboard muestra siempre "creadas este mes 7 (mes pasado 5)", "ganadas
// este mes 2 (mes pasado 2)", "perdidas 1 (2)", empiece el mes cuando empiece.
// ---------------------------------------------------------------------------

export interface FechaRelativaAlMes {
  /** 0 = este mes, -1 = el mes pasado, -2 = hace dos meses. */
  mes: 0 | -1 | -2;
  /** Día del mes (0 = el primero). Este mes se recorta a hoy. */
  dia: number;
}

export interface OportunidadDeLaDemo {
  titulo: string;
  contacto: number;
  etapa: ClaveDeEtapa;
  montoUsd: number;
  unidad?: ClaveDeUnidad;
  creada: FechaRelativaAlMes;
  cerrada?: FechaRelativaAlMes;
  motivoDePerdida?: string;
  origen: OpportunityLeadSource;
  /** Quién la lleva: el vendedor, salvo que se diga otra cosa. */
  duena?: ClaveDeUsuario;
}

export const OPORTUNIDADES: OportunidadDeLaDemo[] = [
  // --- Abiertas (6, USD 98.200) ---
  {
    titulo: "Chevrolet Onix 2022 — Lucía Fernández",
    contacto: 0,
    etapa: "prueba",
    montoUsd: 16900,
    unidad: "onix",
    creada: { mes: 0, dia: 10 },
    origen: "WHATSAPP",
  },
  {
    titulo: "Ford Ranger 2021 — Camila Rivera",
    contacto: 6,
    etapa: "contactado",
    montoUsd: 19500,
    creada: { mes: 0, dia: 12 },
    origen: "INSTAGRAM",
  },
  {
    titulo: "Volkswagen Gol 2019 — Nicolás Pereyra",
    contacto: 2,
    etapa: "negociacion",
    montoUsd: 11500,
    creada: { mes: 0, dia: 3 },
    origen: "WHATSAPP",
  },
  {
    titulo: "Fiat Cronos 2021 — Carolina Díaz",
    contacto: 3,
    etapa: "nuevo",
    montoUsd: 14900,
    creada: { mes: 0, dia: 14 },
    origen: "WHATSAPP",
  },
  {
    titulo: "Peugeot 208 2022 — Andrés Castro",
    contacto: 4,
    etapa: "negociacion",
    montoUsd: 15500,
    creada: { mes: 0, dia: 6 },
    origen: "MESSENGER",
  },
  {
    titulo: "Nissan Kicks 2022 — Florencia Núñez",
    contacto: 5,
    etapa: "contactado",
    montoUsd: 19900,
    creada: { mes: 0, dia: 8 },
    origen: "WEBSITE",
    duena: "admin",
  },
  // --- Ganadas (4): dos este mes por USD 41.500, dos el mes pasado por 36.000 ---
  {
    titulo: "Toyota Corolla Cross 2023 — Martín Acosta",
    contacto: 7,
    etapa: "ganada",
    montoUsd: 26500,
    unidad: "corollaCross",
    creada: { mes: 0, dia: 1 },
    cerrada: { mes: 0, dia: 9 },
    origen: "WHATSAPP",
  },
  {
    titulo: "Hyundai HB20 2020 — Valeria Techera",
    contacto: 8,
    etapa: "ganada",
    montoUsd: 15000,
    unidad: "hb20",
    creada: { mes: -1, dia: 18 },
    cerrada: { mes: 0, dia: 4 },
    origen: "WHATSAPP",
  },
  {
    titulo: "Peugeot 2008 2019 — Gonzalo Olivera",
    contacto: 9,
    etapa: "ganada",
    montoUsd: 21000,
    creada: { mes: -1, dia: 2 },
    cerrada: { mes: -1, dia: 15 },
    origen: "INSTAGRAM",
  },
  {
    titulo: "Renault Sandero 2020 — Paula Benítez",
    contacto: 10,
    etapa: "ganada",
    montoUsd: 15000,
    unidad: undefined,
    creada: { mes: -1, dia: 5 },
    cerrada: { mes: -1, dia: 22 },
    origen: "WEBSITE",
    duena: "admin",
  },
  // --- Perdidas (3): una este mes, dos el mes pasado ---
  {
    titulo: "Toyota Etios 2018 — Natalia Píriz",
    contacto: 12,
    etapa: "perdida",
    montoUsd: 9500,
    creada: { mes: -1, dia: 20 },
    cerrada: { mes: 0, dia: 2 },
    motivoDePerdida: "Compró en otro lado",
    origen: "INSTAGRAM",
  },
  {
    titulo: "Chevrolet Spin 2019 — Sebastián Larrosa",
    contacto: 13,
    etapa: "perdida",
    montoUsd: 13000,
    creada: { mes: -2, dia: 10 },
    cerrada: { mes: -1, dia: 8 },
    motivoDePerdida: "Precio",
    origen: "MESSENGER",
  },
  {
    titulo: "Fiat Argo 2020 — Andrés Castro",
    contacto: 4,
    etapa: "perdida",
    montoUsd: 12000,
    creada: { mes: -1, dia: 12 },
    cerrada: { mes: -1, dia: 26 },
    motivoDePerdida: "Sin respuesta",
    origen: "MESSENGER",
  },
];

// ---------------------------------------------------------------------------
// Vehículos de clientes (Taller). Cuatro vienen de ventas ganadas (la
// oportunidad de origen es la de `venta`); el resto, cargados a mano.
// `compradoHaceMeses` arma la fecha de compra (null = sin fecha de compra, para
// el aviso del Resumen). `proximoServiceEnDias` fija el próximo service
// (negativo = vencido). El recambio se calcula a 48 meses de la compra y se
// avisa 60 días antes (src/servicios/recambio/config.ts): las compras de
// hace más de 4 años son recambios vencidos; las de ~46 meses, próximos.
// ---------------------------------------------------------------------------

export interface VehiculoDeClienteDeLaDemo {
  clave: string;
  contacto: number;
  marca: string;
  modelo: string;
  anio: number;
  patente: string;
  km: number;
  sucursal: ClaveDeSucursal;
  /** El índice en OPORTUNIDADES de la venta de la que salió. */
  venta?: number;
  compradoHaceMeses: number | null;
  /** Días extra sobre los meses (para afinar la fecha de recambio). */
  compradoHaceDiasExtra?: number;
  proximoServiceEnDias: number | null;
}

export const VEHICULOS_DE_CLIENTES: VehiculoDeClienteDeLaDemo[] = [
  // De ventas ganadas: la fecha de compra es la de cierre, y el primer
  // service, a los 12 meses (se escriben en datosDeEjemplo.ts).
  {
    clave: "corollaCross",
    contacto: 7,
    marca: "Toyota",
    modelo: "Corolla Cross XEi",
    anio: 2023,
    patente: "SDM 1201",
    km: 18000,
    sucursal: "central",
    venta: 6,
    compradoHaceMeses: 0,
    proximoServiceEnDias: null,
  },
  {
    clave: "hb20",
    contacto: 8,
    marca: "Hyundai",
    modelo: "HB20 1.6",
    anio: 2020,
    patente: "SDM 1202",
    km: 55000,
    sucursal: "este",
    venta: 7,
    compradoHaceMeses: 0,
    proximoServiceEnDias: null,
  },
  {
    clave: "p2008",
    contacto: 9,
    marca: "Peugeot",
    modelo: "2008 Allure",
    anio: 2019,
    patente: "SDM 1203",
    km: 61000,
    sucursal: "central",
    venta: 8,
    compradoHaceMeses: 0,
    proximoServiceEnDias: null,
  },
  {
    clave: "sandero",
    contacto: 10,
    marca: "Renault",
    modelo: "Sandero Stepway",
    anio: 2020,
    patente: "SDM 1204",
    km: 47000,
    sucursal: "central",
    venta: 9,
    compradoHaceMeses: 0,
    proximoServiceEnDias: null,
  },
  // Recambios vencidos (compras de hace más de 4 años, sin aviso).
  {
    clave: "clio",
    contacto: 1,
    marca: "Renault",
    modelo: "Clio Mío",
    anio: 2016,
    patente: "SDM 1205",
    km: 112000,
    sucursal: "central",
    compradoHaceMeses: 62,
    proximoServiceEnDias: 5,
  },
  {
    clave: "palio",
    contacto: 11,
    marca: "Fiat",
    modelo: "Palio Attractive",
    anio: 2015,
    patente: "SDM 1206",
    km: 134000,
    sucursal: "central",
    compradoHaceMeses: 56,
    proximoServiceEnDias: -20,
  },
  {
    clave: "corsa",
    contacto: 14,
    marca: "Chevrolet",
    modelo: "Corsa Classic",
    anio: 2014,
    patente: "SDM 1207",
    km: 150000,
    sucursal: "este",
    compradoHaceMeses: 70,
    proximoServiceEnDias: null,
  },
  // Recambios en los próximos 90 días (a 48 meses de la compra, 65 y 85 días adelante).
  {
    clave: "march",
    contacto: 10,
    marca: "Nissan",
    modelo: "March Sense",
    anio: 2019,
    patente: "SDM 1208",
    km: 58000,
    sucursal: "central",
    compradoHaceMeses: 46,
    compradoHaceDiasExtra: -4,
    proximoServiceEnDias: 120,
  },
  {
    clave: "cobalt",
    contacto: 9,
    marca: "Chevrolet",
    modelo: "Cobalt LTZ",
    anio: 2019,
    patente: "SDM 1209",
    km: 72000,
    sucursal: "central",
    compradoHaceMeses: 46,
    compradoHaceDiasExtra: -20,
    proximoServiceEnDias: null,
  },
  // Services: uno vencido más, y dos sin fecha de compra que vencen en 30 días.
  {
    clave: "celerio",
    contacto: 7,
    marca: "Suzuki",
    modelo: "Celerio GL",
    anio: 2017,
    patente: "SDM 1210",
    km: 89000,
    sucursal: "central",
    compradoHaceMeses: 30,
    proximoServiceEnDias: -35,
  },
  {
    clave: "qq",
    contacto: 12,
    marca: "Chery",
    modelo: "QQ Light",
    anio: 2016,
    patente: "SDM 1211",
    km: 97000,
    sucursal: "central",
    compradoHaceMeses: null,
    proximoServiceEnDias: 12,
  },
  {
    clave: "i10",
    contacto: 13,
    marca: "Hyundai",
    modelo: "i10 GLS",
    anio: 2017,
    patente: "SDM 1212",
    km: 76000,
    sucursal: "este",
    compradoHaceMeses: null,
    proximoServiceEnDias: 25,
  },
  // Los autos de clientes con una compra en curso: están en el taller.
  {
    clave: "mobi",
    contacto: 3,
    marca: "Fiat",
    modelo: "Mobi Like",
    anio: 2019,
    patente: "SDM 1213",
    km: 48000,
    sucursal: "central",
    compradoHaceMeses: 20,
    proximoServiceEnDias: null,
  },
  {
    clave: "picanto",
    contacto: 5,
    marca: "Kia",
    modelo: "Picanto EX",
    anio: 2018,
    patente: "SDM 1214",
    km: 64000,
    sucursal: "central",
    compradoHaceMeses: 26,
    proximoServiceEnDias: null,
  },
  {
    clave: "yaris",
    contacto: 6,
    marca: "Toyota",
    modelo: "Yaris XS",
    anio: 2017,
    patente: "SDM 1215",
    km: 83000,
    sucursal: "central",
    compradoHaceMeses: 34,
    proximoServiceEnDias: null,
  },
];

// ---------------------------------------------------------------------------
// Turnos de taller: la semana que viene (0 = lunes), en Casa Central.
// ---------------------------------------------------------------------------

export interface TurnoDeLaDemo {
  clave: string;
  contacto: number;
  dia: number;
  hora: number;
  cancelado?: true;
}

export const TURNOS: TurnoDeLaDemo[] = [
  { clave: "march", contacto: 10, dia: 1, hora: 9 },
  { clave: "cobalt", contacto: 9, dia: 2, hora: 10, cancelado: true },
  { clave: "extra", contacto: 2, dia: 3, hora: 15 },
];

// ---------------------------------------------------------------------------
// Órdenes de servicio, OS-0001 a OS-0011, por los services (crearOrden →
// cambiarEstado → registrarAprobacion → registrarAviso). `pasos` es el
// historial de estados con cuántas HORAS antes de ahora ocurrió cada uno (el
// alta es el primero); se escriben después, directo, para que "hace más de
// 24 h" sea verdad. Valores en pesos.
// ---------------------------------------------------------------------------

export type EstadoDeOrden =
  | "AGENDADO"
  | "RECIBIDO"
  | "EN_TRABAJO"
  | "ESPERANDO_APROBACION"
  | "LISTO_PARA_RETIRAR"
  | "ENTREGADO"
  | "CANCELADO";

export interface PasoDeOrden {
  estado: EstadoDeOrden;
  horasAtras: number;
  nota?: string;
  /** Solo al pasar a RECIBIDO. */
  km?: number;
  /** Solo al cancelar. */
  motivo?: string;
  /** Solo al entregar: el próximo service, en días desde hoy (null = sin). */
  proximoServiceEnDias?: number | null;
  /** Antes de este paso se registra esta aprobación. */
  aprobacion?: {
    descripcion: string;
    monto: number;
    decision: "APROBADO" | "RECHAZADO";
    quien: string;
    canal: "TELEFONO" | "WHATSAPP" | "PRESENCIAL";
  };
}

export interface OrdenDeLaDemo {
  vehiculo: string;
  tipos: ClaveDeTipoDeService[];
  valor: number;
  notas: string;
  /** El turno vinculado (solo las Agendadas). */
  turno?: string;
  pasos: PasoDeOrden[];
  /** Después de llegar a Listo para retirar: "Avisar al cliente". */
  avisado?: "WHATSAPP" | "TELEFONO";
}

export const ORDENES: OrdenDeLaDemo[] = [
  // OS-0001 Entregado hace meses: dejó fijado el próximo service del Clio.
  {
    vehiculo: "clio",
    tipos: ["service20"],
    valor: 9800,
    notas: "Service de 20.000 km completo. Se cambió el filtro de aire.",
    pasos: [
      { estado: "RECIBIDO", horasAtras: 150 * 24, km: 110500 },
      { estado: "EN_TRABAJO", horasAtras: 150 * 24 - 2 },
      { estado: "LISTO_PARA_RETIRAR", horasAtras: 149 * 24 },
      { estado: "ENTREGADO", horasAtras: 148 * 24, proximoServiceEnDias: 5 },
    ],
  },
  // OS-0002 Cancelada: el cliente no vino.
  {
    vehiculo: "qq",
    tipos: ["diagnostico"],
    valor: 3900,
    notas: "Testigo de motor encendido.",
    pasos: [
      { estado: "AGENDADO", horasAtras: 22 * 24 },
      { estado: "CANCELADO", horasAtras: 20 * 24, motivo: "El cliente no vino al turno" },
    ],
  },
  // OS-0003 Recibido ayer.
  {
    vehiculo: "mobi",
    tipos: ["service10"],
    valor: 6900,
    notas: "Service de 10.000 km. Revisar ruido en la suspensión delantera.",
    pasos: [{ estado: "RECIBIDO", horasAtras: 26, km: 48200 }],
  },
  // OS-0004 Recibido hoy.
  {
    vehiculo: "picanto",
    tipos: ["aceite"],
    valor: 3900,
    notas: "Cambio de aceite y filtro.",
    pasos: [{ estado: "RECIBIDO", horasAtras: 3, km: 64300 }],
  },
  // OS-0005 En trabajo.
  {
    vehiculo: "sandero",
    tipos: ["service20", "alineacion"],
    valor: 12400,
    notas: "Service de 20.000 km y alineación.",
    pasos: [
      { estado: "RECIBIDO", horasAtras: 50, km: 47100 },
      { estado: "EN_TRABAJO", horasAtras: 28 },
    ],
  },
  // OS-0006 En trabajo, con un extra aprobado por teléfono.
  {
    vehiculo: "p2008",
    tipos: ["frenos", "diagnostico"],
    valor: 10600,
    notas: "Frenos delanteros y diagnóstico por testigo de ABS.",
    pasos: [
      { estado: "RECIBIDO", horasAtras: 74, km: 61200 },
      { estado: "ESPERANDO_APROBACION", horasAtras: 52, nota: "Amortiguadores traseros vencidos" },
      {
        estado: "EN_TRABAJO",
        horasAtras: 27,
        aprobacion: {
          descripcion: "Cambio de amortiguadores traseros",
          monto: 14200,
          decision: "APROBADO",
          quien: "El titular",
          canal: "TELEFONO",
        },
      },
    ],
  },
  // OS-0007 Esperando aprobación hace más de 24 h.
  {
    vehiculo: "yaris",
    tipos: ["frenos"],
    valor: 4500,
    notas: "Revisión de frenos.",
    pasos: [
      { estado: "RECIBIDO", horasAtras: 72, km: 83400 },
      {
        estado: "ESPERANDO_APROBACION",
        horasAtras: 30,
        nota: "Pastillas y discos de freno: $ 18.500. Se le consultó a la clienta por WhatsApp.",
      },
    ],
  },
  // OS-0008 Esperando aprobación desde hace dos horas.
  {
    vehiculo: "hb20",
    tipos: ["diagnostico"],
    valor: 5200,
    notas: "Diagnóstico electrónico: falla intermitente del aire acondicionado.",
    pasos: [
      { estado: "RECIBIDO", horasAtras: 5, km: 55200 },
      { estado: "ESPERANDO_APROBACION", horasAtras: 2, nota: "Compresor de aire: $ 32.000" },
    ],
  },
  // OS-0009 Listo para retirar, cliente avisado (simulado).
  {
    vehiculo: "corollaCross",
    tipos: ["service10"],
    valor: 7900,
    notas: "Primer service de 10.000 km.",
    pasos: [
      { estado: "RECIBIDO", horasAtras: 49, km: 18400 },
      { estado: "EN_TRABAJO", horasAtras: 25 },
      { estado: "LISTO_PARA_RETIRAR", horasAtras: 3 },
    ],
    avisado: "WHATSAPP",
  },
  // OS-0010 Agendada con turno la semana que viene.
  {
    vehiculo: "march",
    tipos: ["service10"],
    valor: 6900,
    notas: "Service de 10.000 km.",
    turno: "march",
    pasos: [{ estado: "AGENDADO", horasAtras: 30 }],
  },
  // OS-0011 Agendada, el turno se canceló.
  {
    vehiculo: "cobalt",
    tipos: ["alineacion"],
    valor: 4200,
    notas: "Alineación y balanceo.",
    turno: "cobalt",
    pasos: [{ estado: "AGENDADO", horasAtras: 20 }],
  },
];

// ---------------------------------------------------------------------------
// Tareas (Actividades / Mis tareas). `vence` en días desde hoy (negativo =
// vencida); `completadaHace` en días. Las vencidas son tres: una del recambio,
// una de seguimiento de venta y una manual.
// ---------------------------------------------------------------------------

export interface TareaDeLaDemo {
  asunto: string;
  tipo: "TASK" | "CALL" | "MEETING";
  para: ClaveDeUsuario;
  contacto?: number;
  /** El índice en OPORTUNIDADES. */
  oportunidad?: number;
  vence: number;
  hora?: number;
  completadaHace?: number;
  cuerpo?: string;
}

export const TAREAS: TareaDeLaDemo[] = [
  {
    asunto: "Contactar a Jorge Méndez: se acerca el recambio de su Renault Clio 2016",
    tipo: "CALL",
    para: "vendedor",
    contacto: 1,
    vence: -3,
    cuerpo: "Compró hace más de cuatro años. Ofrecerle tasación y un usado.",
  },
  {
    asunto: "Seguimiento de venta: Valeria Techera (HB20)",
    tipo: "CALL",
    para: "vendedor",
    contacto: 8,
    oportunidad: 7,
    vence: -1,
  },
  {
    asunto: "Llamar a Nicolás Pereyra por el Gol",
    tipo: "CALL",
    para: "vendedor",
    contacto: 2,
    oportunidad: 2,
    vence: -2,
  },
  {
    asunto: "Prueba de manejo del Onix con Lucía Fernández",
    tipo: "MEETING",
    para: "vendedor",
    contacto: 0,
    oportunidad: 0,
    vence: 0,
    hora: 16,
  },
  {
    asunto: "Confirmar seña del Corolla Cross con Martín Acosta",
    tipo: "TASK",
    para: "admin",
    contacto: 7,
    oportunidad: 6,
    vence: 0,
    hora: 18,
  },
  {
    asunto: "Pedir pastillas y discos para la OS-0007",
    tipo: "TASK",
    para: "taller",
    contacto: 6,
    vence: 0,
    hora: 17,
  },
  {
    asunto: "Agradecer la compra a Martín Acosta",
    tipo: "TASK",
    para: "vendedor",
    contacto: 7,
    oportunidad: 6,
    vence: 2,
  },
  {
    asunto: "Enviar cotización del 208 a Andrés Castro",
    tipo: "TASK",
    para: "vendedor",
    contacto: 4,
    oportunidad: 4,
    vence: 3,
  },
  {
    asunto: "Tasar el Mobi de Carolina Díaz para la permuta",
    contacto: 3,
    oportunidad: 3,
    tipo: "TASK",
    para: "admin",
    vence: 5,
  },
  {
    asunto: "Llamada inicial a Florencia Núñez",
    tipo: "CALL",
    para: "vendedor",
    contacto: 5,
    oportunidad: 5,
    vence: -6,
    completadaHace: 6,
  },
  {
    asunto: "Agradecer la compra a Paula Benítez",
    tipo: "TASK",
    para: "vendedor",
    contacto: 10,
    oportunidad: 9,
    vence: -8,
    completadaHace: 8,
  },
];

// ---------------------------------------------------------------------------
// Conversaciones de ejemplo, con sus mensajes. Los salientes quedan SENT con
// un id `demo:…` (modo demo); `tools` es el registro de tools del turno del
// agente, de forma libre (Message.toolCalls no tiene forma impuesta).
// ---------------------------------------------------------------------------

export interface MensajeDeLaDemo {
  de: "CONTACTO" | "AGENTE" | "PERSONA";
  texto: string;
  /** Minutos después del primer mensaje. */
  minuto: number;
  tools?: { name: string; arguments: Record<string, unknown>; result: string }[];
}

export interface ConversacionDeLaDemo {
  canal: ConversationChannel;
  contacto: number;
  /** Horas antes de ahora del primer mensaje. */
  hace: number;
  estado: "ACTIVE" | "TRANSFERRED_TO_HUMAN" | "CLOSED";
  /** A quién se transfirió. */
  transferidaA?: ClaveDeUsuario;
  mensajes: MensajeDeLaDemo[];
}

export const CONVERSACIONES: ConversacionDeLaDemo[] = [
  {
    canal: "WHATSAPP",
    contacto: 0,
    hace: 96,
    estado: "ACTIVE",
    mensajes: [
      {
        de: "CONTACTO",
        texto: "Hola! Vi el Onix 2022 en la página, ¿sigue disponible?",
        minuto: 0,
      },
      {
        de: "AGENTE",
        texto:
          "¡Hola Lucía! Sí, el Chevrolet Onix 1.0 Turbo 2022 está disponible: automático, 31.000 km, único dueño, USD 16.900. ¿Querés venir a verlo y hacer una prueba de manejo?",
        minuto: 1,
        tools: [
          {
            name: "search_vehicles",
            arguments: { make: "Chevrolet", model: "Onix" },
            result:
              "1 unidad: Chevrolet Onix 1.0 Turbo 2022, USD 16.900, disponible en Casa Central",
          },
        ],
      },
      { de: "CONTACTO", texto: "Sí, ¿puede ser el sábado a la mañana?", minuto: 4 },
      {
        de: "AGENTE",
        texto:
          "Perfecto. Te anoto una prueba de manejo el sábado a las 10 en Casa Central. Un vendedor te va a confirmar por acá. ¿Tenés auto para entregar en parte de pago?",
        minuto: 5,
        tools: [
          {
            name: "create_opportunity",
            arguments: { title: "Chevrolet Onix 2022 — Lucía Fernández", vehicle: "Onix 2022" },
            result: "Oportunidad creada en Nuevo",
          },
        ],
      },
      { de: "CONTACTO", texto: "Tengo un Celta 2012, ¿lo toman?", minuto: 7 },
      {
        de: "AGENTE",
        texto:
          "Sí, tomamos usados en parte de pago. El sábado lo tasamos en el momento. ¡Te esperamos!",
        minuto: 8,
      },
      {
        de: "PERSONA",
        texto:
          "Hola Lucía, soy Martín de ventas. Confirmado el sábado a las 10, te espero con el Onix listo.",
        minuto: 65,
      },
    ],
  },
  {
    canal: "INSTAGRAM",
    contacto: 6,
    hace: 72,
    estado: "ACTIVE",
    mensajes: [
      { de: "CONTACTO", texto: "Precio de la Ranger blanca que publicaron?", minuto: 0 },
      {
        de: "AGENTE",
        texto:
          "¡Hola! La Ford Ranger XLT 3.2 4x4 2021 tiene precio a consultar: te lo pasa un vendedor. Es única mano, 62.000 km, automática. ¿Te la cotizo con financiación o al contado?",
        minuto: 1,
        tools: [
          {
            name: "search_vehicles",
            arguments: { make: "Ford", model: "Ranger" },
            result: "1 unidad: Ford Ranger XLT 3.2 4x4 2021, precio a consultar",
          },
        ],
      },
      { de: "CONTACTO", texto: "Financiada, hasta 48 cuotas", minuto: 10 },
      {
        de: "AGENTE",
        texto:
          "Dale. Trabajamos hasta 60 cuotas con entrega. Te dejo registrada la consulta y un vendedor te contacta hoy con el número. ¿A qué teléfono te llamamos?",
        minuto: 11,
        tools: [
          {
            name: "create_opportunity",
            arguments: { title: "Ford Ranger 2021 — Camila Rivera" },
            result: "Oportunidad creada en Nuevo",
          },
        ],
      },
      { de: "CONTACTO", texto: "Al 091 234 507, de tarde", minuto: 14 },
    ],
  },
  {
    canal: "MESSENGER",
    contacto: 11,
    hace: 30,
    estado: "TRANSFERRED_TO_HUMAN",
    transferidaA: "taller",
    mensajes: [
      { de: "CONTACTO", texto: "Hola, quiero un turno para el service del Palio", minuto: 0 },
      {
        de: "AGENTE",
        texto:
          "¡Hola Rodrigo! El taller atiende de lunes a viernes de 9 a 18 y sábados de 9 a 13 en Casa Central. Te paso con el encargado del taller para coordinar el turno y el presupuesto.",
        minuto: 1,
      },
      { de: "CONTACTO", texto: "Gracias, lo necesito para la semana que viene", minuto: 3 },
      {
        de: "PERSONA",
        texto:
          "Hola Rodrigo, soy Diego del taller. Tengo lugar el martes a las 9 o el jueves a las 15. ¿Cuál te queda mejor?",
        minuto: 40,
      },
      { de: "CONTACTO", texto: "El jueves a las 15", minuto: 55 },
      {
        de: "PERSONA",
        texto: "Listo, te lo agendo. Traelo con el libro de service si lo tenés.",
        minuto: 58,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Agente, base de conocimiento, QR y automatizaciones
// ---------------------------------------------------------------------------

export const AGENTE = {
  name: "Asistente de ventas",
  goal: "Atender consultas por el stock y agendar pruebas de manejo del Taller Demo.",
  instructions:
    "Instrucciones de ejemplo. Sos el asistente de ventas de una concesionaria de usados y 0 km. " +
    "Saludá por el nombre, respondé con el stock publicado (precios, km, año) y la base de " +
    "conocimiento (horarios, financiación, permuta, garantía). Ofrecé siempre una prueba de manejo " +
    "y registrá la oportunidad. Si preguntan por el taller o por un service, dales los horarios y " +
    "derivá al encargado del taller. No inventes precios: si una unidad es a consultar, decilo.",
  tone: "Cercano y directo, en español rioplatense",
  enabledTools: [
    "search_vehicles",
    "create_opportunity",
    "reserve_vehicle",
    "get_availability",
    "create_booking",
  ],
  channels: ["WHATSAPP", "WEB"] as ConversationChannel[],
};

export const AVISO_DE_EJEMPLO = "Texto de ejemplo del Taller Demo.";

export const BASE_DE_CONOCIMIENTO: { titulo: string; contenido: string }[] = [
  {
    titulo: "Horarios",
    contenido:
      "Casa Central atiende de lunes a viernes de 9 a 18 y los sábados de 9 a 13 (ventas y taller). " +
      "Sucursal Este, de lunes a viernes de 9 a 18 (solo ventas).",
  },
  {
    titulo: "Cómo llegar",
    contenido: `Casa Central: Avenida Ejemplo 1234, Montevideo. Sucursal Este: Ruta Ejemplo km 100, Maldonado. ${AVISO_DE_EJEMPLO}`,
  },
  {
    titulo: "Financiación",
    contenido:
      "Financiamos hasta 60 cuotas con entrega mínima del 30 %. Se aprueba en el día con cédula y " +
      `recibo de sueldo. ${AVISO_DE_EJEMPLO}`,
  },
  {
    titulo: "Permuta",
    contenido:
      "Tomamos tu usado en parte de pago. Lo tasamos en el momento en cualquiera de las dos sucursales.",
  },
  {
    titulo: "Garantía",
    contenido:
      "Todos los usados salen con 6 meses de garantía mecánica y los 0 km con la garantía de fábrica.",
  },
  {
    titulo: "Prueba de manejo",
    contenido:
      "Se agenda con un vendedor, de lunes a sábado en el horario de la sucursal. Hay que traer la libreta de conducir.",
  },
  {
    titulo: "Precios orientativos del taller",
    contenido:
      "Service de 10.000 km desde $ 6.900, service de 20.000 km desde $ 9.800, cambio de aceite y " +
      `filtro $ 3.900, alineación y balanceo $ 4.200. Son precios de ejemplo. ${AVISO_DE_EJEMPLO}`,
  },
  {
    titulo: "Qué incluye el service de 10.000 km",
    contenido:
      "Cambio de aceite y filtro de aceite, revisión de frenos, niveles, luces y presión de cubiertas, " +
      "y control de 20 puntos. Dura unas dos horas.",
  },
];

export const QR_DE_RESENA = {
  name: "Reseñas de Google (ejemplo)",
  destinationUrl: "https://example.com/resenas",
};

export const NOMBRE_DE_LAS_REGLAS = {
  recordatorio: "Recordatorio de próximo service",
  recambio: "Se acerca el recambio → tarea al vendedor",
  ventaGanada: "Venta ganada → tarea de agradecimiento",
  resena: "Reseña por QR tras la venta",
};

export const REGLA_DEL_RECORDATORIO = {
  offsetDays: 7,
  messageText: TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE,
};

export const REGLA_DEL_RECAMBIO = {
  subject: "Contactar por el recambio de su vehículo",
  daysUntilDue: 3,
};

export const REGLA_DE_LA_VENTA_GANADA = {
  subject: "Agradecer la compra y pedir una reseña",
  daysUntilDue: 2,
};

/** La demora del QR tras la venta (3 horas), inactiva: se explica, no se muestra. */
export const DEMORA_DEL_QR_MIN = 180;
