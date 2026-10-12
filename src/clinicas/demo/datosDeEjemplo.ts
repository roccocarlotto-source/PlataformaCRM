import { DateTime } from "luxon";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import {
  contarDatosDeNegocio,
  rubroDeLaOrganizacionVigente,
} from "../../repositories/organization.repository";
import { z } from "zod";
import { modelNameSchema, modelProviderSchema } from "../../schemas/agentModelConfig.schema";
import { asignarModeloDeAgente, createAgent } from "../../services/agent.service";
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
  MODELO_DEL_AGENTE_DE_LA_DEMO,
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
  type TurnoProximoDeLaDemo,
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
// DOS PARTES: la CONFIGURACIÓN (sede, profesionales, prestaciones, base de
// conocimiento, aviso de privacidad, agente, QR y automatizaciones), que se
// carga solo en el alta, y los DATOS DE USO (el bloqueo de la Dra., los
// pacientes y los turnos, cargarDatosDeUso), que también corre el reinicio de
// la demo (reinicioDeLaDemo.service.ts). Las fechas son relativas a hoy, en
// la zona de la demo: los turnos en los catorce días desde mañana y los
// atendidos en la semana anterior.
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

export interface ResumenDeDatosDeEjemplo extends ResumenDeDatosDeUso {
  sedes: number;
  profesionales: number;
  prestaciones: number;
  entradasDeConocimiento: number;
  agentes: number;
  qrs: number;
  automatizaciones: number;
}

/** Lo que carga la parte de "datos de uso": lo mismo en el alta y en el
 *  reinicio (reinicioDeLaDemo.service.ts). */
export interface ResumenDeDatosDeUso {
  bloqueos: number;
  pacientes: number;
  turnosProximos: number;
  sobreturnos: number;
  turnosConfirmados: number;
  turnosAtendidos: number;
  /** Los turnos que el service rechazó (un horario que ya no existe porque
   *  alguien cambió la configuración de la demo). En el alta, siempre 0. */
  turnosOmitidos: number;
}

export interface OpcionesDeLaDemo {
  /** El "ahora" del que salen los turnos de los próximos días y los de la
   *  semana anterior. */
  ahora?: Date;
  /** El registro de acciones del motor (los tests pasan el suyo). */
  automatizaciones?: OpcionesDeValidacion;
  /** Quién crea la demo (el platform admin de la ruta): queda en el log de
   *  la asignación del modelo. Sin él, el ADMIN de la demo. */
  platformAdminUserId?: string;
}

/** Con quién se escriben los datos: el ADMIN de la demo. */
export interface ActorDeLaDemo {
  userId: string;
  role: "ADMIN";
  industry: "CLINICA";
}

export interface ProfesionalDeLaDemo {
  id: string;
  branchId: string;
  allowsOverbooking: boolean;
}

/** Los ids de la configuración que usan los datos de uso. */
export interface ConfiguracionDeLaDemo {
  profesionales: Record<ClaveDeProfesional, ProfesionalDeLaDemo>;
  prestaciones: Record<ClaveDePrestacion, string>;
}

// Las mismas reglas que el body de la asignación de modelo de un platform
// admin (asignarModeloSchema, agentAdmin.controller.ts).
const modeloDeLaDemo = z.object({ modelProvider: modelProviderSchema, modelName: modelNameSchema });

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
  const actor: ActorDeLaDemo = { userId: admin.id, role: "ADMIN", industry: "CLINICA" };

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
  // El sobreturno de la lista necesita el permiso del profesional: es
  // configuración del profesional, no un dato de uso.
  const conSobreturno = new Set(
    TURNOS_PROXIMOS.filter((t) => t.sobreturno).map((t) => t.profesional),
  );
  const profesionales = {} as Record<ClaveDeProfesional, ProfesionalDeLaDemo>;
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
    if (conSobreturno.has(clave)) {
      await configurarSobreturnos(organizationId, recurso.id, {
        allowsOverbooking: true,
        maxOverbookingsPerDay: 1,
      });
    }
    profesionales[clave] = {
      id: recurso.id,
      branchId: sede.id,
      allowsOverbooking: conSobreturno.has(clave),
    };
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
      resourceId: profesionales[principal].id,
      name: datos.nombre,
      durationMin: datos.duracionMin,
    });
    if (otros.length > 0) {
      await definirProfesionales(
        organizationId,
        prestacion.id,
        otros.map((p) => profesionales[p].id),
      );
    }
    if (datos.controlALosDias !== null) {
      await configurarControlDeLaPrestacion(organizationId, prestacion.id, datos.controlALosDias);
    }
    prestaciones[clave] = prestacion.id;
  }

  // --- Base de conocimiento -------------------------------------------------
  for (const entrada of BASE_DE_CONOCIMIENTO) {
    await createKnowledgeBaseEntry(organizationId, {
      branchId: sede.id,
      title: entrada.titulo,
      content: entrada.contenido,
      ...(entrada.kind ? { kind: entrada.kind } : {}),
    });
  }

  // --- Datos de uso: bloqueo, pacientes y turnos ----------------------------
  // La misma función que corre el reinicio de la demo.
  const uso = await cargarDatosDeUso(
    organizationId,
    { profesionales, prestaciones },
    actor,
    opciones.ahora,
  );

  // --- Aviso de privacidad, agente, QR y automatizaciones -------------------
  await updateOrganizationSettings(organizationId, AVISO_DE_PRIVACIDAD);
  const agente = await createAgent(organizationId, {
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
  // Nace con el modelo de la plataforma (como cualquier agente) y se le asigna
  // el de la demo por el camino del platform admin (ver
  // MODELO_DEL_AGENTE_DE_LA_DEMO).
  await asignarModeloDeAgente({
    agentId: agente.id,
    ...modeloDeLaDemo.parse(MODELO_DEL_AGENTE_DE_LA_DEMO),
    platformAdminUserId: opciones.platformAdminUserId ?? admin.id,
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
    entradasDeConocimiento: BASE_DE_CONOCIMIENTO.length,
    ...uso,
    agentes: 1,
    qrs: 1,
    automatizaciones: reglas.length,
  };
}

// ---------------------------------------------------------------------------
// FECHAS RELATIVAS A HOY, en la zona de la demo.
//
// Los turnos próximos van en los catorce días desde mañana. Esos catorce días
// son dos tandas de siete, y cada tanda tiene cada día de la semana una sola
// vez: el turno { semana, dia } cae en el día de su tanda cuyo día de la
// semana es `dia` (0 = lunes). Así la lista de config.ts sirve empiece la
// ventana el día que empiece, y los domingos no tienen turnos.
// ---------------------------------------------------------------------------

function mananaEnLaDemo(ahora: Date): DateTime {
  return DateTime.fromJSDate(ahora, { zone: ZONA_DE_LA_DEMO }).startOf("day").plus({ days: 1 });
}

/** El día de la tanda `semana` cuyo día de la semana es `dia` (0 = lunes). */
function diaDeLaTanda(manana: DateTime, semana: 0 | 1, dia: number): DateTime {
  const desdeManana = (dia + 1 - manana.weekday + 7) % 7;
  return manana.plus({ days: semana * 7 + desdeManana });
}

/** Los turnos próximos con su inicio, en el orden en que se crean: por día y,
 *  dentro del día, en el orden de la lista (un sobreturno va después del
 *  turno que llena ese horario). */
export function fechasDeLosTurnosProximos(
  ahora: Date,
): { turno: TurnoProximoDeLaDemo; inicio: Date }[] {
  const manana = mananaEnLaDemo(ahora);
  return TURNOS_PROXIMOS.map((turno, orden) => ({
    turno,
    orden,
    dia: diaDeLaTanda(manana, turno.semana, turno.dia),
  }))
    .sort((a, b) => a.dia.toMillis() - b.dia.toMillis() || a.orden - b.orden)
    .map(({ turno, dia }) => ({
      turno,
      inicio: dia.set({ hour: turno.hora, minute: turno.minutos ?? 0 }).toJSDate(),
    }));
}

/** El bloqueo de la Dra.: el viernes de la primera tanda, de 13 a 19. */
export function horarioDelBloqueo(ahora: Date): { startsAt: Date; endsAt: Date } {
  const viernes = diaDeLaTanda(mananaEnLaDemo(ahora), 0, 4);
  return {
    startsAt: viernes.plus({ minutes: BLOQUEO.desde }).toJSDate(),
    endsAt: viernes.plus({ minutes: BLOQUEO.hasta }).toJSDate(),
  };
}

/** Los atendidos: la semana calendario anterior (0 = su lunes). */
export function fechasDeLosTurnosAtendidos(ahora: Date): { turno: TurnoDeLaDemo; inicio: Date }[] {
  const lunesPasado = DateTime.fromJSDate(ahora, { zone: ZONA_DE_LA_DEMO })
    .startOf("week")
    .minus({ weeks: 1 });
  return TURNOS_ATENDIDOS.map((turno) => ({
    turno,
    inicio: lunesPasado
      .plus({ days: turno.dia })
      .set({ hour: turno.hora, minute: turno.minutos ?? 0 })
      .toJSDate(),
  }));
}

// ---------------------------------------------------------------------------
// LOS DATOS DE USO: el bloqueo de la Dra., los pacientes y los turnos. Es la
// parte que corre en el alta y en el reinicio de la demo
// (reinicioDeLaDemo.service.ts), sobre una organización sin datos de uso.
//
// El bloqueo va ANTES de los turnos: así no crea tareas. Un turno que el
// service rechaza (400 o 409: un horario que ya no existe porque alguien
// cambió la configuración de la demo) se omite y se cuenta, en vez de dejar la
// demo a medio cargar. Lo mismo un sobreturno si el profesional ya no los
// acepta.
// ---------------------------------------------------------------------------

export async function cargarDatosDeUso(
  organizationId: string,
  configuracion: ConfiguracionDeLaDemo,
  actor: ActorDeLaDemo,
  ahora: Date = new Date(),
): Promise<ResumenDeDatosDeUso> {
  const { profesionales, prestaciones } = configuracion;

  // --- Bloqueo, ANTES de los turnos: así no crea tareas ---------------------
  await crearBloqueoDeProfesional(
    organizationId,
    profesionales[BLOQUEO.profesional].id,
    { ...horarioDelBloqueo(ahora), reason: BLOQUEO.motivo },
    actor,
  );

  // --- Pacientes (sin teléfono) -----------------------------------------
  const pacientes: string[] = [];
  for (const p of PACIENTES) {
    const contacto = await createContact(organizationId, actor.userId, {
      firstName: p.nombre,
      lastName: p.apellido,
      email: p.email,
    });
    pacientes.push(contacto.id);
  }

  // --- Turnos de los próximos catorce días --------------------------------
  const confirmados: string[] = [];
  let creados = 0;
  let sobreturnos = 0;
  let omitidos = 0;
  for (const { turno, inicio } of fechasDeLosTurnosProximos(ahora)) {
    const profesional = profesionales[turno.profesional];
    if (turno.sobreturno && !profesional.allowsOverbooking) {
      omitidos++;
      continue;
    }
    try {
      const creado = await crearTurnoDeClinica(
        organizationId,
        {
          serviceTypeId: prestaciones[turno.prestacion],
          contactId: pacientes[turno.paciente],
          startsAt: inicio,
          resourceId: profesional.id,
          ...(turno.sobreturno ? { isOverbooking: true } : {}),
        },
        undefined,
        actor,
      );
      creados++;
      if (turno.sobreturno) sobreturnos++;
      if (turno.confirmado) confirmados.push(creado.id);
    } catch (err) {
      if (!(err instanceof AppError) || (err.statusCode !== 400 && err.statusCode !== 409)) {
        throw err;
      }
      logger.warn(
        { organizationId, inicio, prestacion: turno.prestacion, motivo: err.message },
        "Clínica Demo: un turno de ejemplo no entra en la configuración actual y se omite",
      );
      omitidos++;
    }
  }
  // Prisma directo (aprobado): solo la respuesta al recordatorio lo escribe.
  await prisma.booking.updateMany({
    where: { organizationId, id: { in: confirmados } },
    data: { patientConfirmedAt: ahora },
  });

  // --- Atendidos la semana anterior (Prisma directo, sin eventos) ----------
  for (const { turno, inicio } of fechasDeLosTurnosAtendidos(ahora)) {
    await crearAtendido(organizationId, turno, {
      inicio,
      prestacion: prestaciones[turno.prestacion],
      profesional: profesionales[turno.profesional],
      paciente: pacientes[turno.paciente],
    });
  }

  return {
    bloqueos: 1,
    pacientes: PACIENTES.length,
    turnosProximos: creados,
    sobreturnos,
    turnosConfirmados: confirmados.length,
    turnosAtendidos: TURNOS_ATENDIDOS.length,
    turnosOmitidos: omitidos,
  };
}

async function crearAtendido(
  organizationId: string,
  turno: TurnoDeLaDemo,
  ids: {
    inicio: Date;
    prestacion: string;
    profesional: ProfesionalDeLaDemo;
    paciente: string;
  },
): Promise<void> {
  const endsAt = new Date(
    ids.inicio.getTime() + PRESTACIONES[turno.prestacion].duracionMin * 60 * 1000,
  );
  await prisma.booking.create({
    data: {
      organizationId,
      branchId: ids.profesional.branchId,
      serviceTypeId: ids.prestacion,
      resourceId: ids.profesional.id,
      contactId: ids.paciente,
      startsAt: ids.inicio,
      endsAt,
      status: "COMPLETED",
      completedAt: endsAt,
      completedBy: "PERSONA",
    },
  });
}
