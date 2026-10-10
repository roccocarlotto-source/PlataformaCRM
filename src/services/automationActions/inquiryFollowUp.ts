import {
  ActivityType,
  ConversationChannel,
  ConversationStatus,
  InquiryFollowUpKind,
  InquiryFollowUpStatus,
} from "@prisma/client";
import { z } from "zod";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { createActivity as createActivityRepo } from "../../repositories/activity.repository";
import { findConversationById } from "../../repositories/conversation.repository";
import {
  agendarInquiryFollowUp,
  existsInboundSince,
  type AgendarInquiryFollowUpData,
} from "../../repositories/inquiryFollowUp.repository";
import { findLastMessages, humanSpokeLast } from "../../repositories/message.repository";
import { countOpenOpportunitiesOf } from "../../repositories/opportunity.repository";
import { findOldestActiveAdmin } from "../../repositories/user.repository";
import { nombreUsableDelContacto } from "../agentOrchestration.service";
import type { AccionRegistrada } from "../automationActions";
import { TRIGGER_CONTACT_INQUIRY_STALLED } from "../automationTriggers";
import {
  LARGO_MAXIMO_DEL_CUERPO,
  VARIABLES_DE_CONSULTA,
  validarTextoDePlantilla,
} from "../../utils/whatsappTemplateText";
import { fechaDeVencimiento } from "./createFollowUpActivity";
import { findEdicionYRubro } from "../../repositories/organization.repository";
import {
  MOTIVO_TURNO_DEL_PACIENTE,
  prestacionParaElMensaje,
  turnoFrenaElSeguimiento,
} from "../../clinicas/seguimientoDeConsultas";
import { VARIABLES_DE_CONSULTA_DE_CLINICA } from "../../utils/whatsappTemplateText";

// ---------------------------------------------------------------------------
// Acción `inquiry.follow_up` (ítem 185 de docs/frontend-cambios-pendientes
// .md): cuando un contacto consultó y lleva X días callado (trigger
// contact.inquiry_stalled), retomarlo. Qué se hace depende del CANAL por el
// que escribió y de quién lo atiende:
//
//   - WhatsApp, sin una persona atendiendo: se AGENDA un WhatsApp (una fila
//     en inquiry_follow_ups) que el worker (inquiryFollowUpWorker.ts) manda
//     dentro del horario de la sucursal, con la plantilla aprobada de la
//     regla o, dentro de las 24 h del último mensaje, un texto libre del
//     agente. El mismo molde que el cupón: la acción no manda nada.
//   - Messenger, Instagram, widget, o una conversación derivada en la que
//     una persona ya le escribió (decisión de Rocco, 08/10/2026): una TAREA
//     para el vendedor asignado —o el ADMIN activo más antiguo— con el
//     resumen de lo que preguntó. Se crea en el acto, en la misma transacción
//     que la fila (que nace SENT: es el contador de seguimientos).
//
// IDEMPOTENTE POR (regla, contacto, evento): la reentrega del evento choca
// contra el UNIQUE y no agenda ni crea nada. Antes de agendar se RELEE el
// mundo —el contacto pudo responder, marcarse sin interés o abrir una
// oportunidad entre el barrido y el despacho— y en esos casos termina sin
// efecto y sin error.
// ---------------------------------------------------------------------------

export const ACTION_INQUIRY_FOLLOW_UP = "inquiry.follow_up";

// El texto del WhatsApp, con {saludo} y, si quiere, {vehiculo}. Lo escribe el
// negocio; este es el default razonable con el que arranca una regla nueva
// (espejo en frontend/src/features/automation/catalog.ts).
export const TEXTO_POR_DEFECTO =
  "¡{saludo}! Te escribimos por tu consulta sobre {vehiculo}. ¿Seguís interesado? Si querés, te ayudamos a coordinar una visita o un test drive.";

function configDeSeguimiento(variables: typeof VARIABLES_DE_CONSULTA) {
  return z
    .object({
      messageText: z
        .string({
          required_error: "messageText es requerido",
          invalid_type_error: "messageText debe ser un texto",
        })
        .trim()
        .min(1, "messageText es requerido")
        .max(LARGO_MAXIMO_DEL_CUERPO * 2, "messageText es demasiado largo"),
    })
    .superRefine((config, ctx) => {
      const problema = validarTextoDePlantilla(config.messageText, { variables });
      if (problema) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["messageText"], message: problema });
      }
    });
}

export const configDeSeguimientoDeConsultaSchema = configDeSeguimiento(VARIABLES_DE_CONSULTA);
// R15 (docs/rubros.md §9.1): en una clínica, {prestacion} en lugar de {vehiculo}.
export const configDeSeguimientoDeConsultaDeClinicaSchema = configDeSeguimiento(
  VARIABLES_DE_CONSULTA_DE_CLINICA,
);

// Lo que emite el barrido (inquiryStalledWorker.ts). Se valida acá, en el
// consumidor, como el payload de las otras acciones.
export const payloadDeConsultaSchema = z.object({
  contactId: z.string().uuid(),
  conversationId: z.string().uuid(),
  channel: z.nativeEnum(ConversationChannel),
  branchId: z.string().uuid(),
  ownerId: z.string().uuid().nullable(),
  lastInboundAt: z.coerce.date(),
});

export type PayloadDeConsulta = z.infer<typeof payloadDeConsultaSchema>;

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const MAX_SUBJECT = 255;
// Cuántos mensajes del cliente van en el resumen de la tarea: los últimos.
export const MENSAJES_EN_EL_RESUMEN = 3;
const LARGO_DE_CADA_MENSAJE = 300;

export interface ContactoParaSeguimiento {
  id: string;
  firstName: string;
  lastName: string;
  ownerId: string | null;
  deletedAt: Date | null;
  noInterestAt: Date | null;
  leadServiceOfInterest: string | null;
  vehicleOfInterest: { make: string; model: string; trim: string | null; year: number } | null;
}

export interface MensajeDelCliente {
  content: string;
  createdAt: Date;
}

// Pura: con qué se describe lo que el cliente consultó, para el WhatsApp
// ({vehiculo}) y para la tarea. La unidad de interés si la hay; si no, lo
// último que buscó (leadServiceOfInterest, que search_vehicles guarda); si no,
// un texto genérico. Sin artículo ("la Hilux", "el Corolla"): el género no se
// sabe, y "sobre Toyota Hilux SRV 2022" se lee bien.
export function vehiculoParaElMensaje(
  contacto: Pick<ContactoParaSeguimiento, "vehicleOfInterest" | "leadServiceOfInterest">,
): string {
  const unidad = contacto.vehicleOfInterest;
  if (unidad) {
    return [unidad.make, unidad.model, unidad.trim, String(unidad.year)]
      .filter((parte) => parte && parte.trim().length > 0)
      .join(" ");
  }
  const buscado = contacto.leadServiceOfInterest?.trim();
  return buscado && buscado.length > 0 ? buscado : "el vehículo que consultaste";
}

function diasSin(desde: Date, ahora: Date): number {
  return Math.max(0, Math.floor((ahora.getTime() - desde.getTime()) / MS_POR_DIA));
}

const NOMBRE_DEL_CANAL: Record<ConversationChannel, string> = {
  WHATSAPP: "WhatsApp",
  MESSENGER: "Messenger",
  INSTAGRAM: "Instagram",
  WEB: "el sitio web",
};

// Pura: el asunto y el cuerpo de la tarea para el vendedor. El resumen son
// los últimos mensajes del cliente, tal cual los escribió (recortados), con
// la unidad que le interesa y hace cuántos días no responde.
export function tareaDeSeguimiento(
  contacto: ContactoParaSeguimiento,
  canal: ConversationChannel,
  mensajes: MensajeDelCliente[],
  lastInboundAt: Date,
  ahora: Date,
  // R15: en una clínica, la prestación. Sin pasarlo, el vehículo de siempre.
  interes: string = vehiculoParaElMensaje(contacto),
): { subject: string; body: string } {
  const nombre = nombreUsableDelContacto(contacto) ?? "consulta sin identificar";
  const dias = diasSin(lastInboundAt, ahora);
  const lineas = [
    `Consultó por ${NOMBRE_DEL_CANAL[canal]} y hace ${String(dias)} ${dias === 1 ? "día" : "días"} que no responde.`,
    `Le interesa: ${interes}.`,
  ];
  const ultimos = mensajes.slice(-MENSAJES_EN_EL_RESUMEN);
  if (ultimos.length > 0) {
    lineas.push("Lo que preguntó:");
    for (const mensaje of ultimos) {
      const texto = mensaje.content.trim().slice(0, LARGO_DE_CADA_MENSAJE);
      lineas.push(`- ${mensaje.createdAt.toISOString().slice(0, 10)}: «${texto}»`);
    }
  }
  return {
    subject: `Seguimiento de consulta: ${nombre}`.slice(0, MAX_SUBJECT),
    body: lineas.join("\n"),
  };
}

// Pura: qué tipo de seguimiento corresponde. WhatsApp manda un mensaje salvo
// que una persona esté atendiendo la conversación (derivada y con un mensaje
// humano después del último del agente): ahí la tarea es para esa persona.
export function tipoDeSeguimiento(
  channel: ConversationChannel,
  conversacion: { status: ConversationStatus } | null,
  humanoHabloUltimo: boolean,
): InquiryFollowUpKind {
  const atendida =
    conversacion?.status === ConversationStatus.TRANSFERRED_TO_HUMAN && humanoHabloUltimo;
  return channel === ConversationChannel.WHATSAPP && !atendida
    ? InquiryFollowUpKind.WHATSAPP
    : InquiryFollowUpKind.TASK;
}

export interface TareaACrear {
  assigneeId: string;
  contactId: string;
  subject: string;
  body: string;
  dueDate: Date;
}

// Inyectables para el test unitario, mismo patrón que las otras acciones.
export interface DependenciasDelSeguimientoDeConsulta {
  leerContacto: (
    contactId: string,
    organizationId: string,
  ) => Promise<ContactoParaSeguimiento | null>;
  leerConversacion: (
    conversationId: string,
    organizationId: string,
  ) => Promise<{ status: ConversationStatus; assignedUserId: string | null } | null>;
  humanoHabloUltimo: (conversationId: string, organizationId: string) => Promise<boolean>;
  hayOportunidadAbierta: (contactId: string, organizationId: string) => Promise<boolean>;
  respondioDespues: (organizationId: string, contactId: string, desde: Date) => Promise<boolean>;
  mensajesDelCliente: (
    conversationId: string,
    organizationId: string,
  ) => Promise<MensajeDelCliente[]>;
  // El primer id de la lista que sea un usuario activo de la organización, o
  // el ADMIN activo más antiguo; null si no hay a quién asignarle la tarea.
  resolverAsignado: (
    organizationId: string,
    candidatos: (string | null)[],
  ) => Promise<string | null>;
  // true si agendó; false si ya había uno para (regla, contacto, evento).
  agendar: (data: AgendarInquiryFollowUpData) => Promise<boolean>;
  // La fila SENT y la tarea, atómicas. false si ya había una.
  agendarYCrearTarea: (data: AgendarInquiryFollowUpData, tarea: TareaACrear) => Promise<boolean>;
  // R15: si la organización es una clínica, y si un turno del contacto frena
  // el seguimiento (docs/rubros.md §9.1). En una automotora no se lee nada.
  esClinica: (organizationId: string) => Promise<boolean>;
  turnoFrena: (
    organizationId: string,
    automationId: string,
    contactId: string,
    ahora: Date,
  ) => Promise<boolean>;
  ahora: () => Date;
}

async function resolverAsignadoReal(
  organizationId: string,
  candidatos: (string | null)[],
): Promise<string | null> {
  for (const id of candidatos) {
    if (!id) continue;
    const usuario = await prisma.user.findFirst({
      where: { id, organizationId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (usuario) return usuario.id;
  }
  return (await findOldestActiveAdmin(organizationId))?.id ?? null;
}

const dependenciasReales: DependenciasDelSeguimientoDeConsulta = {
  leerContacto: (contactId, organizationId) =>
    prisma.contact.findFirst({
      where: { id: contactId, organizationId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        ownerId: true,
        deletedAt: true,
        noInterestAt: true,
        leadServiceOfInterest: true,
        vehicleOfInterest: { select: { make: true, model: true, trim: true, year: true } },
      },
    }),
  leerConversacion: (conversationId, organizationId) =>
    findConversationById(conversationId, organizationId).then((c) =>
      c ? { status: c.status, assignedUserId: c.assignedUserId } : null,
    ),
  humanoHabloUltimo: humanSpokeLast,
  hayOportunidadAbierta: (contactId, organizationId) =>
    countOpenOpportunitiesOf({ contactId }, organizationId).then((n) => n > 0),
  respondioDespues: existsInboundSince,
  mensajesDelCliente: (conversationId, organizationId) =>
    findLastMessages(conversationId, organizationId, 40).then((mensajes) =>
      mensajes
        .filter((m) => m.direction === "INBOUND")
        .map((m) => ({ content: m.content, createdAt: m.createdAt })),
    ),
  resolverAsignado: resolverAsignadoReal,
  agendar: (data) => agendarInquiryFollowUp(data),
  agendarYCrearTarea: (data, tarea) =>
    prisma.$transaction(async (tx) => {
      const agendado = await agendarInquiryFollowUp(data, tx);
      if (!agendado) return false;
      // Por el repositorio y no por createActivity del service: el service no
      // acepta una transacción, y acá la fila y la tarea tienen que ir
      // juntas. El asignado ya se validó (resolverAsignado); el autor es el
      // propio asignado, como en activity.create_follow_up.
      await createActivityRepo(
        {
          organizationId: data.organizationId,
          type: ActivityType.TASK,
          authorId: tarea.assigneeId,
          assigneeId: tarea.assigneeId,
          contactId: tarea.contactId,
          companyId: null,
          opportunityId: null,
          subject: tarea.subject,
          body: tarea.body,
          dueDate: tarea.dueDate,
        },
        tx,
      );
      return true;
    }),
  esClinica: (organizationId) =>
    findEdicionYRubro(organizationId).then((o) => o.industry === "CLINICA"),
  turnoFrena: (organizationId, automationId, contactId, ahora) =>
    turnoFrenaElSeguimiento(organizationId, automationId, contactId, ahora, true),
  ahora: () => new Date(),
};

export function crearAccionSeguimientoDeConsulta(
  deps: DependenciasDelSeguimientoDeConsulta = dependenciasReales,
): AccionRegistrada {
  return {
    actionType: ACTION_INQUIRY_FOLLOW_UP,
    schema: configDeSeguimientoDeConsultaSchema,
    schemaPorRubro: { CLINICA: configDeSeguimientoDeConsultaDeClinicaSchema },
    triggers: [TRIGGER_CONTACT_INQUIRY_STALLED],
    async handler({ organizationId, automationId, payload, outboxEventId }) {
      const consulta = payloadDeConsultaSchema.parse(payload);
      if (!outboxEventId) {
        throw new Error("inquiry.follow_up necesita el id del evento del outbox para no duplicar");
      }
      const contexto = { organizationId, automationId, contactId: consulta.contactId };

      // Se relee todo: entre el barrido y este despacho pueden pasar segundos
      // o, en un reintento, horas.
      const contacto = await deps.leerContacto(consulta.contactId, organizationId);
      if (!contacto || contacto.deletedAt !== null) {
        logger.info(contexto, "Seguimiento de consulta: el contacto ya no existe; no se hace nada");
        return;
      }
      if (contacto.noInterestAt !== null) {
        logger.info(contexto, "Seguimiento de consulta: el contacto está marcado sin interés");
        return;
      }
      if (await deps.hayOportunidadAbierta(consulta.contactId, organizationId)) {
        logger.info(
          contexto,
          "Seguimiento de consulta: el contacto ya tiene una oportunidad abierta",
        );
        return;
      }
      if (await deps.respondioDespues(organizationId, consulta.contactId, consulta.lastInboundAt)) {
        logger.info(
          contexto,
          "Seguimiento de consulta: el cliente volvió a escribir; no hace falta",
        );
        return;
      }

      const clinica = await deps.esClinica(organizationId);
      if (
        clinica &&
        (await deps.turnoFrena(organizationId, automationId, consulta.contactId, deps.ahora()))
      ) {
        logger.info(contexto, `Seguimiento de consulta: ${MOTIVO_TURNO_DEL_PACIENTE}`);
        return;
      }

      const conversacion = await deps.leerConversacion(consulta.conversationId, organizationId);
      const humano = conversacion
        ? await deps.humanoHabloUltimo(consulta.conversationId, organizationId)
        : false;
      const kind = tipoDeSeguimiento(consulta.channel, conversacion, humano);
      const ahora = deps.ahora();
      const base: AgendarInquiryFollowUpData = {
        organizationId,
        automationId,
        contactId: consulta.contactId,
        conversationId: consulta.conversationId,
        branchId: consulta.branchId,
        channel: consulta.channel,
        outboxEventId,
        kind,
        lastInboundAt: consulta.lastInboundAt,
        scheduledFor: ahora,
      };

      if (kind === InquiryFollowUpKind.WHATSAPP) {
        const agendado = await deps.agendar(base);
        logger.info(
          { ...contexto, agendado },
          agendado
            ? "Seguimiento de consulta por WhatsApp agendado"
            : "Seguimiento de consulta ya agendado para este evento (reentrega): no se duplica",
        );
        return;
      }

      // La tarea: para quien atiende la conversación si una persona la tomó,
      // si no para el vendedor del contacto, si no para el ADMIN. Sin nadie,
      // es un fallo de la regla que queda en AutomationExecution.error.
      const assigneeId = await deps.resolverAsignado(organizationId, [
        conversacion?.assignedUserId ?? null,
        contacto.ownerId,
      ]);
      if (!assigneeId) {
        throw new Error(
          "no hay a quién asignarle la tarea de seguimiento: el contacto no tiene vendedor y la organización no tiene un ADMIN activo",
        );
      }
      const mensajes = await deps.mensajesDelCliente(consulta.conversationId, organizationId);
      const tarea = tareaDeSeguimiento(
        contacto,
        consulta.channel,
        mensajes,
        consulta.lastInboundAt,
        ahora,
        clinica ? prestacionParaElMensaje(contacto) : undefined,
      );
      const creada = await deps.agendarYCrearTarea(
        { ...base, status: InquiryFollowUpStatus.SENT, sentAt: ahora },
        {
          assigneeId,
          contactId: consulta.contactId,
          subject: tarea.subject,
          body: tarea.body,
          // Vence hoy: la consulta ya lleva los días que la regla considera
          // demasiados.
          dueDate: fechaDeVencimiento(ahora, 0),
        },
      );
      logger.info(
        { ...contexto, assigneeId, creada },
        creada
          ? "Seguimiento de consulta: tarea creada para el vendedor"
          : "Seguimiento de consulta ya hecho para este evento (reentrega): no se duplica",
      );
    },
  };
}

export const accionSeguimientoDeConsulta = crearAccionSeguimientoDeConsulta();
