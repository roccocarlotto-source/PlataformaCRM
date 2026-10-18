import { logger } from "../../lib/logger";
import { prisma, type Db } from "../../lib/prisma";
import { NO_ES_UNA_DEMO } from "../../services/modoDemo.service";
import { tieneElModulo } from "../../servicios/recordatorio/repository";
import { TRIGGER_NEXT_SERVICE_DUE } from "../../servicios/recordatorio/config";
import { replaceWorkingHoursForResource } from "../../services/workingHours.service";
import { AppError } from "../../utils/AppError";
import {
  AGENDA_DEL_TALLER,
  AGENTE,
  CAMPOS_PERSONALIZADOS,
  esSlugDeTallerDemo,
  FUENTE_LANDING,
  HORARIO_DE_LOS_RECURSOS,
  INSTRUCCIONES_ANTERIORES_DEL_AGENTE,
  INSTRUCCIONES_DEL_AGENTE,
  NOMBRE_DE_LAS_REGLAS,
  REGLA_DEL_RECORDATORIO,
  PROCESO_DE_VENTA,
  SUCURSALES,
  TIPOS_DE_SERVICE,
  type ClaveDeCampo,
  type ClaveDeEtapa,
  type ClaveDeSucursal,
  type ClaveDeTipoDeService,
} from "./config";
import {
  cargarDatosDeUso,
  crearAgendaDeLaPruebaDeManejo,
  DEMO_SIN_MODULO,
  type ConfiguracionDeLaDemo,
  type ResumenDeDatosDeUso,
  type UsuariosDeLaDemo,
} from "./datosDeEjemplo";

// ---------------------------------------------------------------------------
// Reiniciar los datos del Taller Demo (docs/taller-demo.md §4), por un
// platform admin: POST /api/admin/organizations/:organizationId/demo/reiniciar
// (el despacho por rubro está en src/services/reinicioDeDemo.service.ts).
//
// Deja la demo como recién creada antes de otra reunión: BORRA los datos de
// uso y vuelve a cargar los de ejemplo (cargarDatosDeUso, la misma función del
// alta) con fechas relativas a hoy. NO TOCA la configuración: la organización
// y su modo demo, las sucursales con su horario y su responsable, la agenda
// del taller, el proceso de venta y sus etapas, los tipos de service y la
// configuración del taller (salvo el contador de órdenes), los campos
// personalizados, la base de conocimiento cargada a mano, el agente y sus
// tokens del widget, las automatizaciones y sus plantillas, el QR, los
// usuarios y las invitaciones. Tampoco llm_turn_usages.
//
// SOLO UNA DEMO: is_demo (lo exige el despacho), rubro AUTOMOTORA y slug del
// Taller Demo. Con cualquier otra organización, 400 sin tocar nada.
//
// NADA SALE: con is_demo los envíos se simulan y Google no se puede conectar
// (src/services/modoDemo.service.ts). Por eso, a diferencia de la Clínica Demo,
// no hace falta exigir reglas inactivas.
//
// ATOMICIDAD. El borrado y la recarga masiva van en UNA transacción (la de
// cargarDatosDeUso, que recibe el borrado como primer paso): si algo falla
// ahí, la demo queda como estaba. Las órdenes de servicio se cargan después,
// por los services: si fallan a mitad, 500 y la demo queda con todo lo masivo
// y parte de las órdenes; volver a reiniciar lo arregla (el borrado es total).
//
// DOS REINICIOS A LA VEZ: el segundo recibe 409 mientras corre el primero (el
// estado en memoria de src/services/reinicioDeDemo.service.ts: el backend
// corre en una sola instancia), y el borrado toma además
// pg_advisory_xact_lock por organización, por si algún día hay más de una.
//
// Las fotos subidas a mano (unidades, órdenes) se borran de la base; sus
// archivos quedan en el bucket, sin nada que los referencie.
// ---------------------------------------------------------------------------

export const DEMO_SIN_ADMIN =
  "El Taller Demo no tiene ningún administrador activo: no hay con quién cargar los datos de ejemplo.";

export function demoSinConfiguracion(faltan: string[]): string {
  return `Al Taller Demo le falta configuración de ejemplo (${faltan.join(", ")}): no se pueden volver a cargar los datos. Restaurala (con el mismo nombre) antes de reiniciar.`;
}

/** Las filas borradas, por tabla. */
export interface DatosDeUsoDelTallerBorrados {
  respuestasDelAgente: number;
  seguimientosDeConsultas: number;
  mensajes: number;
  conversaciones: number;
  mensajesDeTurnos: number;
  mensajesDelTaller: number;
  tareas: number;
  avisosDeVehiculos: number;
  seguimientosDeQr: number;
  seguimientosDeCupones: number;
  cupones: number;
  fotosDeOrdenes: number;
  aprobaciones: number;
  historialDeOrdenes: number;
  tiposDeLasOrdenes: number;
  ordenes: number;
  turnos: number;
  cambiosDeDueno: number;
  vehiculosDeClientes: number;
  entregas: number;
  pagos: number;
  cotizaciones: number;
  oportunidades: number;
  fichasDeStock: number;
  historialDeUnidades: number;
  importacionesDeFotos: number;
  fotosDeUnidades: number;
  unidades: number;
  identidadesDeCanal: number;
  eventosDeIngesta: number;
  vinculosDeImportacion: number;
  fuentes: number;
  contactos: number;
  empresas: number;
  ejecucionesDeAutomatizaciones: number;
  eventosDeSalida: number;
}

export interface ResultadoDelReinicioDelTaller {
  organizationId: string;
  borrados: DatosDeUsoDelTallerBorrados;
  cargados: ResumenDeDatosDeUso;
}

/** El reinicio en dos tiempos (reinicio en segundo plano,
 *  src/services/reinicioDeDemo.service.ts): primero TODO lo que puede impedir
 *  la recarga, sin escribir nada (400/409 enseguida, en el POST); devuelve la
 *  parte que escribe, que es la que tarda unos tres minutos. */
export async function prepararReinicioDelTallerDemo(
  organizationId: string,
  opciones: { ahora?: Date } = {},
): Promise<() => Promise<ResultadoDelReinicioDelTaller>> {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { slug: true, industry: true, isDemo: true },
  });
  if (!org) throw new AppError("Organización no encontrada", 404);
  if (!org.isDemo || org.industry !== "AUTOMOTORA" || !esSlugDeTallerDemo(org.slug)) {
    throw new AppError(NO_ES_UNA_DEMO, 400);
  }

  // Todo lo que puede impedir la recarga se mira ANTES de borrar.
  if (!(await tieneElModulo(organizationId))) throw new AppError(DEMO_SIN_MODULO, 409);
  const usuarios = await usuariosDelTaller(organizationId);
  // Primero la validación (409 si falta algo, sin escribir nada); después
  // alinear lo que cambió desde el alta (no cambia ningún id de la config).
  const configuracion = await configuracionDelTaller(organizationId);

  return async () => {
    await alinearConfiguracion(organizationId, usuarios);
    let borrados: DatosDeUsoDelTallerBorrados | undefined;
    const cargados = await cargarDatosDeUso(
      organizationId,
      configuracion,
      usuarios,
      opciones.ahora,
      {
        antesDelMasivo: async (tx) => {
          borrados = await borrarDatosDeUso(tx, organizationId);
        },
      },
    );
    logger.info({ organizationId, borrados, cargados }, "Taller Demo reiniciado");
    return { organizationId, borrados: borrados!, cargados };
  };
}

/** La configuración de la demo, por los nombres de config.ts. Si alguien
 *  borró o renombró una pieza, 409 (antes de borrar nada). */
async function configuracionDelTaller(organizationId: string): Promise<ConfiguracionDeLaDemo> {
  const faltan: string[] = [];
  const vigente = { organizationId, deletedAt: null };

  const sucursalesDeLaBase = await prisma.branch.findMany({
    where: { ...vigente, name: { in: Object.values(SUCURSALES).map((s) => s.nombre) } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  const sucursales = {} as Record<ClaveDeSucursal, string>;
  for (const [clave, datos] of Object.entries(SUCURSALES) as [
    ClaveDeSucursal,
    (typeof SUCURSALES)[ClaveDeSucursal],
  ][]) {
    const sucursal = sucursalesDeLaBase.find((s) => s.name === datos.nombre);
    if (!sucursal) faltan.push(`sucursal ${datos.nombre}`);
    else sucursales[clave] = sucursal.id;
  }

  const recurso = sucursales.central
    ? await prisma.resource.findFirst({
        where: { ...vigente, branchId: sucursales.central, name: AGENDA_DEL_TALLER.recurso },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      })
    : null;
  const turno = recurso
    ? await prisma.serviceType.findFirst({
        where: { ...vigente, resourceId: recurso.id, name: AGENDA_DEL_TALLER.turno },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      })
    : null;
  if (!recurso || !turno) faltan.push(`agenda del taller (${AGENDA_DEL_TALLER.turno})`);

  const pipeline = await prisma.pipeline.findFirst({
    where: { ...vigente, name: PROCESO_DE_VENTA.nombre },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, stages: { where: { deletedAt: null }, select: { id: true, name: true } } },
  });
  const etapas = {} as Record<ClaveDeEtapa, string>;
  if (!pipeline) {
    faltan.push(`proceso ${PROCESO_DE_VENTA.nombre}`);
  } else {
    for (const etapa of PROCESO_DE_VENTA.etapas) {
      const deLaBase = pipeline.stages.find((s) => s.name === etapa.nombre);
      if (!deLaBase) faltan.push(`etapa ${etapa.nombre}`);
      else etapas[etapa.clave] = deLaBase.id;
    }
  }

  const tiposDeLaBase = await prisma.serviceJobType.findMany({
    where: { ...vigente, name: { in: Object.values(TIPOS_DE_SERVICE).map((t) => t.nombre) } },
    select: { id: true, name: true },
  });
  const tiposDeService = {} as Record<ClaveDeTipoDeService, string>;
  for (const [clave, datos] of Object.entries(TIPOS_DE_SERVICE) as [
    ClaveDeTipoDeService,
    (typeof TIPOS_DE_SERVICE)[ClaveDeTipoDeService],
  ][]) {
    const tipo = tiposDeLaBase.find((t) => t.name === datos.nombre);
    if (!tipo) faltan.push(`tipo de service ${datos.nombre}`);
    else tiposDeService[clave] = tipo.id;
  }

  const camposDeLaBase = await prisma.contactCustomFieldDefinition.findMany({
    where: { ...vigente, label: { in: Object.values(CAMPOS_PERSONALIZADOS).map((c) => c.label) } },
    select: { key: true, label: true },
  });
  const campos = {} as Record<ClaveDeCampo, string>;
  for (const [clave, datos] of Object.entries(CAMPOS_PERSONALIZADOS) as [
    ClaveDeCampo,
    (typeof CAMPOS_PERSONALIZADOS)[ClaveDeCampo],
  ][]) {
    const campo = camposDeLaBase.find((c) => c.label === datos.label);
    if (!campo) faltan.push(`campo ${datos.label}`);
    else campos[clave] = campo.key;
  }

  const agente = await prisma.agent.findFirst({
    where: { ...vigente, name: AGENTE.name },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!agente) faltan.push(`agente ${AGENTE.name}`);

  const reglaDelRecordatorio = await prisma.automation.findFirst({
    where: {
      ...vigente,
      triggerType: TRIGGER_NEXT_SERVICE_DUE,
      name: NOMBRE_DE_LAS_REGLAS.recordatorio,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!reglaDelRecordatorio) faltan.push(`regla ${NOMBRE_DE_LAS_REGLAS.recordatorio}`);

  if (faltan.length > 0) throw new AppError(demoSinConfiguracion(faltan), 409);
  return {
    sucursales,
    agenda: { recursoId: recurso!.id, turnoId: turno!.id },
    proceso: { pipelineId: pipeline!.id, etapas },
    tiposDeService,
    campos,
    agenteId: agente!.id,
    reglaDelRecordatorioId: reglaDelRecordatorio!.id,
  };
}

/** Los tres usuarios de la demo: el ADMIN más viejo; el vendedor, que es el
 *  responsable por defecto de Sucursal Este (como lo deja el alta); y el
 *  encargado del taller, el otro USER activo. Desde el ensayo del 2026-10-17
 *  Casa Central también tiene al vendedor de responsable, así que el encargado
 *  ya no sale de ahí. Un usuario que falta se reemplaza por el admin. */
async function usuariosDelTaller(organizationId: string): Promise<UsuariosDeLaDemo> {
  const activos = { organizationId, deletedAt: null, isActive: true };
  const admin = await prisma.user.findFirst({
    where: { ...activos, role: { name: "ADMIN" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!admin) throw new AppError(DEMO_SIN_ADMIN, 409);
  const este = await prisma.branch.findFirst({
    where: { organizationId, deletedAt: null, name: SUCURSALES.este.nombre },
    select: { defaultOwnerId: true },
  });
  const vendedor = este?.defaultOwnerId
    ? await prisma.user.findFirst({
        where: { ...activos, id: este.defaultOwnerId },
        select: { id: true },
      })
    : null;
  const taller = await prisma.user.findFirst({
    where: {
      ...activos,
      role: { name: "USER" },
      ...(vendedor ? { id: { not: vendedor.id } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return {
    admin: admin.id,
    vendedor: vendedor?.id ?? admin.id,
    taller: taller?.id ?? admin.id,
  };
}

/**
 * Alinea la configuración de una demo creada antes con la de hoy (config.ts),
 * sin tocar lo que alguien haya cambiado a propósito. Idempotente: en una demo
 * al día no escribe nada. Viene del ensayo del 2026-10-17:
 *
 *   - Casa Central con el vendedor de responsable (las derivaciones de venta);
 *   - el recurso del taller con el horario de la sucursal (sin horario no hay
 *     disponibilidad), y la agenda de la prueba de manejo;
 *   - el agente con las herramientas de hoy (se agregan las que faltan) y,
 *     si sus instrucciones siguen siendo las del alta anterior, las de hoy;
 *   - la regla del recordatorio a 7 días ANTES, si sigue en los 7 días
 *     después del alta anterior.
 */
async function alinearConfiguracion(
  organizationId: string,
  usuarios: UsuariosDeLaDemo,
): Promise<void> {
  const vigente = { organizationId, deletedAt: null };
  const central = await prisma.branch.findFirst({
    where: { ...vigente, name: SUCURSALES.central.nombre },
    select: { id: true, defaultOwnerId: true },
  });
  if (central) {
    if (central.defaultOwnerId !== usuarios.vendedor) {
      await prisma.branch.updateMany({
        where: { id: central.id, organizationId },
        data: { defaultOwnerId: usuarios.vendedor },
      });
    }
    const taller = await prisma.resource.findFirst({
      where: { ...vigente, branchId: central.id, name: AGENDA_DEL_TALLER.recurso },
      select: { id: true },
    });
    if (taller && (await prisma.workingHours.count({ where: { resourceId: taller.id } })) === 0) {
      await replaceWorkingHoursForResource(organizationId, taller.id, HORARIO_DE_LOS_RECURSOS);
    }
    await crearAgendaDeLaPruebaDeManejo(organizationId, central.id);
  }

  const agente = await prisma.agent.findFirst({
    where: { ...vigente, name: AGENTE.name },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, enabledTools: true, instructions: true },
  });
  if (agente) {
    const faltan = AGENTE.enabledTools.filter((tool) => !agente.enabledTools.includes(tool));
    const instruccionesViejas = agente.instructions === INSTRUCCIONES_ANTERIORES_DEL_AGENTE;
    if (faltan.length > 0 || instruccionesViejas) {
      await prisma.agent.updateMany({
        where: { id: agente.id, organizationId },
        data: {
          enabledTools: [...agente.enabledTools, ...faltan],
          ...(instruccionesViejas ? { instructions: INSTRUCCIONES_DEL_AGENTE } : {}),
        },
      });
    }
  }

  const regla = await prisma.automation.findFirst({
    where: {
      ...vigente,
      triggerType: TRIGGER_NEXT_SERVICE_DUE,
      name: NOMBRE_DE_LAS_REGLAS.recordatorio,
    },
    select: { id: true, triggerConfig: true },
  });
  const offset = (regla?.triggerConfig as { offsetDays?: unknown } | null)?.offsetDays;
  if (regla && offset === -REGLA_DEL_RECORDATORIO.offsetDays) {
    await prisma.automation.updateMany({
      where: { id: regla.id, organizationId },
      data: { triggerConfig: { offsetDays: REGLA_DEL_RECORDATORIO.offsetDays } },
    });
  }
}

/**
 * Borra los datos de uso de UNA organización, dentro de la transacción de la
 * recarga. El orden sale de las FKs (todas compuestas con organization_id):
 * hijas antes que madres. Tres ciclos se cortan antes, poniendo en NULL la
 * referencia: el próximo service fijado por una orden (customer_vehicles →
 * service_orders → customer_vehicles), la unidad de interés de un contacto
 * (contacts → vehicles) y la unidad recibida en permuta (vehicles →
 * opportunities → vehicles). Un dato de uso que no esté acá y tenga una FK a
 * algo de lo borrado hace fallar la sentencia: la transacción revierte y la
 * demo queda como estaba (lo detecta el test de reinicio).
 */
async function borrarDatosDeUso(
  tx: Db,
  organizationId: string,
): Promise<DatosDeUsoDelTallerBorrados> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
  const where = { organizationId };
  const n = async (p: Promise<{ count: number }>) => (await p).count;

  await tx.customerVehicle.updateMany({
    where: { organizationId, nextServiceSetFromOrderId: { not: null } },
    data: { nextServiceSetFromOrderId: null },
  });
  await tx.contact.updateMany({
    where: { organizationId, vehicleOfInterestId: { not: null } },
    data: { vehicleOfInterestId: null, vehicleOfInterestSetBy: null },
  });
  await tx.vehicle.updateMany({
    where: { organizationId, tradeInOpportunityId: { not: null } },
    data: { tradeInOpportunityId: null },
  });

  const fuentes = await tx.source.findMany({
    where: { organizationId, name: FUENTE_LANDING.nombre, type: "WEBHOOK" },
    select: { id: true },
  });
  const idsDeFuentes = fuentes.map((f) => f.id);

  const borrados: DatosDeUsoDelTallerBorrados = {
    respuestasDelAgente: await n(tx.agentInboundJob.deleteMany({ where })),
    seguimientosDeConsultas: await n(tx.inquiryFollowUp.deleteMany({ where })),
    mensajes: await n(tx.message.deleteMany({ where })),
    conversaciones: await n(tx.conversation.deleteMany({ where })),
    mensajesDeTurnos: await n(tx.bookingMessage.deleteMany({ where })),
    mensajesDelTaller: await n(tx.serviceMessage.deleteMany({ where })),
    tareas: await n(tx.activity.deleteMany({ where })),
    avisosDeVehiculos: await n(tx.customerVehicleNotice.deleteMany({ where })),
    seguimientosDeQr: await n(tx.qrFollowUp.deleteMany({ where })),
    seguimientosDeCupones: await n(tx.discountVoucherFollowUp.deleteMany({ where })),
    cupones: await n(tx.discountVoucher.deleteMany({ where })),
    fotosDeOrdenes: await n(tx.serviceOrderPhoto.deleteMany({ where })),
    aprobaciones: await n(tx.serviceOrderApproval.deleteMany({ where })),
    historialDeOrdenes: await n(tx.serviceOrderStatusChange.deleteMany({ where })),
    tiposDeLasOrdenes: await n(tx.serviceOrderJobType.deleteMany({ where })),
    ordenes: await n(tx.serviceOrder.deleteMany({ where })),
    turnos: await n(tx.booking.deleteMany({ where })),
    cambiosDeDueno: await n(tx.customerVehicleOwnerChange.deleteMany({ where })),
    vehiculosDeClientes: await n(tx.customerVehicle.deleteMany({ where })),
    entregas: await n(tx.delivery.deleteMany({ where })),
    pagos: await n(tx.payment.deleteMany({ where })),
    cotizaciones: await n(tx.quote.deleteMany({ where })),
    oportunidades: await n(tx.opportunity.deleteMany({ where })),
    // Solo las fichas que generó la sincronización del stock: las cargadas a
    // mano son configuración.
    fichasDeStock: await n(
      tx.knowledgeBaseEntry.deleteMany({
        where: { organizationId, sourceVehicleId: { not: null } },
      }),
    ),
    historialDeUnidades: await n(tx.vehicleChangeLog.deleteMany({ where })),
    importacionesDeFotos: await n(tx.vehiclePhotoImport.deleteMany({ where })),
    fotosDeUnidades: await n(tx.vehiclePhoto.deleteMany({ where })),
    unidades: await n(tx.vehicle.deleteMany({ where })),
    identidadesDeCanal: await n(tx.contactChannelIdentity.deleteMany({ where })),
    eventosDeIngesta: await n(tx.ingestionEvent.deleteMany({ where })),
    vinculosDeImportacion: await n(
      tx.externalRecordLink.deleteMany({
        where: {
          organizationId,
          OR: [{ entityType: { in: ["CONTACT", "ACTIVITY"] } }, { sourceId: { in: idsDeFuentes } }],
        },
      }),
    ),
    // La fuente "Landing" de los datos de ejemplo: se vuelve a crear.
    fuentes: await n(tx.source.deleteMany({ where: { organizationId, id: { in: idsDeFuentes } } })),
    contactos: await n(tx.contact.deleteMany({ where })),
    empresas: await n(tx.company.deleteMany({ where })),
    ejecucionesDeAutomatizaciones: await n(tx.automationExecution.deleteMany({ where })),
    eventosDeSalida: await n(tx.outboxEvent.deleteMany({ where })),
  };

  // Los contadores, para que la demo vuelva a OS-0001 y STK-000001.
  await tx.workshopSettings.updateMany({ where, data: { nextOrderNumber: 1 } });
  await tx.organization.update({
    where: { id: organizationId },
    data: { nextVehicleStockNumber: 1 },
  });
  return borrados;
}
