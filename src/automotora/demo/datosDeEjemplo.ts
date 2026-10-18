import type { Prisma, Weekday } from "@prisma/client";
import { DateTime } from "luxon";
import { z } from "zod";
import { logger } from "../../lib/logger";
import { prisma, type Db, OPCIONES_DE_TRANSACCION_LARGA } from "../../lib/prisma";
import { createContactChannelIdentity } from "../../repositories/contactChannelIdentity.repository";
import { contarDatosDeNegocio } from "../../repositories/organization.repository";
import { assignNextVehicleStockNumber } from "../../repositories/vehicle.repository";
import { modelNameSchema, modelProviderSchema } from "../../schemas/agentModelConfig.schema";
import { asignarModeloDeAgente, createAgent } from "../../services/agent.service";
import { createEmbedToken } from "../../services/agentEmbedToken.service";
import { createAutomation } from "../../services/automation.service";
import { ACTION_CREATE_FOLLOW_UP } from "../../services/automationActions/createFollowUpActivity";
import { ACTION_SEND_QR_FOLLOWUP } from "../../services/automationActions/sendQrFollowup";
import { TRIGGER_OPPORTUNITY_WON } from "../../services/automationTriggers";
import { crearReglaConMensaje } from "../../services/automationWhatsapp.service";
import { createBranch } from "../../services/branch.service";
import { replaceBusinessHoursForBranch } from "../../services/branchBusinessHours.service";
import { crearDefinicion } from "../../services/contactCustomFieldDefinition.service";
import { createDeliveryForSoldVehicle } from "../../services/delivery.service";
import { createKnowledgeBaseEntry } from "../../services/knowledgeBaseEntry.service";
import { idSimulado } from "../../services/modoDemo.service";
import { createPipeline } from "../../services/pipeline.service";
import { createDigitalQrCode } from "../../services/qr.service";
import { createResource } from "../../services/resource.service";
import { replaceWorkingHoursForResource } from "../../services/workingHours.service";
import { createServiceType } from "../../services/serviceType.service";
import { createStage } from "../../services/stage.service";
import { formatInternalCode } from "../../services/vehicle.service";
import { sincronizarStockConBaseDeConocimiento } from "../../services/vehicleKnowledgeBaseSync.service";
import { tieneElModulo } from "../../servicios/recordatorio/repository";
import { TRIGGER_RECAMBIO } from "../../servicios/recambio/config";
import {
  ACTION_SEND_NEXT_SERVICE_REMINDER,
  TRIGGER_NEXT_SERVICE_DUE,
} from "../../servicios/recordatorio/config";
import { registrarAviso } from "../../servicios/services/avisos.service";
import { crearTipo, guardarConfiguracion } from "../../servicios/services/configuracion.service";
import {
  cambiarEstado,
  crearOrden,
  registrarAprobacion,
} from "../../servicios/services/ordenes.service";
import { AppError } from "../../utils/AppError";
import {
  AGENDA_DEL_TALLER,
  AGENTE,
  BASE_DE_CONOCIMIENTO,
  CAMPOS_PERSONALIZADOS,
  CONFIGURACION_DEL_TALLER,
  CONTACTOS,
  CONVERSACIONES,
  COTIZACION_DE_EJEMPLO,
  DEMORA_DEL_QR_MIN,
  FUENTE_LANDING,
  IDENTIDADES_DE_CANAL,
  MODELO_DEL_AGENTE_DE_LA_DEMO,
  NOMBRE_DE_LAS_REGLAS,
  OPORTUNIDADES,
  ORDENES,
  PROCESO_DE_VENTA,
  QR_DE_RESENA,
  REGLA_DE_LA_VENTA_GANADA,
  REGLA_DEL_RECAMBIO,
  REGLA_DEL_RECORDATORIO,
  STOCK,
  SUCURSALES,
  TAREAS,
  TIPOS_DE_SERVICE,
  TURNOS,
  VEHICULOS_DE_CLIENTES,
  CONTACTO_DEL_PROBADOR,
  HORARIO_DE_LOS_RECURSOS,
  PRUEBA_DE_MANEJO,
  ZONA_DE_LA_DEMO,
  type ClaveDeCampo,
  type ClaveDeEtapa,
  type ClaveDeSucursal,
  type ClaveDeTipoDeService,
  type ClaveDeUnidad,
  type ClaveDeUsuario,
  type ConversacionDeLaDemo,
  type FechaRelativaAlMes,
  type Franja,
} from "./config";

// ---------------------------------------------------------------------------
// Los datos de ejemplo del Taller Demo (docs/taller-demo.md). Misma división
// que la Clínica Demo (src/clinicas/demo/datosDeEjemplo.ts):
//
//   - la CONFIGURACIÓN (sucursales, agenda del taller, proceso de venta,
//     taller, campos personalizados, base de conocimiento, agente, QR y
//     automatizaciones) se carga una sola vez, en el alta, POR LOS SERVICES:
//     pasa por las mismas validaciones que la de un cliente;
//   - los DATOS DE USO (cargarDatosDeUso) son lo que un reinicio de la demo
//     borra y vuelve a cargar. Van en dos partes, decididas por Rocco el
//     2026-10-16 (docs-privados/taller-demo-diseno.md §4.2, local):
//       1. lo MASIVO (contactos, fuente y eventos, stock, vehículos de
//          clientes, oportunidades, conversaciones y mensajes, tareas, turnos)
//          se escribe DIRECTO con Prisma, en UNA transacción, con los mismos
//          campos que escribirían los services. Motivo: en producción cada
//          consulta cuesta cientos de ms y los services hacen varias por fila;
//          cien filas por services serían minutos. Es la escritura directa
//          aprobada; lo que los services garantizan (numeración del stock,
//          estado de la unidad, cliente al ganar, entrega) se reproduce acá;
//       2. las ÓRDENES de servicio van POR LOS SERVICES (crearOrden →
//          cambiarEstado → registrarAprobacion → registrarAviso): son las
//          únicas con invariantes que no conviene reproducir a mano
//          (numeración, transiciones, eventos de la orden, próximo service).
//          Después, las fechas del historial se corren hacia atrás, directo,
//          para que "hace más de 24 h" sea verdad.
//     Al final, la sincronización del stock con la base de conocimiento.
//
// FECHAS RELATIVAS al momento de la carga, en la zona de la demo: lo que el
// Dashboard cuenta por mes cae siempre en "este mes" o "el mes pasado"
// (fechaRelativaAlMes), los turnos van la semana que viene, y el resto se
// expresa en días u horas hacia atrás. datosDeEjemplo.test.ts lo prueba con
// un "hoy" por cada día de la semana y en los bordes de mes.
//
// SOLO EN MODO DEMO: 409 si la organización no tiene is_demo (los teléfonos
// inventados pueden existir; con la bandera nada les llega), no es
// AUTOMOTORA, no tiene el módulo Servicios, o ya tiene datos.
// ---------------------------------------------------------------------------

export const DEMO_SOLO_EN_MODO_DEMO =
  "Los datos de ejemplo del Taller Demo solo se cargan en una organización en modo demo.";
export const DEMO_SOLO_EN_AUTOMOTORAS =
  "Los datos de ejemplo del Taller Demo solo se cargan en una organización del rubro automotora.";
export const DEMO_SIN_MODULO =
  "Los datos de ejemplo del Taller Demo necesitan el módulo Servicios activado.";
export const DEMO_CON_DATOS =
  "La organización ya tiene contactos, turnos, conversaciones o vehículos: los datos de ejemplo solo se cargan en una organización vacía.";

/** Los usuarios de la demo (ids), por lo que hacen en los datos. En el alta
 *  son los tres que se crean; si faltara alguno, el que llama pone al admin
 *  en su lugar. */
export type UsuariosDeLaDemo = Record<ClaveDeUsuario, string>;

/** Los ids de la configuración que usan los datos de uso. */
export interface ConfiguracionDeLaDemo {
  sucursales: Record<ClaveDeSucursal, string>;
  agenda: { recursoId: string; turnoId: string };
  proceso: { pipelineId: string; etapas: Record<ClaveDeEtapa, string> };
  tiposDeService: Record<ClaveDeTipoDeService, string>;
  /** La clave (key) de cada campo personalizado. */
  campos: Record<ClaveDeCampo, string>;
  agenteId: string;
  /** La regla del recordatorio de próximo service: el recordatorio enviado
   *  que se siembra es suyo. */
  reglaDelRecordatorioId: string;
}

export interface ResumenDeDatosDeUso {
  contactos: number;
  identidadesDeCanal: number;
  eventosDeIngesta: number;
  unidades: number;
  oportunidades: number;
  vehiculosDeClientes: number;
  conversaciones: number;
  mensajes: number;
  tareas: number;
  turnos: number;
  ordenes: number;
  aprobaciones: number;
  avisos: number;
  fichasDeStock: number;
}

export interface ResumenDeDatosDeEjemplo extends ResumenDeDatosDeUso {
  sucursales: number;
  etapas: number;
  tiposDeService: number;
  camposPersonalizados: number;
  entradasDeConocimiento: number;
  agentes: number;
  qrs: number;
  automatizaciones: number;
}

export interface OpcionesDeLaDemo {
  /** El "ahora" del que salen todas las fechas. */
  ahora?: Date;
  /** Quién crea la demo (el platform admin de la ruta): queda en el log de
   *  la asignación del modelo. Sin él, el ADMIN de la demo. */
  platformAdminUserId?: string;
}

const modeloDeLaDemo = z.object({ modelProvider: modelProviderSchema, modelName: modelNameSchema });

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

export function hoyEnLaDemo(ahora: Date): DateTime {
  return DateTime.fromJSDate(ahora, { zone: ZONA_DE_LA_DEMO }).startOf("day");
}

/** { mes: 0, dia: k } es el día k+1 de este mes, nunca después de hoy; con
 *  mes -1 o -2, ese día del mes correspondiente (k < 28, así existe). */
export function fechaRelativaAlMes(ahora: Date, f: FechaRelativaAlMes): DateTime {
  const hoy = hoyEnLaDemo(ahora);
  const dia = hoy.startOf("month").plus({ months: f.mes, days: f.dia });
  return f.mes === 0 && dia > hoy ? hoy : dia;
}

/** Una fecha calendario (@db.Date) tal como la guarda Prisma: medianoche UTC
 *  de ese día. */
export function fechaCalendario(dia: DateTime): Date {
  return new Date(Date.UTC(dia.year, dia.month - 1, dia.day));
}

/** El lunes de la semana que viene, en la zona de la demo. */
export function lunesQueViene(ahora: Date): DateTime {
  return hoyEnLaDemo(ahora).startOf("week").plus({ weeks: 1 });
}

export function fechasDeLosTurnos(ahora: Date): { clave: string; inicio: Date; fin: Date }[] {
  const lunes = lunesQueViene(ahora);
  return TURNOS.map((t) => {
    const inicio = lunes.plus({ days: t.dia }).set({ hour: t.hora });
    return {
      clave: t.clave,
      inicio: inicio.toJSDate(),
      fin: inicio.plus({ minutes: AGENDA_DEL_TALLER.duracionMin }).toJSDate(),
    };
  });
}

export interface FechasDeOportunidad {
  creada: Date;
  cerrada: Date | null;
  esperada: Date | null;
}

export function fechasDeLasOportunidades(ahora: Date): FechasDeOportunidad[] {
  const hoy = hoyEnLaDemo(ahora);
  return OPORTUNIDADES.map((o, i) => {
    const creada = fechaRelativaAlMes(ahora, o.creada).set({ hour: 9 + (i % 8) });
    return {
      creada: noDespuesDe(ahora, creada.toJSDate()),
      cerrada: o.cerrada ? fechaCalendario(fechaRelativaAlMes(ahora, o.cerrada)) : null,
      esperada: o.cerrada ? null : fechaCalendario(hoy.plus({ days: 20 + i })),
    };
  });
}

export interface FechasDeVehiculoDeCliente {
  compra: Date | null;
  proximoService: Date | null;
}

export function fechasDeLosVehiculosDeClientes(ahora: Date): FechasDeVehiculoDeCliente[] {
  const hoy = hoyEnLaDemo(ahora);
  const ventas = fechasDeLasOportunidades(ahora);
  return VEHICULOS_DE_CLIENTES.map((v) => {
    if (v.venta !== undefined) {
      const cierre = ventas[v.venta].cerrada;
      if (!cierre)
        throw new Error(`La venta ${String(v.venta)} del vehículo ${v.clave} no está cerrada`);
      const compra = DateTime.fromJSDate(cierre, { zone: "utc" });
      return {
        compra: cierre,
        proximoService: fechaCalendario(
          compra.plus({ months: CONFIGURACION_DEL_TALLER.firstServiceAfterMonths }),
        ),
      };
    }
    return {
      compra:
        v.compradoHaceMeses === null
          ? null
          : fechaCalendario(
              hoy.minus({ months: v.compradoHaceMeses, days: v.compradoHaceDiasExtra ?? 0 }),
            ),
      proximoService:
        v.proximoServiceEnDias === null
          ? null
          : fechaCalendario(hoy.plus({ days: v.proximoServiceEnDias })),
    };
  });
}

function horasAtras(ahora: Date, horas: number): Date {
  return new Date(ahora.getTime() - horas * 3_600_000);
}

const DIAS_DE_LUXON: Weekday[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

// Media hora antes del cierre: un mensaje "a las 17:59" se ve forzado.
const MARGEN_ANTES_DEL_CIERRE_MIN = 30;

/** Cuándo empieza una conversación de la demo: `hace` horas antes de ahora
 *  o, si es `enHorario`, lo que haga falta antes para que todo lo que mandó
 *  la concesionaria caiga en el horario de Casa Central. */
export function inicioDeLaConversacion(c: ConversacionDeLaDemo, ahora: Date): Date {
  const segunHace = horasAtras(ahora, c.hace);
  if (!c.enHorario) return segunHace;
  const ultimoSaliente = Math.max(
    0,
    ...c.mensajes.filter((m) => m.de !== "CONTACTO").map((m) => m.minuto),
  );
  return dentroDelHorario(segunHace, SUCURSALES.central.horario, ZONA_DE_LA_DEMO, ultimoSaliente);
}

/**
 * El momento más cercano a `instante`, sin pasarlo, en que la sucursal está
 * abierta durante `duracionMin` minutos seguidos: el mismo instante si ya
 * cae en horario y entra; si no, media hora antes del cierre de la última
 * franja que lo permite. Ensayo del 2026-10-17: con "hace N horas" los
 * mensajes de la concesionaria caían de noche, según la hora del reinicio.
 */
export function dentroDelHorario(
  instante: Date,
  horario: readonly Franja[],
  zona: string,
  duracionMin = 0,
): Date {
  const local = DateTime.fromJSDate(instante, { zone: zona });
  for (let diasAtras = 0; diasAtras <= 7; diasAtras++) {
    const dia = local.minus({ days: diasAtras }).startOf("day");
    const delDia = horario
      .filter((f) => f.weekday === DIAS_DE_LUXON[dia.weekday - 1])
      .sort((x, y) => y.startMinute - x.startMinute);
    for (const f of delDia) {
      const abre = dia.plus({ minutes: f.startMinute });
      const ultimoInicio = dia.plus({
        minutes: f.endMinute - MARGEN_ANTES_DEL_CIERRE_MIN - duracionMin,
      });
      if (ultimoInicio < abre || abre > local) continue;
      return (local <= ultimoInicio ? local : ultimoInicio).toJSDate();
    }
  }
  return instante;
}

/** Un createdAt nunca va después de ahora (el día de hoy a las 18 puede ser
 *  más tarde que "ahora" a las 8). */
function noDespuesDe(ahora: Date, fecha: Date): Date {
  return fecha.getTime() > ahora.getTime() ? new Date(ahora) : fecha;
}

function fechaDeTexto(dia: DateTime): string {
  return dia.toFormat("yyyy-LL-dd");
}

// ---------------------------------------------------------------------------
// La configuración (solo en el alta)
// ---------------------------------------------------------------------------

export async function cargarDatosDeEjemplo(
  organizationId: string,
  usuarios: UsuariosDeLaDemo,
  opciones: OpcionesDeLaDemo = {},
): Promise<ResumenDeDatosDeEjemplo> {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { industry: true, isDemo: true },
  });
  if (!org) throw new AppError("Organización no encontrada", 404);
  if (org.industry !== "AUTOMOTORA") throw new AppError(DEMO_SOLO_EN_AUTOMOTORAS, 409);
  if (!org.isDemo) throw new AppError(DEMO_SOLO_EN_MODO_DEMO, 409);
  if (!(await tieneElModulo(organizationId))) throw new AppError(DEMO_SIN_MODULO, 409);
  if ((await contarDatosDeNegocio(organizationId)) > 0) throw new AppError(DEMO_CON_DATOS, 409);
  await exigirUsuariosDeLaDemo(organizationId, usuarios);

  // --- Sucursales y horarios -------------------------------------------------
  // La primera le hereda la zona a la organización (que ya nace con ella).
  const sucursales = {} as Record<ClaveDeSucursal, string>;
  for (const [clave, datos] of Object.entries(SUCURSALES) as [
    ClaveDeSucursal,
    (typeof SUCURSALES)[ClaveDeSucursal],
  ][]) {
    const sucursal = await createBranch(organizationId, {
      name: datos.nombre,
      timezone: ZONA_DE_LA_DEMO,
      defaultOwnerId: usuarios[datos.responsable],
    });
    await replaceBusinessHoursForBranch(organizationId, sucursal.id, datos.horario);
    sucursales[clave] = sucursal.id;
  }

  // --- La agenda del taller (Casa Central) ----------------------------------
  const recurso = await createResource(organizationId, {
    branchId: sucursales.central,
    name: AGENDA_DEL_TALLER.recurso,
    type: "ROOM",
  });
  const turno = await createServiceType(organizationId, {
    branchId: sucursales.central,
    resourceId: recurso.id,
    name: AGENDA_DEL_TALLER.turno,
    durationMin: AGENDA_DEL_TALLER.duracionMin,
  });
  // Sin horario del recurso no hay disponibilidad (availability.service.ts):
  // el de la sucursal.
  await replaceWorkingHoursForResource(organizationId, recurso.id, HORARIO_DE_LOS_RECURSOS);
  await crearAgendaDeLaPruebaDeManejo(organizationId, sucursales.central);

  // --- Proceso de venta ------------------------------------------------------
  const pipeline = await createPipeline(organizationId, { name: PROCESO_DE_VENTA.nombre });
  const etapas = {} as Record<ClaveDeEtapa, string>;
  for (const etapa of PROCESO_DE_VENTA.etapas) {
    const creada = await createStage(organizationId, {
      pipelineId: pipeline.id,
      name: etapa.nombre,
      probability: etapa.probabilidad,
      isWon: etapa.ganada === true,
      isLost: etapa.perdida === true,
    });
    etapas[etapa.clave] = creada.id;
  }

  // --- Taller: moneda y tipos de service -----------------------------------
  await guardarConfiguracion(organizationId, { ...CONFIGURACION_DEL_TALLER });
  const tiposDeService = {} as Record<ClaveDeTipoDeService, string>;
  for (const [clave, datos] of Object.entries(TIPOS_DE_SERVICE) as [
    ClaveDeTipoDeService,
    (typeof TIPOS_DE_SERVICE)[ClaveDeTipoDeService],
  ][]) {
    const tipo = await crearTipo(organizationId, {
      name: datos.nombre,
      nextServiceAfterMonths: datos.meses,
    });
    tiposDeService[clave] = tipo.id;
  }

  // --- Campos personalizados -------------------------------------------------
  const campos = {} as Record<ClaveDeCampo, string>;
  for (const [clave, datos] of Object.entries(CAMPOS_PERSONALIZADOS) as [
    ClaveDeCampo,
    (typeof CAMPOS_PERSONALIZADOS)[ClaveDeCampo],
  ][]) {
    const definicion = await crearDefinicion(organizationId, {
      label: datos.label,
      type: datos.type,
      ...(datos.options ? { options: datos.options } : {}),
    });
    campos[clave] = definicion.key;
  }

  // --- Base de conocimiento --------------------------------------------------
  for (const entrada of BASE_DE_CONOCIMIENTO) {
    await createKnowledgeBaseEntry(organizationId, {
      branchId: sucursales.central,
      title: entrada.titulo,
      content: entrada.contenido,
    });
  }

  // --- Agente (activo, WhatsApp + web, sin número ni página) -----------------
  const agente = await createAgent(organizationId, {
    branchId: sucursales.central,
    name: AGENTE.name,
    goal: AGENTE.goal,
    instructions: AGENTE.instructions,
    tone: AGENTE.tone,
    enabledTools: AGENTE.enabledTools,
    channels: AGENTE.channels,
    allowedOrigins: [],
    guardrails: {},
    guardrailsText: "",
    isActive: true,
  });
  // El modelo de la demo, por el camino del platform admin (ver
  // MODELO_DEL_AGENTE_DE_LA_DEMO en src/clinicas/demo/config.ts).
  await asignarModeloDeAgente({
    agentId: agente.id,
    ...modeloDeLaDemo.parse(MODELO_DEL_AGENTE_DE_LA_DEMO),
    platformAdminUserId: opciones.platformAdminUserId ?? usuarios.admin,
  });
  // Un token de widget, para el probador y para la página local opcional. El
  // texto no se guarda ni se devuelve: se crea otro desde la pantalla.
  await createEmbedToken(organizationId, agente.id);

  // --- QR y automatizaciones -------------------------------------------------
  const qr = await createDigitalQrCode(organizationId, {
    branchId: sucursales.central,
    name: QR_DE_RESENA.name,
    destinationUrl: QR_DE_RESENA.destinationUrl,
    message: null,
  });
  // La regla del recordatorio manda WhatsApp con plantilla: se crea como desde
  // la pantalla (crearReglaConMensaje), y en modo demo la plantilla queda
  // APPROVED sin pasar por Meta (depsDePlantillasPara).
  const reglaDelRecordatorio = await crearReglaConMensaje(organizationId, {
    name: NOMBRE_DE_LAS_REGLAS.recordatorio,
    triggerType: TRIGGER_NEXT_SERVICE_DUE,
    triggerConfig: { offsetDays: REGLA_DEL_RECORDATORIO.offsetDays },
    actionType: ACTION_SEND_NEXT_SERVICE_REMINDER,
    actionConfig: { messageText: REGLA_DEL_RECORDATORIO.messageText, tareaSiNoTieneWhatsapp: true },
    isActive: true,
  });
  await createAutomation(organizationId, {
    name: NOMBRE_DE_LAS_REGLAS.recambio,
    triggerType: TRIGGER_RECAMBIO,
    triggerConfig: {},
    actionType: ACTION_CREATE_FOLLOW_UP,
    actionConfig: { ...REGLA_DEL_RECAMBIO },
    isActive: true,
  });
  await createAutomation(organizationId, {
    name: NOMBRE_DE_LAS_REGLAS.ventaGanada,
    triggerType: TRIGGER_OPPORTUNITY_WON,
    actionType: ACTION_CREATE_FOLLOW_UP,
    actionConfig: { ...REGLA_DE_LA_VENTA_GANADA },
    isActive: true,
  });
  // Inactiva: se explica en la reunión, no se muestra.
  await createAutomation(organizationId, {
    name: NOMBRE_DE_LAS_REGLAS.resena,
    triggerType: TRIGGER_OPPORTUNITY_WON,
    actionType: ACTION_SEND_QR_FOLLOWUP,
    actionConfig: { qrCodeId: qr.id, delayMinutes: DEMORA_DEL_QR_MIN, whatsappFormat: "LINK" },
    isActive: false,
  });

  // --- Datos de uso ------------------------------------------------------------
  const uso = await cargarDatosDeUso(
    organizationId,
    {
      sucursales,
      agenda: { recursoId: recurso.id, turnoId: turno.id },
      reglaDelRecordatorioId: reglaDelRecordatorio.id,
      proceso: { pipelineId: pipeline.id, etapas },
      tiposDeService,
      campos,
      agenteId: agente.id,
    },
    usuarios,
    opciones.ahora,
  );

  return {
    sucursales: Object.keys(SUCURSALES).length,
    etapas: PROCESO_DE_VENTA.etapas.length,
    tiposDeService: Object.keys(TIPOS_DE_SERVICE).length,
    camposPersonalizados: Object.keys(CAMPOS_PERSONALIZADOS).length,
    entradasDeConocimiento: BASE_DE_CONOCIMIENTO.length,
    agentes: 1,
    qrs: 1,
    automatizaciones: 4,
    ...uso,
  };
}

/** El recurso y el tipo de turno "Prueba de manejo" de Casa Central, con el
 *  horario de la sucursal. Idempotente: si ya están (por nombre), no crea
 *  nada; si el recurso no tiene horario, se lo pone. La usan el alta y el
 *  reinicio (para una demo creada antes del ensayo del 2026-10-17). */
export async function crearAgendaDeLaPruebaDeManejo(
  organizationId: string,
  sucursalId: string,
): Promise<{ recursoId: string; turnoId: string }> {
  const vigente = { organizationId, deletedAt: null };
  const recurso =
    (await prisma.resource.findFirst({
      where: { ...vigente, branchId: sucursalId, name: PRUEBA_DE_MANEJO.recurso },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    })) ??
    (await createResource(organizationId, {
      branchId: sucursalId,
      name: PRUEBA_DE_MANEJO.recurso,
      type: "ROOM",
    }));
  if ((await prisma.workingHours.count({ where: { resourceId: recurso.id } })) === 0) {
    await replaceWorkingHoursForResource(organizationId, recurso.id, HORARIO_DE_LOS_RECURSOS);
  }
  const turno =
    (await prisma.serviceType.findFirst({
      where: { ...vigente, resourceId: recurso.id, name: PRUEBA_DE_MANEJO.turno },
      select: { id: true },
    })) ??
    (await createServiceType(organizationId, {
      branchId: sucursalId,
      resourceId: recurso.id,
      name: PRUEBA_DE_MANEJO.turno,
      durationMin: PRUEBA_DE_MANEJO.duracionMin,
    }));
  return { recursoId: recurso.id, turnoId: turno.id };
}

async function exigirUsuariosDeLaDemo(organizationId: string, usuarios: UsuariosDeLaDemo) {
  const ids = [...new Set(Object.values(usuarios))];
  const filas = await prisma.user.findMany({
    where: { id: { in: ids }, organizationId, deletedAt: null },
    select: { id: true, role: { select: { name: true } } },
  });
  if (filas.length !== ids.length) {
    throw new AppError("Los usuarios indicados no son de esa organización", 400);
  }
  if (filas.find((f) => f.id === usuarios.admin)?.role.name !== "ADMIN") {
    throw new AppError("El administrador indicado no es ADMIN de esa organización", 400);
  }
}

// ---------------------------------------------------------------------------
// Los datos de uso: lo que un reinicio borra y vuelve a cargar
// ---------------------------------------------------------------------------

export async function cargarDatosDeUso(
  organizationId: string,
  configuracion: ConfiguracionDeLaDemo,
  usuarios: UsuariosDeLaDemo,
  ahora: Date = new Date(),
  opciones: {
    /** Lo que va en la MISMA transacción, antes de lo masivo: el borrado del
     *  reinicio (reinicioDelTallerDemo.service.ts). Si algo falla, la demo
     *  queda como estaba. */
    antesDelMasivo?: (tx: Db) => Promise<void>;
  } = {},
): Promise<ResumenDeDatosDeUso> {
  const masivo = await prisma.$transaction(
    async (tx) => {
      if (opciones.antesDelMasivo) await opciones.antesDelMasivo(tx);
      return cargarMasivo(tx, organizationId, configuracion, usuarios, ahora);
    },
    { ...OPCIONES_DE_TRANSACCION_LARGA, timeout: 60_000 },
  );
  const ordenes = await cargarOrdenes(organizationId, configuracion, usuarios, masivo, ahora);
  let fichasDeStock = 0;
  for (const branchId of Object.values(configuracion.sucursales)) {
    const r = await sincronizarStockConBaseDeConocimiento(organizationId, branchId);
    fichasDeStock += r.creadas + r.actualizadas;
  }
  return { ...masivo.resumen, ...ordenes, fichasDeStock };
}

interface ResultadoDelMasivo {
  contactos: string[];
  vehiculosDeClientes: Record<string, { id: string; contactId: string; branchId: string }>;
  turnos: Record<string, string>;
  /** Milisegundos que se corrió hacia atrás la conversación de cada contacto. */
  corrimientos: Record<number, number>;
  resumen: Omit<ResumenDeDatosDeUso, "ordenes" | "aprobaciones" | "avisos" | "fichasDeStock">;
}

async function cargarMasivo(
  tx: Db,
  organizationId: string,
  configuracion: ConfiguracionDeLaDemo,
  usuarios: UsuariosDeLaDemo,
  ahora: Date,
): Promise<ResultadoDelMasivo> {
  const hoy = hoyEnLaDemo(ahora);
  const { sucursales, proceso, campos, agenteId } = configuracion;

  // --- Contactos ----------------------------------------------------------------
  const contactos: string[] = [];
  for (const c of CONTACTOS) {
    const camposDelContacto = c.campos
      ? Object.fromEntries(
          Object.entries(c.campos).map(([clave, valor]) => [campos[clave as ClaveDeCampo], valor]),
        )
      : undefined;
    const creado = await tx.contact.create({
      data: {
        organizationId,
        firstName: c.nombre,
        lastName: c.apellido,
        email: c.email,
        phone: c.telefono,
        source: c.fuente,
        ownerId: usuarios.vendedor,
        createdAt: hoy.minus({ days: c.hace }).set({ hour: 11 }).toJSDate(),
        ...(camposDelContacto ? { customFields: camposDelContacto } : {}),
        ...(c.sinInteres
          ? {
              noInterestAt: hoy.minus({ days: Math.max(0, c.hace - 10) }).toJSDate(),
              noInterestNote: c.sinInteres,
            }
          : {}),
      },
      select: { id: true },
    });
    contactos.push(creado.id);
  }
  // El contacto del probador: sin teléfono ni email, y con el vendedor de
  // dueño (una derivación del agente le llega al dueño del contacto).
  await tx.contact.create({
    data: {
      organizationId,
      firstName: CONTACTO_DEL_PROBADOR.nombre,
      lastName: CONTACTO_DEL_PROBADOR.apellido,
      source: "Web",
      ownerId: usuarios.vendedor,
    },
  });

  // --- Identidades de canal (Instagram, Messenger) --------------------------
  for (const i of IDENTIDADES_DE_CANAL) {
    await createContactChannelIdentity(
      { organizationId, channel: i.canal, externalId: i.id, contactId: contactos[i.contacto] },
      tx,
    );
  }

  // --- Fuente "Landing" con sus eventos promovidos ----------------------------
  const fuente = await tx.source.create({
    data: { organizationId, name: FUENTE_LANDING.nombre, type: "WEBHOOK", isActive: true },
    select: { id: true },
  });
  for (const e of FUENTE_LANDING.eventos) {
    const contacto = CONTACTOS[e.contacto];
    await tx.ingestionEvent.create({
      data: {
        organizationId,
        sourceId: fuente.id,
        externalId: e.externalId,
        rawPayload: {
          nombre: `${contacto.nombre} ${contacto.apellido}`,
          email: contacto.email,
          telefono: contacto.telefono,
          mensaje: e.formulario,
        },
        status: "PROCESSED",
        attempts: 1,
        promotedContactId: contactos[e.contacto],
        createdAt: hoy.minus({ days: contacto.hace }).set({ hour: 10 }).toJSDate(),
      },
    });
  }

  // --- Stock ----------------------------------------------------------------
  // Lo que garantiza createVehicle: el número de stock de la organización y el
  // código interno. Publicadas (sin fotos: el agente las conoce igual) y con
  // el estado que les deja la oportunidad que las retiene.
  const unidades = {} as Record<ClaveDeUnidad, string>;
  let n = 0;
  for (const [clave, u] of Object.entries(STOCK) as [
    ClaveDeUnidad,
    (typeof STOCK)[ClaveDeUnidad],
  ][]) {
    n++;
    const stockNumber = await assignNextVehicleStockNumber(organizationId, tx);
    const precioLocal =
      u.soloPesos ?? (u.precioUsd !== null ? u.precioUsd * COTIZACION_DE_EJEMPLO : null);
    const creada = await tx.vehicle.create({
      data: {
        organizationId,
        internalCode: formatInternalCode(stockNumber),
        condition: "USED",
        make: u.marca,
        model: u.modelo,
        year: u.anio,
        bodyType: u.carroceria,
        fuelType: u.combustible,
        transmission: u.caja,
        exteriorColor: u.color,
        mileage: u.km,
        priceListUsd: u.precioUsd,
        priceListLocal: precioLocal,
        publicationCurrency: u.soloPesos ? "LOCAL_ONLY" : "BOTH",
        priceOnRequest: u.aConsultar === true,
        status: u.estado,
        statusBeforeHold: u.estado === "AVAILABLE" ? null : "AVAILABLE",
        branchId: sucursales[u.sucursal],
        origin: "DIRECT_PURCHASE",
        licensePlate: `SBD ${String(1000 + n)}`,
        vin: `DEMO0000000000${String(n).padStart(3, "0")}`,
        titleHolder: "Taller Demo",
        singleOwner: true,
        stockEnteredAt: fechaCalendario(hoy.minus({ days: 90 - n * 5 })),
        availableSince: fechaCalendario(hoy.minus({ days: 85 - n * 5 })),
        publishOnWebsite: true,
        visibleInListing: true,
        financingAvailable: true,
        acceptsTradeIn: true,
        publicDescription: u.descripcion,
        assignedSalespersonId: usuarios.vendedor,
      },
      select: { id: true },
    });
    unidades[clave] = creada.id;
  }

  // --- Oportunidades ---------------------------------------------------------------
  const fechas = fechasDeLasOportunidades(ahora);
  const oportunidades: string[] = [];
  for (const [i, o] of OPORTUNIDADES.entries()) {
    const etapa = PROCESO_DE_VENTA.etapas.find((e) => e.clave === o.etapa)!;
    const status = etapa.ganada ? "WON" : etapa.perdida ? "LOST" : "OPEN";
    const creada = await tx.opportunity.create({
      data: {
        organizationId,
        ownerId: usuarios[o.duena ?? "vendedor"],
        pipelineId: proceso.pipelineId,
        stageId: proceso.etapas[o.etapa],
        title: o.titulo,
        amount: o.montoUsd,
        currency: "USD",
        status,
        contactId: contactos[o.contacto],
        ...(o.unidad ? { vehicleId: unidades[o.unidad] } : {}),
        leadSource: o.origen,
        createdAt: fechas[i].creada,
        actualCloseDate: fechas[i].cerrada,
        expectedCloseDate: fechas[i].esperada,
        ...(o.motivoDePerdida ? { lostReason: o.motivoDePerdida } : {}),
      },
      select: { id: true },
    });
    oportunidades.push(creada.id);
    if (status === "WON") {
      // Lo que hace createOpportunity al ganar: el contacto pasa a cliente y la
      // unidad vendida tiene su entrega.
      await tx.contact.updateMany({
        where: { id: contactos[o.contacto], organizationId },
        data: { lifecycleStage: "CUSTOMER", customerSince: fechas[i].cerrada },
      });
      if (o.unidad) {
        await createDeliveryForSoldVehicle(organizationId, creada.id, unidades[o.unidad], tx);
      }
    }
  }

  // --- Vehículos de clientes --------------------------------------------------
  const fechasDeVehiculos = fechasDeLosVehiculosDeClientes(ahora);
  const vehiculosDeClientes: ResultadoDelMasivo["vehiculosDeClientes"] = {};
  for (const [i, v] of VEHICULOS_DE_CLIENTES.entries()) {
    const venta = v.venta !== undefined ? OPORTUNIDADES[v.venta] : undefined;
    const creado = await tx.customerVehicle.create({
      data: {
        organizationId,
        contactId: contactos[v.contacto],
        branchId: sucursales[v.sucursal],
        make: v.marca,
        model: v.modelo,
        year: v.anio,
        licensePlate: v.patente,
        licensePlateNorm: v.patente.replace(/[^A-Z0-9]/gi, "").toUpperCase(),
        mileage: v.km,
        purchasedOn: fechasDeVehiculos[i].compra,
        nextServiceDueOn: fechasDeVehiculos[i].proximoService,
        ...(v.venta !== undefined
          ? {
              sourceOpportunityId: oportunidades[v.venta],
              ...(venta?.unidad ? { sourceVehicleId: unidades[venta.unidad] } : {}),
            }
          : {}),
        createdAt: noDespuesDe(
          ahora,
          fechasDeVehiculos[i].compra ?? hoy.minus({ days: 30 }).toJSDate(),
        ),
      },
      select: { id: true },
    });
    vehiculosDeClientes[v.clave] = {
      id: creado.id,
      contactId: contactos[v.contacto],
      branchId: sucursales[v.sucursal],
    };
  }

  // --- Conversaciones y mensajes (salientes simulados: SENT, id demo:…) ----------
  const nombreDeLaOrganizacion =
    (await tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } }))
      ?.name ?? "Taller Demo";
  let mensajes = 0;
  // Cuánto se corrió hacia atrás cada conversación `enHorario`, por contacto:
  // la orden que la acompaña (conLaConversacionDe) se corre lo mismo.
  const corrimientos: Record<number, number> = {};
  for (const c of CONVERSACIONES) {
    const segunHace = horasAtras(ahora, c.hace);
    const inicio = inicioDeLaConversacion(c, ahora);
    corrimientos[c.contacto] = segunHace.getTime() - inicio.getTime();
    const ultimo = new Date(inicio.getTime() + c.mensajes[c.mensajes.length - 1].minuto * 60_000);
    const contacto = CONTACTOS[c.contacto];
    const identidad = IDENTIDADES_DE_CANAL.find(
      (i) => i.contacto === c.contacto && i.canal === c.canal,
    );
    const persona = usuarios[c.transferidaA ?? "vendedor"];
    const conversacion = await tx.conversation.create({
      data: {
        organizationId,
        branchId: sucursales.central,
        agentId: agenteId,
        contactId: contactos[c.contacto],
        channel: c.canal,
        status: c.estado,
        externalThreadId: identidad?.id ?? contacto.telefono.replace("+", ""),
        createdAt: inicio,
        lastMessageAt: ultimo,
        ...(c.estado === "TRANSFERRED_TO_HUMAN"
          ? {
              assignedUserId: persona,
              transferredToHumanAt: new Date(inicio.getTime() + 2 * 60_000),
            }
          : {}),
      },
      select: { id: true },
    });
    for (const m of c.mensajes) {
      const saliente = m.de !== "CONTACTO";
      const enviado = new Date(inicio.getTime() + m.minuto * 60_000);
      const externalMessageId = idSimulado();
      let contenido = m.texto;
      if (m.recordatorio) {
        contenido = await sembrarRecordatorioEnviado(tx, {
          organizationId,
          reglaId: configuracion.reglaDelRecordatorioId,
          vehiculo: vehiculosDeClientes[m.recordatorio],
          datos: VEHICULOS_DE_CLIENTES.find((v) => v.clave === m.recordatorio)!,
          proximoService:
            fechasDeVehiculos[VEHICULOS_DE_CLIENTES.findIndex((v) => v.clave === m.recordatorio)]
              .proximoService,
          nombre: contacto.nombre,
          lugar: `${nombreDeLaOrganizacion} (${SUCURSALES.central.nombre})`,
          texto: m.texto,
          enviado,
          externalMessageId,
        });
      }
      await tx.message.create({
        data: {
          organizationId,
          conversationId: conversacion.id,
          direction: saliente ? "OUTBOUND" : "INBOUND",
          senderType:
            m.de === "CONTACTO"
              ? "CONTACT"
              : m.de === "AGENTE"
                ? "AGENT"
                : m.de === "AUTOMATIZACION"
                  ? "AUTOMATION"
                  : "HUMAN",
          senderUserId: m.de === "PERSONA" ? persona : null,
          content: contenido,
          externalMessageId,
          ...(saliente ? { deliveryStatus: "SENT" } : {}),
          ...(m.tools ? { toolCalls: m.tools as unknown as Prisma.InputJsonValue } : {}),
          createdAt: enviado,
        },
      });
      mensajes++;
    }
  }

  // --- Tareas -------------------------------------------------------------------------
  for (const t of TAREAS) {
    const vence = hoy.plus({ days: t.vence }).set({ hour: t.hora ?? 18 });
    const completada =
      t.completadaHace !== undefined
        ? hoy.minus({ days: t.completadaHace }).set({ hour: 12 })
        : null;
    const creada = (completada ?? vence).minus({ days: 3 });
    await tx.activity.create({
      data: {
        organizationId,
        type: t.tipo,
        authorId: usuarios[t.para],
        assigneeId: usuarios[t.para],
        subject: t.asunto,
        ...(t.cuerpo ? { body: t.cuerpo } : {}),
        ...(t.contacto !== undefined ? { contactId: contactos[t.contacto] } : {}),
        ...(t.oportunidad !== undefined ? { opportunityId: oportunidades[t.oportunidad] } : {}),
        dueDate: vence.toJSDate(),
        completedAt: completada?.toJSDate() ?? null,
        occurredAt: noDespuesDe(ahora, creada.toJSDate()),
        createdAt: noDespuesDe(ahora, creada.toJSDate()),
      },
    });
  }

  // --- Turnos de taller, la semana que viene (CONFIRMED; uno se cancela después de
  // vincularlo a su orden, en cargarOrdenes) ----------------------------------------
  const turnos: Record<string, string> = {};
  for (const [i, f] of fechasDeLosTurnos(ahora).entries()) {
    const t = TURNOS[i];
    const creado = await tx.booking.create({
      data: {
        organizationId,
        branchId: sucursales.central,
        serviceTypeId: configuracion.agenda.turnoId,
        resourceId: configuracion.agenda.recursoId,
        contactId: contactos[t.contacto],
        startsAt: f.inicio,
        endsAt: f.fin,
        status: "CONFIRMED",
      },
      select: { id: true },
    });
    turnos[t.clave] = creado.id;
  }

  return {
    contactos,
    vehiculosDeClientes,
    turnos,
    corrimientos,
    resumen: {
      contactos: CONTACTOS.length + 1,
      identidadesDeCanal: IDENTIDADES_DE_CANAL.length,
      eventosDeIngesta: FUENTE_LANDING.eventos.length,
      unidades: Object.keys(STOCK).length,
      oportunidades: OPORTUNIDADES.length,
      vehiculosDeClientes: VEHICULOS_DE_CLIENTES.length,
      conversaciones: CONVERSACIONES.length,
      mensajes,
      tareas: TAREAS.length,
      turnos: TURNOS.length,
    },
  };
}

/**
 * El recordatorio de próximo service que la regla "mandó" (Simulado): lo que
 * dejan el barrido y el worker del taller (src/servicios/recordatorio/) cuando
 * sale un WhatsApp. El aviso del vehículo (así el barrido no lo vuelve a
 * avisar), la fila de la cola ENVIADA con un id demo:, y el texto de la regla
 * con sus variables, que va en la conversación del cliente. En la demo el
 * worker no lo puede mandar en vivo: sin número de WhatsApp conectado no sale
 * nada, ni siquiera simulado (por eso se siembra).
 */
async function sembrarRecordatorioEnviado(
  tx: Db,
  d: {
    organizationId: string;
    reglaId: string;
    vehiculo: { id: string; contactId: string; branchId: string };
    datos: { marca: string; modelo: string; patente: string };
    proximoService: Date | null;
    nombre: string;
    lugar: string;
    texto: string;
    enviado: Date;
    externalMessageId: string;
  },
): Promise<string> {
  if (!d.proximoService) throw new Error("El recordatorio sembrado necesita un próximo service");
  const aviso = await tx.customerVehicleNotice.create({
    data: {
      organizationId: d.organizationId,
      customerVehicleId: d.vehiculo.id,
      kind: "NEXT_SERVICE",
      dueOn: d.proximoService,
      source: "AUTOMATICO",
      automationId: d.reglaId,
      createdAt: d.enviado,
    },
    select: { id: true },
  });
  await tx.serviceMessage.create({
    data: {
      organizationId: d.organizationId,
      kind: "NEXT_SERVICE",
      automationId: d.reglaId,
      noticeId: aviso.id,
      customerVehicleId: d.vehiculo.id,
      contactId: d.vehiculo.contactId,
      branchId: d.vehiculo.branchId,
      dueKey: d.proximoService,
      scheduledFor: d.enviado,
      nextAttemptAt: d.enviado,
      status: "SENT",
      attempts: 1,
      sentAt: d.enviado,
      externalMessageId: d.externalMessageId,
      createdAt: d.enviado,
    },
  });
  const fecha = DateTime.fromJSDate(d.proximoService, { zone: "utc" })
    .setLocale("es")
    .toFormat("d 'de' LLLL");
  return d.texto
    .replace("{nombre}", d.nombre)
    .replace("{lugar}", d.lugar)
    .replace("{vehiculo}", `${d.datos.marca} ${d.datos.modelo} (${d.datos.patente})`)
    .replace("{fecha}", `el ${fecha}`);
}

// ---------------------------------------------------------------------------
// Las órdenes, por los services, y después el corrimiento de sus fechas
// ---------------------------------------------------------------------------

async function cargarOrdenes(
  organizationId: string,
  configuracion: ConfiguracionDeLaDemo,
  usuarios: UsuariosDeLaDemo,
  masivo: ResultadoDelMasivo,
  ahoraDeLaCarga: Date,
): Promise<Pick<ResumenDeDatosDeUso, "ordenes" | "aprobaciones" | "avisos">> {
  const hoy = hoyEnLaDemo(ahoraDeLaCarga);
  const encargado = usuarios.taller;
  let aprobaciones = 0;
  let avisos = 0;

  for (const o of ORDENES) {
    // Las fechas de una orden que acompaña a una conversación `enHorario` se
    // cuentan desde un "ahora" corrido lo mismo que ella.
    const ahora =
      o.conLaConversacionDe === undefined
        ? ahoraDeLaCarga
        : new Date(ahoraDeLaCarga.getTime() - (masivo.corrimientos[o.conLaConversacionDe] ?? 0));
    const vehiculo = masivo.vehiculosDeClientes[o.vehiculo];
    const [primero, ...siguientes] = o.pasos;
    const creada = await crearOrden(organizationId, encargado, {
      customerVehicleId: vehiculo.id,
      contactId: vehiculo.contactId,
      branchId: configuracion.sucursales.central,
      estado: primero.estado === "RECIBIDO" ? "RECIBIDO" : "AGENDADO",
      ...(primero.estado === "RECIBIDO"
        ? { mileageIn: primero.km }
        : o.turno
          ? { bookingId: masivo.turnos[o.turno] }
          : { scheduledFor: horasAtras(ahora, primero.horasAtras) }),
      assigneeId: encargado,
      jobTypeIds: o.tipos.map((t) => configuracion.tiposDeService[t]),
      notes: o.notas,
      amount: o.valor,
      currency: CONFIGURACION_DEL_TALLER.currency,
    });
    const id = creada.id;

    let desde = primero.estado;
    for (const paso of siguientes) {
      if (paso.aprobacion) {
        await registrarAprobacion(organizationId, encargado, id, {
          description: paso.aprobacion.descripcion,
          decision: paso.aprobacion.decision,
          approverName: paso.aprobacion.quien,
          channel: paso.aprobacion.canal,
          decidedAt: horasAtras(ahora, paso.horasAtras + 1),
          amount: paso.aprobacion.monto,
          currency: CONFIGURACION_DEL_TALLER.currency,
          sumarAlValor: paso.aprobacion.decision === "APROBADO",
        });
        aprobaciones++;
      }
      await cambiarEstado(organizationId, encargado, id, {
        desde,
        hacia: paso.estado,
        ...(paso.nota ? { nota: paso.nota } : {}),
        ...(paso.km !== undefined ? { mileageIn: paso.km } : {}),
        ...(paso.motivo ? { cancelReason: paso.motivo } : {}),
        ...(paso.estado === "ENTREGADO"
          ? {
              proximoService:
                paso.proximoServiceEnDias === null || paso.proximoServiceEnDias === undefined
                  ? null
                  : fechaDeTexto(hoy.plus({ days: paso.proximoServiceEnDias })),
            }
          : {}),
      });
      desde = paso.estado;
    }
    if (o.avisado) {
      const cuando =
        o.avisadoHorasAtras === undefined ? ahora : horasAtras(ahora, o.avisadoHorasAtras);
      const [aviso] = await registrarAviso(organizationId, encargado, id, o.avisado, cuando);
      // La pantalla muestra el createdAt de la nota, y registrarAviso solo
      // fecha el completedAt: sin esto el aviso salía con la hora del
      // reinicio (ensayo del 2026-10-17). Escritura directa, como las fechas
      // del historial.
      await prisma.activity.update({ where: { id: aviso.id }, data: { createdAt: cuando } });
      avisos++;
    }

    // Las fechas del historial, hacia atrás (escritura directa aprobada): la
    // orden nació y cambió de estado cuando dice `pasos`, no recién.
    await correrFechasDeLaOrden(organizationId, id, o.pasos, ahora);
  }

  // El turno de la OS-0011 se canceló después de agendarla: "turnos cancelados".
  const cancelados = TURNOS.filter((t) => t.cancelado);
  for (const t of cancelados) {
    await prisma.booking.updateMany({
      where: { id: masivo.turnos[t.clave], organizationId },
      data: { status: "CANCELLED" },
    });
  }

  return { ordenes: ORDENES.length, aprobaciones, avisos };
}

async function correrFechasDeLaOrden(
  organizationId: string,
  serviceOrderId: string,
  pasos: (typeof ORDENES)[number]["pasos"],
  ahora: Date,
): Promise<void> {
  const cambios = await prisma.serviceOrderStatusChange.findMany({
    where: { organizationId, serviceOrderId },
    orderBy: { changedAt: "asc" },
    select: { id: true },
  });
  if (cambios.length !== pasos.length) {
    logger.warn(
      { organizationId, serviceOrderId, cambios: cambios.length, pasos: pasos.length },
      "Taller Demo: el historial de la orden no tiene la cantidad de pasos esperada",
    );
  }
  const momentos = pasos.map((p) => horasAtras(ahora, p.horasAtras));
  for (const [i, cambio] of cambios.entries()) {
    const momento = momentos[Math.min(i, momentos.length - 1)];
    await prisma.serviceOrderStatusChange.update({
      where: { id: cambio.id },
      data: { changedAt: momento },
    });
  }
  const ultimoDe = (estado: string) => {
    const i = pasos.map((p) => p.estado).lastIndexOf(estado as (typeof pasos)[number]["estado"]);
    return i === -1 ? undefined : momentos[i];
  };
  await prisma.serviceOrder.updateMany({
    where: { id: serviceOrderId, organizationId },
    data: {
      createdAt: momentos[0],
      ...(ultimoDe("RECIBIDO") ? { receivedAt: ultimoDe("RECIBIDO") } : {}),
      ...(ultimoDe("EN_TRABAJO") ? { workStartedAt: ultimoDe("EN_TRABAJO") } : {}),
      ...(ultimoDe("LISTO_PARA_RETIRAR") ? { readyAt: ultimoDe("LISTO_PARA_RETIRAR") } : {}),
      ...(ultimoDe("ENTREGADO") ? { deliveredAt: ultimoDe("ENTREGADO") } : {}),
      ...(ultimoDe("CANCELADO") ? { cancelledAt: ultimoDe("CANCELADO") } : {}),
    },
  });
  // Una aprobación registrada "antes" del paso que la sigue: su createdAt
  // tiene que quedar después de la última entrada en Esperando aprobación
  // (aprobacionPendienteDe) y antes del paso que habilitó.
  for (const [i, paso] of pasos.entries()) {
    if (!paso.aprobacion) continue;
    await prisma.serviceOrderApproval.updateMany({
      where: { organizationId, serviceOrderId },
      data: { createdAt: new Date(momentos[i].getTime() - 30 * 60_000) },
    });
  }
}
