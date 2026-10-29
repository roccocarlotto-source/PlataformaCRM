import { prisma } from "../lib/prisma";
import { filtroDeSedes, type ActorConSedes } from "./permisos";

// ---------------------------------------------------------------------------
// "ENVÍOS QUE NO SALIERON": los mensajes automáticos que agotaron sus
// reintentos (FAILED) y las automatizaciones que agotaron sus intentos
// (DEAD_LETTER), en una sola lista, del más reciente al más viejo.
//
// Es la lista que acompaña a la tarea agrupada de una cola que falla mucho en
// un día (services/tareaPorColaFallida.ts): esa tarea no lleva nombres, y acá
// está cada cliente con su motivo.
//
// QUIÉN LA VE: ADMIN (todo, con filtro por sede) y RECEPCION de clínica (solo
// sus sedes). USER no (la ruta lo corta con authorize). El límite de sede es el
// de siempre, filtroDeSedes: con un filtro de sede activo, solo entran las filas
// de esa sede; las que no tienen sede (QR, automatizaciones) aparecen solo sin
// filtro.
//
// UNA SOLA LISTA DE SEIS TABLAS. Cada tabla trae sus primeras page*pageSize
// filas por fecha; se mezclan, se ordenan y se corta la página. Por eso la
// página tiene tope (ver MAXIMO_DE_FILAS): la lista es para revisar lo
// reciente, no un histórico.
//
// EL MOTIVO NUNCA ES EL ERROR CRUDO: puede traer detalle interno (ids, la
// respuesta de Meta). Se traduce a una frase (motivoLegible).
// ---------------------------------------------------------------------------

export const TIPOS_DE_ENVIO = [
  "SEGUIMIENTO_DE_CONSULTA",
  "QR",
  "CUPON",
  "RECORDATORIO_DE_TURNO",
  "MENSAJE_DEL_TALLER",
  "AUTOMATIZACION",
] as const;
export type TipoDeEnvio = (typeof TIPOS_DE_ENVIO)[number];

// Cuántas filas se pueden recorrer como mucho (page * pageSize).
export const MAXIMO_DE_FILAS = 1000;

export interface EnvioQueNoSalio {
  id: string;
  tipo: TipoDeEnvio;
  fecha: Date;
  contacto: { id: string; nombre: string } | null;
  sede: { id: string; nombre: string } | null;
  motivo: string;
}

interface Fila {
  id: string;
  tipo: TipoDeEnvio;
  fecha: Date;
  contactId: string | null;
  branchId: string | null;
  lastError: string | null;
}

export function motivoLegible(lastError: string | null): string {
  const texto = lastError ?? "";
  const meta = /WhatsApp Graph API returned (\d+)/.exec(texto);
  if (/\b190\b|access token|OAuthException/i.test(texto)) {
    return "La conexión con WhatsApp venció o se revocó";
  }
  if (/131047|re-engagement|24 ?h/i.test(texto)) {
    return "Pasaron más de 24 horas desde el último mensaje del cliente";
  }
  if (/template/i.test(texto) && meta) {
    return "La plantilla de WhatsApp no está disponible";
  }
  if (meta) {
    return Number(meta[1]) >= 500
      ? "WhatsApp no respondió después de varios intentos"
      : "WhatsApp rechazó el envío";
  }
  if (/Agotó sus \d+ intentos/.test(texto)) {
    return "El envío se cortó varias veces sin terminar";
  }
  if (/automatizaciones fallaron|no hay handler/.test(texto)) {
    return "La automatización falló después de varios intentos";
  }
  return "Error técnico: avisale al soporte de la plataforma";
}

function idDelPayload(payload: unknown): string | null {
  const valor = (payload as Record<string, unknown> | null)?.contactId;
  return typeof valor === "string" && /^[0-9a-f-]{36}$/i.test(valor) ? valor : null;
}

export async function listarEnviosQueNoSalieron(
  organizationId: string,
  actor: ActorConSedes,
  query: { page: number; pageSize: number; branchId?: string },
) {
  const filtro = filtroDeSedes(actor, query.branchId);
  const conFiltroDeSede = filtro.branchId !== undefined || filtro.branchIds !== undefined;
  const sedes = filtro.branchId ? [filtro.branchId] : (filtro.branchIds ?? []);
  // El WHERE de sede de las tablas que tienen sede; las que no tienen sede
  // quedan afuera en cuanto hay un filtro.
  const deLaSede = conFiltroDeSede ? { branchId: { in: [...sedes] } } : {};
  const take = Math.min(query.page * query.pageSize, MAXIMO_DE_FILAS);
  const orden = { updatedAt: "desc" as const };
  const base = { organizationId, status: "FAILED" as const };
  const columnas = {
    id: true,
    updatedAt: true,
    contactId: true,
    lastError: true,
  } as const;

  const sinSede = <T>(consulta: () => Promise<T[]>): Promise<T[]> =>
    conFiltroDeSede ? Promise.resolve([]) : consulta();
  const contarSinSede = (consulta: () => Promise<number>): Promise<number> =>
    conFiltroDeSede ? Promise.resolve(0) : consulta();

  const [consultas, qr, cupones, recordatorios, taller, automatizaciones] = await Promise.all([
    prisma.inquiryFollowUp.findMany({
      where: { ...base, ...deLaSede },
      select: { ...columnas, branchId: true },
      orderBy: orden,
      take,
    }),
    sinSede(() =>
      prisma.qrFollowUp.findMany({ where: base, select: columnas, orderBy: orden, take }),
    ),
    prisma.discountVoucherFollowUp.findMany({
      where: { ...base, ...deLaSede },
      select: { ...columnas, branchId: true },
      orderBy: orden,
      take,
    }),
    prisma.bookingMessage.findMany({
      where: { ...base, ...(conFiltroDeSede ? { booking: deLaSede } : {}) },
      select: { ...columnas, booking: { select: { branchId: true } } },
      orderBy: orden,
      take,
    }),
    prisma.serviceMessage.findMany({
      where: { ...base, ...deLaSede },
      select: { ...columnas, branchId: true },
      orderBy: orden,
      take,
    }),
    sinSede(() =>
      prisma.outboxEvent.findMany({
        where: { organizationId, status: "DEAD_LETTER" },
        select: { id: true, updatedAt: true, payload: true, lastError: true },
        orderBy: orden,
        take,
      }),
    ),
  ]);

  const total = await Promise.all([
    prisma.inquiryFollowUp.count({ where: { ...base, ...deLaSede } }),
    contarSinSede(() => prisma.qrFollowUp.count({ where: base })),
    prisma.discountVoucherFollowUp.count({ where: { ...base, ...deLaSede } }),
    prisma.bookingMessage.count({
      where: { ...base, ...(conFiltroDeSede ? { booking: deLaSede } : {}) },
    }),
    prisma.serviceMessage.count({ where: { ...base, ...deLaSede } }),
    contarSinSede(() =>
      prisma.outboxEvent.count({ where: { organizationId, status: "DEAD_LETTER" } }),
    ),
  ]).then((cuentas) => cuentas.reduce((a, b) => a + b, 0));

  const filas: Fila[] = [
    ...consultas.map((f) => fila(f, "SEGUIMIENTO_DE_CONSULTA", f.branchId)),
    ...qr.map((f) => fila(f, "QR", null)),
    ...cupones.map((f) => fila(f, "CUPON", f.branchId)),
    ...recordatorios.map((f) => fila(f, "RECORDATORIO_DE_TURNO", f.booking.branchId)),
    ...taller.map((f) => fila(f, "MENSAJE_DEL_TALLER", f.branchId)),
    ...automatizaciones.map((f): Fila => ({
      id: f.id,
      tipo: "AUTOMATIZACION",
      fecha: f.updatedAt,
      contactId: idDelPayload(f.payload),
      branchId: null,
      lastError: f.lastError,
    })),
  ]
    .sort((a, b) => b.fecha.getTime() - a.fecha.getTime() || a.id.localeCompare(b.id))
    .slice((query.page - 1) * query.pageSize, take);

  const contactIds = [...new Set(filas.flatMap((f) => (f.contactId ? [f.contactId] : [])))];
  const branchIds = [...new Set(filas.flatMap((f) => (f.branchId ? [f.branchId] : [])))];
  const [contactos, sucursales] = await Promise.all([
    prisma.contact.findMany({
      where: { organizationId, id: { in: contactIds }, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.branch.findMany({
      where: { organizationId, id: { in: branchIds } },
      select: { id: true, name: true },
    }),
  ]);
  const nombreDelContacto = new Map(
    contactos.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim() || "Sin nombre"]),
  );
  const nombreDeLaSede = new Map(sucursales.map((s) => [s.id, s.name]));

  const data: EnvioQueNoSalio[] = filas.map((f) => {
    const nombre = f.contactId ? nombreDelContacto.get(f.contactId) : undefined;
    const sede = f.branchId ? nombreDeLaSede.get(f.branchId) : undefined;
    return {
      id: f.id,
      tipo: f.tipo,
      fecha: f.fecha,
      // Un contacto borrado no se muestra ni se linkea.
      contacto: f.contactId && nombre !== undefined ? { id: f.contactId, nombre } : null,
      sede: f.branchId && sede !== undefined ? { id: f.branchId, nombre: sede } : null,
      motivo: motivoLegible(f.lastError),
    };
  });

  const recorrible = Math.min(total, MAXIMO_DE_FILAS);
  return {
    data,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: recorrible === 0 ? 0 : Math.ceil(recorrible / query.pageSize),
    },
  };
}

function fila(
  f: { id: string; updatedAt: Date; contactId: string; lastError: string | null },
  tipo: TipoDeEnvio,
  branchId: string | null,
): Fila {
  return {
    id: f.id,
    tipo,
    fecha: f.updatedAt,
    contactId: f.contactId,
    branchId,
    lastError: f.lastError,
  };
}
