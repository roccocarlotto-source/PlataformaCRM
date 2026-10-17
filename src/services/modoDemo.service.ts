import { randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "../lib/logger";
import { prisma, type Db } from "../lib/prisma";
import { findPlatformAdminByUserId } from "../repositories/platformAdmin.repository";
import { AppError } from "../utils/AppError";
import type { SendMetaText } from "./metaSend.service";
import type { SendWhatsappTemplate, SendWhatsappText } from "./whatsappGraph.service";
import type { DepsDePlantillas } from "./whatsappTemplate.service";

// ---------------------------------------------------------------------------
// Modo demo de una organización (docs-privados/taller-demo-diseno.md §2,
// local): organizations.is_demo. Cuando es true, NADA SALE DE LA PLATAFORMA
// hacia una persona:
//
//   - los envíos a WhatsApp, Messenger e Instagram se SIMULAN: no hay HTTP y
//     la fila queda como enviada con un id externo `demo:<uuid>`
//     (PREFIJO_DEL_ID_SIMULADO), que es como el frontend la marca "Simulado";
//   - las plantillas de WhatsApp quedan APPROVED sin pasar por Meta;
//   - lo que conecta algo real responde 409: invitar (salvo un platform
//     admin), conectar una página de Facebook o un Google Calendar, asignar
//     un número o una página al agente, dar de alta un WABA.
//
// DÓNDE SE CORTA. Todo envío real es una función `*Real` que entra por el
// objeto `deps` de cada worker o service (whatsappGraph.service.ts,
// metaSend.service.ts). Esos sitios conocen la organización; las funciones
// de HTTP no. Por eso la guardia es salidasPara(organizationId, deps): la
// misma referencia si no es demo, las simuladas si lo es. Que ningún envío
// nuevo se la salte lo vigila modoDemo.catalogo.test.ts, que exige que cada
// `*Real` exportada esté clasificada acá.
//
// PARA UNA ORGANIZACIÓN QUE NO ES DEMO la única diferencia es una lectura por
// PK antes de cada envío. Sin caché a propósito: los envíos son pocos y la
// bandera cambia solo al crear una demo.
// ---------------------------------------------------------------------------

export const PREFIJO_DEL_ID_SIMULADO = "demo:";

export function idSimulado(): string {
  return `${PREFIJO_DEL_ID_SIMULADO}${randomUUID()}`;
}

export function esIdSimulado(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(PREFIJO_DEL_ID_SIMULADO);
}

const uuidSchema = z.string().uuid();

/** Si la organización es una demo. Un id que no es un UUID no es ninguna
 *  organización: false sin tocar la base (los unitarios de los workers usan
 *  ids como "org-1" y corren sin base en el CI). */
export async function esOrganizacionDemo(
  organizationId: string,
  db: Db = prisma,
): Promise<boolean> {
  if (!uuidSchema.safeParse(organizationId).success) return false;
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { isDemo: true },
  });
  return org?.isDemo === true;
}

// ---------------------------------------------------------------------------
// Envíos de mensajes
// ---------------------------------------------------------------------------

/** Las salidas que una guardia reemplaza. Cada worker tiene un `deps` con
 *  más cosas (tokens, lecturas); acá solo importan las que mandan. */
export interface SalidasDeMensajes {
  sendText?: SendWhatsappText;
  sendTemplate?: SendWhatsappTemplate;
  sendMetaText?: SendMetaText;
  // Quién decide si la organización es demo. Sin pasarlo, la base. Es para
  // que un unitario de un worker pueda fijarlo sin tocar Prisma.
  esOrganizacionDemo?: (organizationId: string) => Promise<boolean>;
}

function registrar(canal: string, organizationId: string | undefined, destino: string) {
  logger.info({ organizationId, canal, destino }, "Envío simulado (modo demo)");
}

/** Las versiones simuladas: mismo contrato, sin HTTP. El organizationId es
 *  solo para el log; el id devuelto es el que marca la fila como simulada. */
export type SalidasSimuladas = Required<
  Pick<SalidasDeMensajes, "sendText" | "sendTemplate" | "sendMetaText">
>;

export function salidasSimuladas(organizationId?: string): SalidasSimuladas {
  return {
    sendText: (input) => {
      registrar("whatsapp-texto", organizationId, input.to);
      return Promise.resolve({ wamid: idSimulado() });
    },
    sendTemplate: (input) => {
      registrar("whatsapp-plantilla", organizationId, input.to);
      return Promise.resolve({ wamid: idSimulado() });
    },
    sendMetaText: (input) => {
      registrar("meta", organizationId, input.recipientId);
      return Promise.resolve();
    },
  };
}

export interface OpcionesDeGuardia {
  // Inyectable para los tests unitarios; producción lee la base.
  esDemo?: (organizationId: string) => Promise<boolean>;
}

/**
 * La guardia de los envíos. Devuelve EL MISMO objeto si la organización no es
 * demo (ni una copia: cero diferencia para un cliente), o una copia con las
 * salidas presentes reemplazadas por las simuladas si lo es. Solo reemplaza
 * las claves que el `deps` trae: un worker que no manda texto no gana un
 * sendText.
 */
export async function salidasPara<T extends SalidasDeMensajes>(
  organizationId: string,
  deps: T,
  opciones: OpcionesDeGuardia = {},
): Promise<T> {
  const decide = opciones.esDemo ?? deps.esOrganizacionDemo ?? esOrganizacionDemo;
  if (!(await decide(organizationId))) return deps;
  const simuladas = salidasSimuladas(organizationId);
  const reemplazo: SalidasDeMensajes = {};
  if (deps.sendText) reemplazo.sendText = simuladas.sendText;
  if (deps.sendTemplate) reemplazo.sendTemplate = simuladas.sendTemplate;
  if (deps.sendMetaText) reemplazo.sendMetaText = simuladas.sendMetaText;
  return { ...deps, ...reemplazo };
}

// ---------------------------------------------------------------------------
// Plantillas de WhatsApp en Meta
// ---------------------------------------------------------------------------

/** Las llamadas a Meta de las plantillas, simuladas: el alta devuelve una
 *  plantilla APPROVED con id `demo:…` (así la regla queda "Aprobada" y el
 *  envío simulado tiene plantilla), la imagen de muestra un handle de
 *  mentira, el estado APPROVED y el borrado nada. Lo demás del `deps`
 *  (tokens, WABA, rubro, nombres) se conserva: no llama a nadie. */
export function plantillasSimuladas(
  deps: DepsDePlantillas,
  organizationId?: string,
): DepsDePlantillas {
  return {
    ...deps,
    create: (input) => {
      registrar("plantilla-alta", organizationId, input.name);
      return Promise.resolve({ id: idSimulado(), status: "APPROVED" });
    },
    uploadSample: () => Promise.resolve(`${PREFIJO_DEL_ID_SIMULADO}handle`),
    getStatus: () => Promise.resolve({ status: "APPROVED", rejectedReason: null }),
    delete: () => Promise.resolve(),
  };
}

export async function depsDePlantillasPara(
  organizationId: string,
  deps: DepsDePlantillas,
  opciones: OpcionesDeGuardia = {},
): Promise<DepsDePlantillas> {
  const esDemo = await (opciones.esDemo ?? esOrganizacionDemo)(organizationId);
  return esDemo ? plantillasSimuladas(deps, organizationId) : deps;
}

// ---------------------------------------------------------------------------
// Lo que conecta algo real: 409
// ---------------------------------------------------------------------------

export function mensajeDeModoDemo(accion: string): string {
  return `Esta organización está en modo demo: no se puede ${accion}. Los mensajes se simulan y nada sale de la plataforma.`;
}

/** 409 si la organización es demo. `accion` va en infinitivo, para el
 *  mensaje: "conectar una página de Facebook". */
export async function exigirQueNoSeaDemo(
  organizationId: string,
  accion: string,
  db: Db = prisma,
): Promise<void> {
  if (await esOrganizacionDemo(organizationId, db)) {
    throw new AppError(mensajeDeModoDemo(accion), 409);
  }
}

export const MENSAJE_INVITACION_EN_DEMO =
  "Esta organización está en modo demo: solo un administrador de la plataforma puede invitar usuarios.";

/** Invitar en una demo: solo un platform admin (es como se crean los
 *  usuarios de la demo). Sin actor conocido, se trata como no admin. */
export async function exigirInvitacionPermitidaEnDemo(
  organizationId: string,
  actorUserId: string | undefined,
  db: Db = prisma,
): Promise<void> {
  if (!(await esOrganizacionDemo(organizationId, db))) return;
  const admin = actorUserId ? await findPlatformAdminByUserId(actorUserId, db) : null;
  if (!admin) throw new AppError(MENSAJE_INVITACION_EN_DEMO, 409);
}
