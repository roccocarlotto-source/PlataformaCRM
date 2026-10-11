import { DateTime } from "luxon";
import { prisma } from "../../lib/prisma";
import {
  contarDatosDeNegocio,
  rubroDeLaOrganizacionVigente,
} from "../../repositories/organization.repository";
import { createAgent } from "../../services/agent.service";
import { createAutomation, type OpcionesDeValidacion } from "../../services/automation.service";
import { createBranch } from "../../services/branch.service";
import { replaceBusinessHoursForBranch } from "../../services/branchBusinessHours.service";
import { createContact } from "../../services/contact.service";
import { createKnowledgeBaseEntry } from "../../services/knowledgeBaseEntry.service";
import { updateOrganizationSettings } from "../../services/organization.service";
import { createDigitalQrCode } from "../../services/qr.service";
import { createResource } from "../../services/resource.service";
import { createServiceType } from "../../services/serviceType.service";
import { replaceWorkingHoursForResource } from "../../services/workingHours.service";
import { AppError } from "../../utils/AppError";
import {
  ACTION_BOOKING_SCHEDULE_CONTROL,
  ACTION_BOOKING_SEND_QR_REVIEW,
  TEXTO_POR_DEFECTO_DEL_CONTROL,
  TEXTO_POR_DEFECTO_DEL_QR_DE_RESENA,
  TRIGGER_BOOKING_COMPLETED,
} from "../postTurno/config";
import { configurarControlDeLaPrestacion } from "../postTurno/control.service";
import {
  ACTION_BOOKING_SEND_REMINDER,
  TEXTO_POR_DEFECTO_DEL_RECORDATORIO,
  TRIGGER_BOOKING_REMINDER_DUE,
} from "../recordatorios/config";
import { crearTurnoDeClinica, definirProfesionales } from "../services/agendaClinica.service";
import { configurarSobreturnos, crearBloqueoDeProfesional } from "../services/bloqueos.service";
import { configurarClinicaDeLaSede } from "../services/configuracionDeSede.service";
import {
  AGENTE,
  AVISO_DE_PRIVACIDAD,
  BASE_DE_CONOCIMIENTO,
  BLOQUEO,
  DEMORA_DEL_QR_MIN,
  HORARIO_DE_LA_SEDE,
  NOMBRE_DE_LA_SEDE,
  NOMBRE_DE_LAS_REGLAS,
  PACIENTES,
  PRESTACIONES,
  PROFESIONALES,
  QR_DE_RESENA,
  RECORDATORIO_DE_LA_SEDE,
  TURNOS_ATENDIDOS,
  TURNOS_PROXIMOS,
  ZONA_DE_LA_DEMO,
  type ClaveDePrestacion,
  type ClaveDeProfesional,
  type TurnoDeLaDemo,
} from "./config";

// ---------------------------------------------------------------------------
// Los datos de ejemplo de la Clínica Demo (docs/rubros.md §12, R19).
//
// POR LOS SERVICES, como los de un cliente (§12.1): pasan por las mismas
// validaciones. Las únicas escrituras directas, aprobadas por Rocco, son las
// que ningún service acepta: los 3 turnos atendidos de la semana anterior (un
// turno pasado es un 400) y el patientConfirmedAt de algunos turnos (lo
// escribe solo la respuesta al recordatorio). Van sin eventos, como en
// scripts/seed-dev-data.ts.
//
// NADA SALE DE LA PLATAFORMA:
//   - los pacientes no tienen teléfono;
//   - las automatizaciones nacen INACTIVAS y se crean con createAutomation
//     directo, sin sincronizar ninguna plantilla con Meta (las plantillas no
//     se aprueban solas, §12.2). Sin regla activa, booking.created no agenda
//     ningún recordatorio (programarRecordatorio responde SIN_REGLA);
//   - el agente nace inactivo y sin nivel (ESENCIAL), sin número;
//   - la sede no tiene Google Calendar.
//
// NUNCA MEZCLA con datos reales: 409 si la organización no es CLINICA o si ya
// tiene contactos, turnos, conversaciones o vehículos (incluidos los dados de
// baja). Sin lock: es una operación manual del platform admin sobre una
// organización recién creada, la misma carrera aceptada que el cambio de
// rubro (organizationAdmin.service.ts).
//
// NO ES ATÓMICA: cada service abre su transacción. Si algo falla a mitad, la
// organización queda con datos parciales y un segundo intento da 409; se
// borra a mano, como cualquier demo (§12.1).
// ---------------------------------------------------------------------------

export const DEMO_SOLO_EN_CLINICAS =
  "Los datos de ejemplo solo se cargan en una organización del rubro clínica.";
export const DEMO_CON_DATOS =
  "La organización ya tiene contactos, turnos, conversaciones o vehículos: los datos de ejemplo solo se cargan en una clínica vacía.";

export interface ResumenDeDatosDeEjemplo {
  sedes: number;
  profesionales: number;
  prestaciones: number;
  bloqueos: number;
  entradasDeConocimiento: number;
  pacientes: number;
  turnosProximos: number;
  sobreturnos: number;
  turnosConfirmados: number;
  turnosAtendidos: number;
  agentes: number;
  qrs: number;
  automatizaciones: number;
}

export interface OpcionesDeLaDemo {
  /** El "ahora" del que salen la semana siguiente y la anterior. */
  ahora?: Date;
  /** El registro de acciones del motor (los tests pasan el suyo). */
  automatizaciones?: OpcionesDeValidacion;
}

export async function cargarDatosDeEjemplo(
  organizationId: string,
  adminUserId: string,
  opciones: OpcionesDeLaDemo = {},
): Promise<ResumenDeDatosDeEjemplo> {
  const org = await rubroDeLaOrganizacionVigente(organizationId);
  if (!org) throw new AppError("Organización no encontrada", 404);
  if (org.industry !== "CLINICA") throw new AppError(DEMO_SOLO_EN_CLINICAS, 409);
  if ((await contarDatosDeNegocio(organizationId)) > 0) throw new AppError(DEMO_CON_DATOS, 409);
  const admin = await prisma.user.findFirst({
    where: { id: adminUserId, organizationId, deletedAt: null },
    select: { id: true, role: { select: { name: true } } },
  });
  if (!admin || admin.role.name !== "ADMIN") {
    throw new AppError("El administrador indicado no es ADMIN de esa organización", 400);
  }
  const actor = { userId: admin.id, role: "ADMIN" as const, industry: "CLINICA" as const };

  // La semana de los turnos (de lunes a sábado) y la anterior, en la zona de
  // la sede.
  const hoy = DateTime.fromJSDate(opciones.ahora ?? new Date(), { zone: ZONA_DE_LA_DEMO });
  const lunesProximo = hoy.startOf("week").plus({ weeks: 1 });
  const lunesPasado = hoy.startOf("week").minus({ weeks: 1 });
  const instante = (lunes: DateTime, dia: number, hora: number, minutos = 0) =>
    lunes.plus({ days: dia }).set({ hour: hora, minute: minutos }).toJSDate();

  // --- Sede, horario y recordatorio -----------------------------------------
  // La primera sede le hereda la zona a la organización (que nace en UTC).
  const sede = await createBranch(
    organizationId,
    { name: NOMBRE_DE_LA_SEDE, timezone: ZONA_DE_LA_DEMO },
    "CLINICA",
  );
  await replaceBusinessHoursForBranch(organizationId, sede.id, HORARIO_DE_LA_SEDE);
  await configurarClinicaDeLaSede(organizationId, sede.id, RECORDATORIO_DE_LA_SEDE);

  // --- Profesionales ------------------------------------------------------
  const profesionales = {} as Record<ClaveDeProfesional, string>;
  for (const [clave, datos] of Object.entries(PROFESIONALES) as [
    ClaveDeProfesional,
    (typeof PROFESIONALES)[ClaveDeProfesional],
  ][]) {
    const recurso = await createResource(organizationId, {
      branchId: sede.id,
      name: datos.nombre,
      type: "PERSON",
    });
    await replaceWorkingHoursForResource(organizationId, recurso.id, datos.horario);
    profesionales[clave] = recurso.id;
  }

  // --- Prestaciones -------------------------------------------------------
  const prestaciones = {} as Record<ClaveDePrestacion, string>;
  for (const [clave, datos] of Object.entries(PRESTACIONES) as [
    ClaveDePrestacion,
    (typeof PRESTACIONES)[ClaveDePrestacion],
  ][]) {
    const [principal, ...otros] = datos.profesionales;
    const prestacion = await createServiceType(organizationId, {
      branchId: sede.id,
      resourceId: profesionales[principal],
      name: datos.nombre,
      durationMin: datos.duracionMin,
    });
    if (otros.length > 0) {
      await definirProfesionales(
        organizationId,
        prestacion.id,
        otros.map((p) => profesionales[p]),
      );
    }
    if (datos.controlALosDias !== null) {
      await configurarControlDeLaPrestacion(organizationId, prestacion.id, datos.controlALosDias);
    }
    prestaciones[clave] = prestacion.id;
  }

  // --- Bloqueo, ANTES de los turnos: así no crea tareas ---------------------
  const viernes = lunesProximo.plus({ days: 4 });
  await crearBloqueoDeProfesional(
    organizationId,
    profesionales[BLOQUEO.profesional],
    {
      startsAt: viernes.plus({ minutes: BLOQUEO.desde }).toJSDate(),
      endsAt: viernes.plus({ minutes: BLOQUEO.hasta }).toJSDate(),
      reason: BLOQUEO.motivo,
    },
    actor,
  );

  // --- Base de conocimiento -------------------------------------------------
  for (const entrada of BASE_DE_CONOCIMIENTO) {
    await createKnowledgeBaseEntry(organizationId, {
      branchId: sede.id,
      title: entrada.titulo,
      content: entrada.contenido,
      ...(entrada.kind ? { kind: entrada.kind } : {}),
    });
  }

  // --- Pacientes (sin teléfono) -----------------------------------------
  const pacientes: string[] = [];
  for (const p of PACIENTES) {
    const contacto = await createContact(organizationId, admin.id, {
      firstName: p.nombre,
      lastName: p.apellido,
      email: p.email,
    });
    pacientes.push(contacto.id);
  }

  // --- Turnos de la semana siguiente ------------------------------------
  // El sobreturno necesita el permiso del profesional y el horario lleno (el
  // turno anterior de la lista).
  const conSobreturno = new Set(
    TURNOS_PROXIMOS.filter((t) => t.sobreturno).map((t) => t.profesional),
  );
  for (const clave of conSobreturno) {
    await configurarSobreturnos(organizationId, profesionales[clave], {
      allowsOverbooking: true,
      maxOverbookingsPerDay: 1,
    });
  }
  const confirmados: string[] = [];
  for (const turno of TURNOS_PROXIMOS) {
    const creado = await crearTurnoDeClinica(
      organizationId,
      {
        serviceTypeId: prestaciones[turno.prestacion],
        contactId: pacientes[turno.paciente],
        startsAt: instante(lunesProximo, turno.dia, turno.hora, turno.minutos),
        resourceId: profesionales[turno.profesional],
        ...(turno.sobreturno ? { isOverbooking: true } : {}),
      },
      undefined,
      actor,
    );
    if (turno.confirmado) confirmados.push(creado.id);
  }
  // Prisma directo (aprobado): solo la respuesta al recordatorio lo escribe.
  await prisma.booking.updateMany({
    where: { organizationId, id: { in: confirmados } },
    data: { patientConfirmedAt: hoy.toJSDate() },
  });

  // --- Atendidos la semana anterior (Prisma directo, sin eventos) ----------
  for (const turno of TURNOS_ATENDIDOS) {
    await crearAtendido(organizationId, sede.id, turno, {
      inicio: instante(lunesPasado, turno.dia, turno.hora, turno.minutos),
      prestacion: prestaciones[turno.prestacion],
      profesional: profesionales[turno.profesional],
      paciente: pacientes[turno.paciente],
    });
  }

  // --- Aviso de privacidad, agente, QR y automatizaciones -------------------
  await updateOrganizationSettings(organizationId, AVISO_DE_PRIVACIDAD);
  await createAgent(organizationId, {
    branchId: sede.id,
    name: AGENTE.name,
    goal: AGENTE.goal,
    instructions: AGENTE.instructions,
    tone: AGENTE.tone,
    enabledTools: AGENTE.enabledTools,
    channels: ["WHATSAPP"],
    allowedOrigins: [],
    guardrails: {},
    guardrailsText: "",
    isActive: false,
  });
  const qr = await createDigitalQrCode(organizationId, {
    branchId: sede.id,
    name: QR_DE_RESENA.name,
    destinationUrl: QR_DE_RESENA.destinationUrl,
    message: null,
  });
  const reglas = [
    {
      name: NOMBRE_DE_LAS_REGLAS.recordatorio,
      triggerType: TRIGGER_BOOKING_REMINDER_DUE,
      actionType: ACTION_BOOKING_SEND_REMINDER,
      actionConfig: { messageText: TEXTO_POR_DEFECTO_DEL_RECORDATORIO },
    },
    {
      name: NOMBRE_DE_LAS_REGLAS.qr,
      triggerType: TRIGGER_BOOKING_COMPLETED,
      actionType: ACTION_BOOKING_SEND_QR_REVIEW,
      actionConfig: {
        qrCodeId: qr.id,
        delayMinutes: DEMORA_DEL_QR_MIN,
        whatsappFormat: "LINK",
        messageText: TEXTO_POR_DEFECTO_DEL_QR_DE_RESENA,
      },
    },
    {
      name: NOMBRE_DE_LAS_REGLAS.control,
      triggerType: TRIGGER_BOOKING_COMPLETED,
      actionType: ACTION_BOOKING_SCHEDULE_CONTROL,
      actionConfig: { messageText: TEXTO_POR_DEFECTO_DEL_CONTROL },
    },
  ];
  for (const regla of reglas) {
    await createAutomation(
      organizationId,
      { ...regla, isActive: false },
      opciones.automatizaciones,
    );
  }

  return {
    sedes: 1,
    profesionales: Object.keys(PROFESIONALES).length,
    prestaciones: Object.keys(PRESTACIONES).length,
    bloqueos: 1,
    entradasDeConocimiento: BASE_DE_CONOCIMIENTO.length,
    pacientes: PACIENTES.length,
    turnosProximos: TURNOS_PROXIMOS.length,
    sobreturnos: TURNOS_PROXIMOS.filter((t) => t.sobreturno).length,
    turnosConfirmados: confirmados.length,
    turnosAtendidos: TURNOS_ATENDIDOS.length,
    agentes: 1,
    qrs: 1,
    automatizaciones: reglas.length,
  };
}

async function crearAtendido(
  organizationId: string,
  branchId: string,
  turno: TurnoDeLaDemo,
  ids: { inicio: Date; prestacion: string; profesional: string; paciente: string },
): Promise<void> {
  const endsAt = new Date(
    ids.inicio.getTime() + PRESTACIONES[turno.prestacion].duracionMin * 60 * 1000,
  );
  await prisma.booking.create({
    data: {
      organizationId,
      branchId,
      serviceTypeId: ids.prestacion,
      resourceId: ids.profesional,
      contactId: ids.paciente,
      startsAt: ids.inicio,
      endsAt,
      status: "COMPLETED",
      completedAt: endsAt,
      completedBy: "PERSONA",
    },
  });
}
