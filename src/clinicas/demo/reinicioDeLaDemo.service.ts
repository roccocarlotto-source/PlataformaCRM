import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { NO_ES_UNA_DEMO } from "../../services/modoDemo.service";
import { AppError } from "../../utils/AppError";
import { reglaDelRecordatorio } from "../recordatorios/programacion.service";
import {
  esSlugDeClinicaDemo,
  PRESTACIONES,
  PROFESIONALES,
  type ClaveDePrestacion,
  type ClaveDeProfesional,
} from "./config";
import {
  cargarDatosDeUso,
  type ActorDeLaDemo,
  type ConfiguracionDeLaDemo,
  type ProfesionalDeLaDemo,
  type ResumenDeDatosDeUso,
} from "./datosDeEjemplo";

// ---------------------------------------------------------------------------
// Reiniciar los datos de una Clínica Demo (docs/rubros.md §12.3), por un
// platform admin: POST /api/admin/organizations/:organizationId/demo/reiniciar.
//
// Para dejar la demo como recién creada antes de mostrársela a otra clínica:
// BORRA los datos de uso y vuelve a cargar los de ejemplo con fechas
// relativas a hoy. NO TOCA la configuración: la organización y su
// ClinicSettings (aviso de privacidad incluido), las sedes con su horario y su
// ClinicBranchSettings, los profesionales con su horario y sus sobreturnos,
// las prestaciones con sus profesionales y su control, la base de
// conocimiento, los agentes (y sus tokens del widget), las automatizaciones,
// los QR, los usuarios y las invitaciones. Tampoco el registro de uso del
// modelo (llm_turn_usages): no referencia a nada que se borre.
//
// SOLO UNA DEMO: is_demo (lo exige el despacho, src/services/reinicioDeDemo.service.ts),
// rubro CLINICA y slug de la demo (esSlugDeClinicaDemo). Es un borrado
// definitivo; con cualquier otra organización, 400 sin tocar nada.
//
// NADA SALE DE LA PLATAFORMA. Los turnos nuevos se crean por los services,
// como en el alta, y emiten booking.created. Sin regla del recordatorio activa
// ese evento no agenda nada (SIN_REGLA); por eso, si la regla está activa, 409
// antes de borrar. Lo mismo con Google Calendar conectado: cada turno nuevo se
// escribiría en un calendario real y los borrados quedarían ahí.
//
// EL BORRADO ES UNA SOLA TRANSACCIÓN, acotada por organizationId en cada
// sentencia, hijas antes que madres (ver borrarDatosDeUso). La recarga va
// después, por los services, cada uno con su transacción: si falla a mitad,
// 500 y la demo queda con parte de los datos; se vuelve a reiniciar.
// Dos reinicios simultáneos desde el botón: el segundo recibe 409 mientras
// corre el primero (src/services/reinicioDeDemo.service.ts). Llamando a esta
// función directo no hay candado: la misma carrera aceptada que el alta.
// ---------------------------------------------------------------------------

export { NO_ES_UNA_DEMO };
export const DEMO_CON_RECORDATORIO_ACTIVO =
  "La regla del recordatorio de la demo está activa: desactivala antes de reiniciar, así los turnos nuevos no programan mensajes.";
export const DEMO_CON_GOOGLE =
  "La demo tiene Google Calendar conectado: desconectalo antes de reiniciar, así los turnos nuevos no se escriben en un calendario real.";
export const DEMO_SIN_ADMIN =
  "La demo no tiene ningún administrador activo: no hay con quién cargar los datos de ejemplo.";

export function demoSinConfiguracion(faltan: string[]): string {
  return `A la demo le faltan profesionales o prestaciones de ejemplo (${faltan.join(", ")}): no se pueden volver a cargar los turnos.`;
}

/** Las filas borradas, por tabla. */
export interface DatosDeUsoBorrados {
  respuestasDelAgente: number;
  seguimientosDeConsultas: number;
  mensajes: number;
  conversaciones: number;
  mensajesDeTurnos: number;
  seguimientosDeQr: number;
  seguimientosDeCupones: number;
  cupones: number;
  tareas: number;
  turnos: number;
  oportunidades: number;
  identidadesDeCanal: number;
  eventosDeIngesta: number;
  vinculosDeImportacion: number;
  pacientes: number;
  bloqueos: number;
  ejecucionesDeAutomatizaciones: number;
  eventosDeSalida: number;
}

export interface ResultadoDelReinicio {
  organizationId: string;
  borrados: DatosDeUsoBorrados;
  cargados: ResumenDeDatosDeUso;
}

/** El reinicio en dos tiempos (reinicio en segundo plano,
 *  src/services/reinicioDeDemo.service.ts): primero TODO lo que puede impedir
 *  la recarga, sin escribir nada (400/409 enseguida, en el POST); devuelve el
 *  borrado y la recarga. */
export async function prepararReinicioDeLaDemo(
  organizationId: string,
  opciones: { ahora?: Date } = {},
): Promise<() => Promise<ResultadoDelReinicio>> {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { id: true, slug: true, industry: true },
  });
  if (!org) throw new AppError("Organización no encontrada", 404);
  if (org.industry !== "CLINICA" || !esSlugDeClinicaDemo(org.slug)) {
    throw new AppError(NO_ES_UNA_DEMO, 400);
  }

  // Todo lo que puede impedir la recarga se mira ANTES de borrar.
  if (await reglaDelRecordatorio(organizationId)) {
    throw new AppError(DEMO_CON_RECORDATORIO_ACTIVO, 409);
  }
  const conGoogle = await prisma.googleCalendarConnection.count({
    where: { organizationId, status: { not: "REVOKED" } },
  });
  if (conGoogle > 0) throw new AppError(DEMO_CON_GOOGLE, 409);
  const admin = await prisma.user.findFirst({
    where: { organizationId, deletedAt: null, isActive: true, role: { name: "ADMIN" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!admin) throw new AppError(DEMO_SIN_ADMIN, 409);
  const configuracion = await configuracionDeLaDemo(organizationId);
  const actor: ActorDeLaDemo = { userId: admin.id, role: "ADMIN", industry: "CLINICA" };

  return async () => {
    const borrados = await borrarDatosDeUso(organizationId);
    const cargados = await cargarDatosDeUso(organizationId, configuracion, actor, opciones.ahora);
    logger.info({ organizationId, borrados, cargados }, "Clínica Demo reiniciada");
    return { organizationId, borrados, cargados };
  };
}

/** Los profesionales y las prestaciones de la demo, por su nombre de
 *  config.ts. Si alguien borró o renombró uno, 409 (antes de borrar nada). */
async function configuracionDeLaDemo(organizationId: string): Promise<ConfiguracionDeLaDemo> {
  const recursos = await prisma.resource.findMany({
    where: {
      organizationId,
      deletedAt: null,
      name: { in: Object.values(PROFESIONALES).map((p) => p.nombre) },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, branchId: true, allowsOverbooking: true },
  });
  const servicios = await prisma.serviceType.findMany({
    where: {
      organizationId,
      deletedAt: null,
      name: { in: Object.values(PRESTACIONES).map((p) => p.nombre) },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });

  const faltan: string[] = [];
  const profesionales = {} as Record<ClaveDeProfesional, ProfesionalDeLaDemo>;
  for (const [clave, datos] of Object.entries(PROFESIONALES) as [
    ClaveDeProfesional,
    (typeof PROFESIONALES)[ClaveDeProfesional],
  ][]) {
    const recurso = recursos.find((r) => r.name === datos.nombre);
    if (!recurso) faltan.push(datos.nombre);
    else profesionales[clave] = recurso;
  }
  const prestaciones = {} as Record<ClaveDePrestacion, string>;
  for (const [clave, datos] of Object.entries(PRESTACIONES) as [
    ClaveDePrestacion,
    (typeof PRESTACIONES)[ClaveDePrestacion],
  ][]) {
    const servicio = servicios.find((s) => s.name === datos.nombre);
    if (!servicio) faltan.push(datos.nombre);
    else prestaciones[clave] = servicio.id;
  }
  if (faltan.length > 0) throw new AppError(demoSinConfiguracion(faltan), 409);
  return { profesionales, prestaciones };
}

/**
 * Borra los datos de uso de UNA organización, en una transacción. El orden
 * sale de las FKs (todas compuestas con organization_id, la mayoría
 * RESTRICT o NO ACTION): hijas antes que madres.
 *
 *   agent_inbound_jobs          → messages
 *   inquiry_follow_ups          → conversations, contacts
 *   messages                    → conversations
 *   conversations               → contacts
 *   booking_messages            → bookings, contacts
 *   qr_follow_ups               → contacts, opportunities
 *   discount_voucher_follow_ups → discount_vouchers, contacts, opportunities
 *   discount_vouchers           → contacts, opportunities
 *   activities                  → bookings (source_booking_id), contacts, opportunities
 *   bookings                    → contacts, opportunities
 *   opportunities               → contacts
 *   contact_channel_identities  → contacts
 *   ingestion_events            → contacts (promoted_contact_id)
 *   contacts                    (merged_into_id es de la misma tabla: una sola sentencia)
 *
 * Y lo que no tiene FK a nada de lo anterior pero es del uso: los vínculos de
 * importación de contactos y tareas (entity_id sin FK), los bloqueos, las
 * ejecuciones de las automatizaciones y los eventos de salida (incluidos los
 * booking.* de los turnos borrados).
 */
async function borrarDatosDeUso(organizationId: string): Promise<DatosDeUsoBorrados> {
  const where = { organizationId };
  return prisma.$transaction(
    async (tx) => ({
      respuestasDelAgente: (await tx.agentInboundJob.deleteMany({ where })).count,
      seguimientosDeConsultas: (await tx.inquiryFollowUp.deleteMany({ where })).count,
      mensajes: (await tx.message.deleteMany({ where })).count,
      conversaciones: (await tx.conversation.deleteMany({ where })).count,
      mensajesDeTurnos: (await tx.bookingMessage.deleteMany({ where })).count,
      seguimientosDeQr: (await tx.qrFollowUp.deleteMany({ where })).count,
      seguimientosDeCupones: (await tx.discountVoucherFollowUp.deleteMany({ where })).count,
      cupones: (await tx.discountVoucher.deleteMany({ where })).count,
      tareas: (await tx.activity.deleteMany({ where })).count,
      turnos: (await tx.booking.deleteMany({ where })).count,
      oportunidades: (await tx.opportunity.deleteMany({ where })).count,
      identidadesDeCanal: (await tx.contactChannelIdentity.deleteMany({ where })).count,
      eventosDeIngesta: (await tx.ingestionEvent.deleteMany({ where })).count,
      vinculosDeImportacion: (
        await tx.externalRecordLink.deleteMany({
          where: { organizationId, entityType: { in: ["CONTACT", "ACTIVITY"] } },
        })
      ).count,
      pacientes: (await tx.contact.deleteMany({ where })).count,
      bloqueos: (await tx.resourceTimeOff.deleteMany({ where })).count,
      ejecucionesDeAutomatizaciones: (await tx.automationExecution.deleteMany({ where })).count,
      eventosDeSalida: (await tx.outboxEvent.deleteMany({ where })).count,
    }),
    { timeout: 60_000 },
  );
}
