import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { DateTime } from "luxon";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import {
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../../routes/gateDeModulos.test-helper";
import { registroDeAcciones } from "../../services/automationActions";
import { ACCIONES_INCORPORADAS } from "../../services/automationRegistrations";
import { esIdSimulado, esOrganizacionDemo, NO_ES_UNA_DEMO } from "../../services/modoDemo.service";
import { getDashboardSummary } from "../../services/opportunity.service";
import { reenviarInvitacionDelAdministrador } from "../../services/organizationAdmin.service";
import { activarModulo } from "../../services/organizationModules.service";
import { ejecutarPurga, simularPurga } from "../../services/testOrganizationsPurge.service";
import { resumenDelTaller } from "../../servicios/services/dashboard.service";
import { aprobacionPendienteDe } from "../../servicios/services/ordenes.service";
import { AppError } from "../../utils/AppError";
import {
  depsDePlantillasReales,
  sincronizarPlantillaDeLaRegla,
} from "../../services/whatsappTemplate.service";
import {
  CONTACTOS,
  esSlugDeTallerDemo,
  MODELO_DEL_AGENTE_DE_LA_DEMO,
  NOMBRE_DE_LAS_REGLAS,
  OPORTUNIDADES,
  ORDENES,
  STOCK,
  TAREAS,
  TIPOS_DE_SERVICE,
  VEHICULOS_DE_CLIENTES,
  ZONA_DE_LA_DEMO,
} from "./config";
import { cargarDatosDeEjemplo, DEMO_CON_DATOS, DEMO_SOLO_EN_MODO_DEMO } from "./datosDeEjemplo";
import { YA_SE_ESTA_REINICIANDO } from "./reinicioDelTallerDemo.service";
import { EMAILS_REPETIDOS } from "./tallerDemo.service";

// ---------------------------------------------------------------------------
// El Taller Demo (docs/taller-demo.md), contra la app real, Postgres y GoTrue
// locales. Qué se afirma: el alta por un platform admin crea la organización
// EN MODO DEMO con el módulo Servicios y sus tres usuarios, y carga los datos
// de ejemplo tal como los cuentan las pantallas (Dashboard, Resumen del
// taller); nada real sale (la plantilla de la regla queda APPROVED con un id
// demo:, los salientes de las conversaciones llevan id demo:); la purga de
// organizaciones de test nunca la toca; sin modo demo no se cargan datos.
//
// LIMPIEZA. Como la Clínica Demo: la demo tiene el slug `taller-demo-…`, que
// la purga nunca toca (y lo prueba este archivo). El after() la renombra a un
// slug de este archivo (demo-taller-…, en PATRONES_DE_SLUG_DE_PRUEBA) y corre
// la purga acotada a las organizaciones de este archivo.
// ---------------------------------------------------------------------------

let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);
const ruta = "/api/admin/organizations/taller-demo";

let plataforma: OrgDePrueba;
let comun: OrgDePrueba;
const orgsDeTest: string[] = [];
let demo:
  | {
      organization: { id: string; slug: string };
      admin: { id: string };
      usuarios: Record<
        "admin" | "vendedor" | "taller",
        { id: string; email: string; invitacionEnviada: boolean }
      >;
      datosDeEjemplo: Record<string, number>;
    }
  | undefined;

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  for (const accion of ACCIONES_INCORPORADAS) registroDeAcciones.registrar(accion);
  plataforma = await crearOrgDePrueba("demo-taller", "COMPLETA", "AUTOMOTORA", 1);
  comun = await crearOrgDePrueba("demo-taller", "COMPLETA", "AUTOMOTORA", 1);
  orgsDeTest.push(plataforma.id, comun.id);
  await prisma.platformAdmin.create({ data: { userId: plataforma.authIds[0] } });
});

after(async () => {
  if (cerrar) await cerrar();
  if (plataforma) {
    await prisma.platformAdmin.deleteMany({ where: { userId: plataforma.authIds[0] } });
  }
  if (demo) {
    await prisma.organization.update({
      where: { id: demo.organization.id },
      data: { slug: `demo-taller-limpieza-${Date.now()}-${randomUUID().slice(0, 8)}` },
    });
    orgsDeTest.push(demo.organization.id);
  }
  const { resultados } = await ejecutarPurga(prisma, {
    protegidas: [],
    alcance: { organizaciones: orgsDeTest, identidades: [] },
  });
  const fallidas = resultados.filter((r) => !r.ok);
  assert.deepEqual(fallidas, [], "la limpieza de las organizaciones de test falló");
});

function emailDePrueba(etiqueta: string): string {
  return `demo-taller-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
}

function usuariosDePrueba(etiqueta: string) {
  return {
    admin: { fullName: "Valentina de Prueba", email: emailDePrueba(`${etiqueta}-admin`) },
    vendedor: { fullName: "Martín de Prueba", email: emailDePrueba(`${etiqueta}-vendedor`) },
    taller: { fullName: "Diego de Prueba", email: emailDePrueba(`${etiqueta}-taller`) },
  };
}

async function esperarAppError(fn: () => Promise<unknown>, status: number): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof AppError, `esperaba AppError, vino ${String(err)}`);
    assert.equal(err.statusCode, status, err.message);
    return err;
  }
  assert.fail(`esperaba un AppError ${String(status)} y no lanzó nada`);
}

async function conteos(organizationId: string) {
  const where = { organizationId };
  return {
    sucursales: await prisma.branch.count({ where }),
    contactos: await prisma.contact.count({ where }),
    unidades: await prisma.vehicle.count({ where }),
    oportunidades: await prisma.opportunity.count({ where }),
    ordenes: await prisma.serviceOrder.count({ where }),
    usuarios: await prisma.user.count({ where }),
  };
}

/**
 * Los datos de uso del Taller Demo recién cargados (en el alta o en el
 * reinicio), tal como los cuentan las pantallas: Conversaciones, Stock,
 * Contactos, Dashboard, tareas, órdenes y el Resumen del taller
 * (docs/taller-demo.md §3).
 */
async function verificarDatosDeUso(id: string, tallerId: string) {
  // Conversaciones: los salientes SENT con id demo:, los entrantes sin estado.
  const mensajes = await prisma.message.findMany({ where: { organizationId: id } });
  assert.equal(mensajes.length, 18);
  for (const m of mensajes) {
    assert.ok(esIdSimulado(m.externalMessageId));
    if (m.direction === "OUTBOUND") assert.equal(m.deliveryStatus, "SENT");
  }
  const transferida = await prisma.conversation.findFirstOrThrow({
    where: { organizationId: id, status: "TRANSFERRED_TO_HUMAN" },
  });
  assert.equal(transferida.assignedUserId, tallerId);

  // Stock: una reservada, dos vendidas con su entrega, el resto publicado y
  // conocido por el agente (fichas sincronizadas en la base de conocimiento).
  const unidades = await prisma.vehicle.findMany({ where: { organizationId: id } });
  assert.equal(unidades.filter((u) => u.status === "RESERVED").length, 1);
  assert.equal(unidades.filter((u) => u.status === "SOLD").length, 2);
  assert.equal(unidades.filter((u) => u.status === "AVAILABLE").length, 7);
  assert.equal(new Set(unidades.map((u) => u.internalCode)).size, unidades.length);
  assert.equal(await prisma.delivery.count({ where: { organizationId: id } }), 2);
  assert.equal(
    await prisma.knowledgeBaseEntry.count({
      where: { organizationId: id, sourceVehicleId: { not: null } },
    }),
    7,
  );

  // Contactos: los compradores son clientes; dos sin interés; el visitante del probador.
  const contactos = await prisma.contact.findMany({ where: { organizationId: id } });
  assert.equal(contactos.length, CONTACTOS.length + 1);
  assert.equal(contactos.filter((c) => c.lifecycleStage === "CUSTOMER").length, 4);
  assert.equal(contactos.filter((c) => c.noInterestAt !== null).length, 2);
  assert.ok(contactos.some((c) => c.firstName === "Visitante" && c.phone === null));
  assert.ok(contactos.every((c) => c.email === null || c.email.endsWith("@example.com")));

  // Dashboard (mes): 6 abiertas por 98.200; creadas 7 / 5; ganadas 2 (41.500) / 2 (36.000); perdidas 1 / 2.
  const dashboard = await getDashboardSummary(id, { granularity: "month" });
  assert.equal(dashboard.openCount, 6);
  assert.equal(dashboard.openValue, "98200.00");
  assert.equal(dashboard.createdThisPeriod.count, 7);
  assert.equal(dashboard.createdLastPeriod.count, 5);
  assert.equal(dashboard.wonThisPeriod.count, 2);
  assert.equal(dashboard.wonThisPeriod.value, "41500.00");
  assert.equal(dashboard.wonLastPeriod.count, 2);
  assert.equal(dashboard.wonLastPeriod.value, "36000.00");
  assert.equal(dashboard.lostCountThisPeriod, 1);
  assert.equal(dashboard.lostCountLastPeriod, 2);

  // Tareas: 3 vencidas, 2 completadas.
  const ahora = new Date();
  const tareas = await prisma.activity.findMany({
    where: { organizationId: id, type: { in: ["TASK", "CALL", "MEETING"] } },
  });
  assert.equal(tareas.length, TAREAS.length);
  assert.equal(
    tareas.filter(
      (t) =>
        t.completedAt === null &&
        t.dueDate &&
        t.dueDate < ahora &&
        DateTime.fromJSDate(t.dueDate, { zone: ZONA_DE_LA_DEMO }) <
          DateTime.fromJSDate(ahora, { zone: ZONA_DE_LA_DEMO }).startOf("day"),
    ).length,
    3,
  );
  assert.equal(tareas.filter((t) => t.completedAt !== null).length, 2);

  // Taller: OS-0001 a OS-0011 con el historial corrido, y el Resumen.
  const ordenes = await prisma.serviceOrder.findMany({
    where: { organizationId: id },
    orderBy: { number: "asc" },
  });
  assert.deepEqual(
    ordenes.map((o) => o.number),
    ORDENES.map((_, i) => i + 1),
  );
  assert.deepEqual(
    ordenes.map((o) => o.status),
    ORDENES.map((o) => o.pasos[o.pasos.length - 1].estado),
  );
  const entregada = ordenes[0];
  assert.ok(
    entregada.deliveredAt &&
      entregada.deliveredAt < new Date(ahora.getTime() - 100 * 24 * 3_600_000),
  );
  assert.ok(entregada.nextServiceDueOn, "la entrega fijó el próximo service");
  const clio = await prisma.customerVehicle.findFirstOrThrow({
    where: { organizationId: id, model: "Clio Mío" },
  });
  assert.equal(clio.nextServiceSetFromOrderId, entregada.id);
  const con2008 = await prisma.serviceOrder.findFirstOrThrow({
    where: { id: ordenes[5].id },
    include: {
      statusChanges: { include: { changedBy: { select: { id: true, fullName: true } } } },
      approvals: { include: { recordedBy: { select: { id: true, fullName: true } } } },
    },
  });
  assert.equal(con2008.approvals.length, 1);
  assert.equal(Number(con2008.amount), 10600 + 14200, "la aprobación se sumó al valor");
  assert.equal(aprobacionPendienteDe(con2008), false);
  const esperando = await prisma.serviceOrder.findFirstOrThrow({
    where: { id: ordenes[6].id },
    include: {
      statusChanges: { include: { changedBy: { select: { id: true, fullName: true } } } },
      approvals: { include: { recordedBy: { select: { id: true, fullName: true } } } },
    },
  });
  assert.equal(aprobacionPendienteDe(esperando), true);

  const resumen = await resumenDelTaller(id, { role: "ADMIN", industry: "AUTOMOTORA" });
  assert.deepEqual(resumen.enElTaller, {
    total: 6,
    porEstado: { RECIBIDO: 2, EN_TRABAJO: 2, ESPERANDO_APROBACION: 2 },
  });
  assert.equal(resumen.listosParaRetirar.total, 1);
  assert.equal(resumen.esperandoAprobacion.total, 1, "esperando aprobación hace más de 24 h");
  assert.equal(resumen.servicesVencidos.total, 2);
  assert.equal(resumen.servicesEn30Dias.total, 3);
  assert.equal(resumen.turnosCancelados.total, 1);
  assert.deepEqual(resumen.recambiosProximos, { total: 2, sinFechaDeCompra: 2 });
  assert.equal(resumen.recambiosVencidos.total, 3);

  // "Avisar al cliente" quedó registrado en la orden lista.
  assert.equal(
    await prisma.activity.count({
      where: { organizationId: id, sourceServiceOrderId: ordenes[8].id },
    }),
    1,
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Quién puede, y qué no deja nada a medias
// ---------------------------------------------------------------------------

test("sin sesión 401 y un ADMIN que no es platform admin 403, sin crear nada", async () => {
  const usuarios = usuariosDePrueba("prohibido");
  const body = { sufijo: "Prohibido", usuarios };
  assert.equal((await pedir(comun, "POST", ruta, body, null)).status, 401);
  assert.equal((await pedir(comun, "POST", ruta, body)).status, 403);
  assert.equal(await prisma.user.findUnique({ where: { email: usuarios.admin.email } }), null);
  assert.equal(
    await prisma.organization.findUnique({ where: { slug: "taller-demo-prohibido" } }),
    null,
  );
});

test("emails repetidos 400, un email ya usado 409 y un body que elige rubro 400: nada creado", async () => {
  const usuarios = usuariosDePrueba("invalido");
  const repetidos = await pedir(plataforma, "POST", ruta, {
    sufijo: "Repetido",
    usuarios: { ...usuarios, taller: { ...usuarios.taller, email: usuarios.vendedor.email } },
  });
  assert.equal(repetidos.status, 400);
  assert.equal(repetidos.json.error?.message, EMAILS_REPETIDOS);

  // El email del vendedor ya es de un usuario: 409 antes de crear la organización.
  const ocupado = await prisma.user.findFirstOrThrow({ where: { organizationId: comun.id } });
  const enUso = await pedir(plataforma, "POST", ruta, {
    sufijo: "Ocupado",
    usuarios: { ...usuarios, vendedor: { ...usuarios.vendedor, email: ocupado.email } },
  });
  assert.equal(enUso.status, 409);
  assert.equal(
    await prisma.organization.findUnique({ where: { slug: "taller-demo-ocupado" } }),
    null,
  );
  assert.equal(await prisma.user.findUnique({ where: { email: usuarios.admin.email } }), null);

  const conRubro = await pedir(plataforma, "POST", ruta, { usuarios, industry: "CLINICA" });
  assert.equal(conRubro.status, 400);
});

// ---------------------------------------------------------------------------
// La demo
// ---------------------------------------------------------------------------

test("el platform admin crea el Taller Demo: 201, modo demo, módulo Servicios, tres usuarios y los datos de ejemplo", async () => {
  const antesPlataforma = await conteos(plataforma.id);
  const antesComun = await conteos(comun.id);
  const usuarios = usuariosDePrueba("feliz");
  const sufijo = `Test ${Date.now()} ${randomUUID().slice(0, 8)}`;

  const res = await pedir(plataforma, "POST", ruta, { sufijo, usuarios });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  demo = res.json as unknown as typeof demo;
  const id = demo!.organization.id;

  // La organización: automotora COMPLETA, en modo demo, con el módulo.
  assert.ok(esSlugDeTallerDemo(demo!.organization.slug), demo!.organization.slug);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id } });
  assert.equal(org.name, `Taller Demo ${sufijo}`);
  assert.equal(org.industry, "AUTOMOTORA");
  assert.equal(org.edition, "COMPLETA");
  assert.equal(org.isDemo, true);
  assert.equal(await esOrganizacionDemo(id), true);
  assert.equal(org.timezone, ZONA_DE_LA_DEMO);
  assert.equal(org.preferredCurrency, "USD");
  assert.equal(org.defaultPhoneCountryCode, "598");
  const modulo = await prisma.organizationModule.findUnique({
    where: { organizationId_module: { organizationId: id, module: "servicios" } },
  });
  assert.ok(modulo && modulo.disabledAt === null, "el módulo Servicios está activo");
  const taller = await prisma.workshopSettings.findUniqueOrThrow({ where: { organizationId: id } });
  assert.equal(taller.currency, "UYU");

  // Los tres usuarios, con su rol, y los tres mails salieron (GoTrue local).
  const usuariosCreados = await prisma.user.findMany({
    where: { organizationId: id },
    include: { role: true },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    usuariosCreados.map((u) => [u.email, u.role.name]).sort(),
    [
      [usuarios.admin.email, "ADMIN"],
      [usuarios.vendedor.email, "USER"],
      [usuarios.taller.email, "USER"],
    ].sort(),
  );
  assert.equal(demo!.admin.id, demo!.usuarios.admin.id);
  for (const clave of ["admin", "vendedor", "taller"] as const) {
    assert.equal(demo!.usuarios[clave].invitacionEnviada, true, clave);
    assert.equal(demo!.usuarios[clave].email, usuarios[clave].email);
  }
  // Sin filas de Invitation: los tres son usuarios desde el alta.
  assert.equal(await prisma.invitation.count({ where: { organizationId: id } }), 0);

  // Lo cargado, en números.
  assert.deepEqual(demo!.datosDeEjemplo, {
    sucursales: 2,
    etapas: 6,
    tiposDeService: Object.keys(TIPOS_DE_SERVICE).length,
    camposPersonalizados: 2,
    entradasDeConocimiento: 8,
    agentes: 1,
    qrs: 1,
    automatizaciones: 4,
    contactos: CONTACTOS.length + 1,
    identidadesDeCanal: 5,
    eventosDeIngesta: 2,
    unidades: Object.keys(STOCK).length,
    oportunidades: OPORTUNIDADES.length,
    vehiculosDeClientes: VEHICULOS_DE_CLIENTES.length,
    conversaciones: 3,
    mensajes: 18,
    tareas: TAREAS.length,
    turnos: 3,
    ordenes: ORDENES.length,
    aprobaciones: 1,
    avisos: 1,
    fichasDeStock: 7,
  });

  // Sucursales con su responsable: Casa Central → taller, Sucursal Este → vendedor.
  const sucursales = await prisma.branch.findMany({
    where: { organizationId: id },
    orderBy: { name: "asc" },
  });
  assert.deepEqual(
    sucursales.map((s) => [s.name, s.defaultOwnerId]),
    [
      ["Casa Central", demo!.usuarios.taller.id],
      ["Sucursal Este", demo!.usuarios.vendedor.id],
    ],
  );

  // El agente: activo, WhatsApp + web, con el modelo de la demo, sin número ni página.
  const agente = await prisma.agent.findFirstOrThrow({ where: { organizationId: id } });
  assert.equal(agente.isActive, true);
  assert.deepEqual([...agente.channels].sort(), ["WEB", "WHATSAPP"]);
  assert.equal(agente.modelName, MODELO_DEL_AGENTE_DE_LA_DEMO.modelName);
  assert.equal(agente.whatsappPhoneNumberId, null);
  assert.equal(agente.facebookPageId, null);
  assert.equal(await prisma.agentEmbedToken.count({ where: { agentId: agente.id } }), 1);

  // Nada salió. La regla del recordatorio manda WhatsApp con plantilla y en
  // modo demo la sincronización no pasa por Meta (plantillasSimuladas). Con la
  // conexión global configurada (producción) queda APPROVED con un id demo:
  // en el alta; en un entorno sin WABA (este), la regla se guarda con el error
  // "sin conexión" y acá se la sincroniza con una conexión de prueba y espías
  // que LANZAN si se llama a Meta.
  const recordatorio = await prisma.automation.findFirstOrThrow({
    where: { organizationId: id, name: NOMBRE_DE_LAS_REGLAS.recordatorio },
  });
  assert.equal(recordatorio.isActive, true);
  if (!env.WHATSAPP_BUSINESS_ACCOUNT_ID || !env.WHATSAPP_ACCESS_TOKEN) {
    assert.ok(recordatorio.templateSyncError, "sin conexión: la regla guardó el error");
    const explota = (nombre: string) => () =>
      Promise.reject(new Error(`${nombre} REAL llamada en modo demo`));
    const r = await sincronizarPlantillaDeLaRegla(id, recordatorio, {
      ...depsDePlantillasReales,
      wabaId: () => "111111111111111",
      accessToken: () => "token-de-prueba",
      create: explota("create"),
      uploadSample: explota("uploadSample"),
      getStatus: explota("getStatus"),
      delete: explota("delete"),
    });
    assert.equal(r.error, null);
  }
  const plantillas = await prisma.whatsappTemplate.findMany({ where: { organizationId: id } });
  assert.ok(plantillas.length >= 1, "la regla sincronizó su plantilla");
  assert.ok(plantillas.every((p) => p.status === "APPROVED" && esIdSimulado(p.metaTemplateId)));
  const reglas = await prisma.automation.findMany({ where: { organizationId: id } });
  assert.deepEqual(
    reglas.map((r) => [r.name, r.isActive]).sort(),
    [
      [NOMBRE_DE_LAS_REGLAS.recambio, true],
      [NOMBRE_DE_LAS_REGLAS.recordatorio, true],
      [NOMBRE_DE_LAS_REGLAS.resena, false],
      [NOMBRE_DE_LAS_REGLAS.ventaGanada, true],
    ].sort(),
  );

  await verificarDatosDeUso(id, demo!.usuarios.taller.id);

  // Aislamiento: ni la organización del platform admin ni la común cambiaron.
  assert.deepEqual(await conteos(plataforma.id), antesPlataforma);
  assert.deepEqual(await conteos(comun.id), antesComun);
});

test("cargarDatosDeEjemplo sobre la demo ya cargada: 409, sin mezclar", async () => {
  assert.ok(demo, "depende del test anterior");
  const antes = await conteos(demo.organization.id);
  const err = await esperarAppError(
    () =>
      cargarDatosDeEjemplo(demo!.organization.id, {
        admin: demo!.usuarios.admin.id,
        vendedor: demo!.usuarios.vendedor.id,
        taller: demo!.usuarios.taller.id,
      }),
    409,
  );
  assert.equal(err.message, DEMO_CON_DATOS);
  assert.deepEqual(await conteos(demo.organization.id), antes);
});

test("en la demo, Reenviar invitación cubre a los tres usuarios que no abrieron el mail", async () => {
  assert.ok(demo, "depende del test de alta");
  const r = await reenviarInvitacionDelAdministrador(demo.organization.id);
  assert.deepEqual(
    [...r.reenviadas].sort(),
    [demo.usuarios.admin.email, demo.usuarios.vendedor.email, demo.usuarios.taller.email].sort(),
  );
  assert.deepEqual(r.sinEnviar, []);
  assert.equal(r.email, r.reenviadas[0]);
});

test("la purga de organizaciones de test nunca toca el Taller Demo", async () => {
  assert.ok(demo, "depende del test de alta");
  const alcance = { organizaciones: [demo.organization.id], identidades: [] };
  const plan = await simularPurga(prisma, { protegidas: [], alcance });
  assert.deepEqual(plan.organizaciones, []);
  const { resultados } = await ejecutarPurga(prisma, { protegidas: [], alcance });
  assert.deepEqual(resultados, []);
  const sigue = await prisma.organization.findUnique({ where: { id: demo.organization.id } });
  assert.ok(sigue && esSlugDeTallerDemo(sigue.slug));
});

// ---------------------------------------------------------------------------
// Sin modo demo no hay datos de ejemplo, aunque el nombre sea el de la demo
// ---------------------------------------------------------------------------

test("una automotora común (aunque tenga el slug de la demo y el módulo) no carga datos: 409 sin escribir nada", async () => {
  const sinDemo = await crearOrgDePrueba("demo-taller", "COMPLETA", "AUTOMOTORA", 1);
  orgsDeTest.push(sinDemo.id);
  await activarModulo(sinDemo.id, "servicios", plataforma.authIds[0]);
  const slugOriginal = (await prisma.organization.findUniqueOrThrow({ where: { id: sinDemo.id } }))
    .slug;
  // El slug de demo NO es una plantilla de PATRONES_DE_SLUG_DE_PRUEBA a
  // propósito: ninguna purga puede reconocer un slug de demo.
  const slugDeDemo = `taller-demo-${randomUUID().slice(0, 8)}`;
  await prisma.organization.update({ where: { id: sinDemo.id }, data: { slug: slugDeDemo } });
  try {
    assert.equal(await esOrganizacionDemo(sinDemo.id), false);
    const antes = await conteos(sinDemo.id);
    const err = await esperarAppError(
      () =>
        cargarDatosDeEjemplo(sinDemo.id, {
          admin: sinDemo.authIds[0],
          vendedor: sinDemo.authIds[0],
          taller: sinDemo.authIds[0],
        }),
      409,
    );
    assert.equal(err.message, DEMO_SOLO_EN_MODO_DEMO);
    assert.deepEqual(await conteos(sinDemo.id), antes);
  } finally {
    // El slug de demo no lo reconoce ninguna purga: se restaura para el after().
    await prisma.organization.update({ where: { id: sinDemo.id }, data: { slug: slugOriginal } });
  }
});

test("el alta común con el nombre de la demo no pone el modo demo", async () => {
  const email = emailDePrueba("alta-comun");
  const nombre = `Taller Demo Comun ${Date.now()} ${randomUUID().slice(0, 8)}`;
  const alta = await pedir(plataforma, "POST", "/api/admin/organizations", {
    organizationName: nombre,
    adminFullName: "Persona de Prueba",
    adminEmail: email,
  });
  assert.equal(alta.status, 201, JSON.stringify(alta.json));
  const creada = alta.json.organization as { id: string };
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: creada.id } });
  assert.equal(org.isDemo, false);
  // Para que la purga del after() la borre.
  await prisma.organization.update({
    where: { id: creada.id },
    data: { slug: `demo-taller-alta-comun-${Date.now()}-${randomUUID().slice(0, 8)}` },
  });
  orgsDeTest.push(creada.id);
});

// ---------------------------------------------------------------------------
// Reiniciar los datos (docs/taller-demo.md §4)
// ---------------------------------------------------------------------------

const rutaDeReinicio = (id: string) => `/api/admin/organizations/${id}/demo/reiniciar`;

test("reiniciar el Taller Demo: borra lo de uso (también lo agregado a mano), conserva la configuración y vuelve a cargar los datos de ejemplo", async () => {
  assert.ok(demo, "depende del test de alta");
  const id = demo.organization.id;
  const where = { organizationId: id };
  const configuracionAntes = {
    sucursales: (await prisma.branch.findMany({ where, orderBy: { id: "asc" } })).map((s) => s.id),
    agentes: (await prisma.agent.findMany({ where })).map((a) => a.id),
    reglas: (await prisma.automation.findMany({ where, orderBy: { id: "asc" } })).map((r) => r.id),
    plantillas: (await prisma.whatsappTemplate.findMany({ where, orderBy: { id: "asc" } })).map(
      (p) => p.id,
    ),
    tipos: (await prisma.serviceJobType.findMany({ where, orderBy: { id: "asc" } })).map(
      (t) => t.id,
    ),
    usuarios: (await prisma.user.findMany({ where, orderBy: { id: "asc" } })).map((u) => u.id),
    tokens: await prisma.agentEmbedToken.count({ where: { agent: { organizationId: id } } }),
    conocimientoManual: await prisma.knowledgeBaseEntry.count({
      where: { ...where, sourceVehicleId: null },
    }),
  };
  // Lo que un usuario cargó durante una reunión: un contacto con una tarea y
  // la unidad de interés (corta el ciclo contacts → vehicles al borrar).
  const extra = await prisma.contact.create({
    data: { organizationId: id, firstName: "Agregado", lastName: "En la reunión" },
  });
  await prisma.activity.create({
    data: {
      organizationId: id,
      type: "TASK",
      authorId: demo.usuarios.admin.id,
      subject: "Tarea agregada",
      contactId: extra.id,
    },
  });
  const unaOportunidad = await prisma.opportunity.findFirstOrThrow({
    where: { ...where, status: "OPEN" },
  });
  const unaUnidad = await prisma.vehicle.findFirstOrThrow({
    where: { ...where, status: "AVAILABLE" },
  });
  await prisma.contact.update({
    where: { id: extra.id },
    data: { vehicleOfInterestId: unaUnidad.id, vehicleOfInterestSetBy: "HUMAN" },
  });

  const res = await pedir(plataforma, "POST", rutaDeReinicio(id));
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const borrados = res.json.borrados as Record<string, number>;
  assert.equal(
    borrados.contactos,
    CONTACTOS.length + 2,
    "los de ejemplo, el visitante y el agregado",
  );
  assert.equal(borrados.ordenes, ORDENES.length);
  assert.equal(await prisma.contact.count({ where: { id: extra.id } }), 0);
  assert.equal(await prisma.opportunity.count({ where: { id: unaOportunidad.id } }), 0);

  // La configuración, con los mismos ids.
  assert.deepEqual(
    {
      sucursales: (await prisma.branch.findMany({ where, orderBy: { id: "asc" } })).map(
        (s) => s.id,
      ),
      agentes: (await prisma.agent.findMany({ where })).map((a) => a.id),
      reglas: (await prisma.automation.findMany({ where, orderBy: { id: "asc" } })).map(
        (r) => r.id,
      ),
      plantillas: (await prisma.whatsappTemplate.findMany({ where, orderBy: { id: "asc" } })).map(
        (p) => p.id,
      ),
      tipos: (await prisma.serviceJobType.findMany({ where, orderBy: { id: "asc" } })).map(
        (t) => t.id,
      ),
      usuarios: (await prisma.user.findMany({ where, orderBy: { id: "asc" } })).map((u) => u.id),
      tokens: await prisma.agentEmbedToken.count({ where: { agent: { organizationId: id } } }),
      conocimientoManual: await prisma.knowledgeBaseEntry.count({
        where: { ...where, sourceVehicleId: null },
      }),
    },
    configuracionAntes,
  );
  const org = await prisma.organization.findUniqueOrThrow({ where: { id } });
  assert.equal(org.isDemo, true);

  // Los datos de uso, como recién creados: OS-0001… y STK-000001… otra vez.
  await verificarDatosDeUso(id, demo.usuarios.taller.id);
  const codigos = (await prisma.vehicle.findMany({ where, orderBy: { internalCode: "asc" } })).map(
    (v) => v.internalCode,
  );
  assert.deepEqual(
    codigos,
    Object.keys(STOCK).map((_, i) => `STK-${String(i + 1).padStart(6, "0")}`),
  );
});

test("reiniciar dos veces a la vez: el segundo recibe 409; después, otro reinicio deja lo mismo", async () => {
  assert.ok(demo, "depende del test de alta");
  const id = demo.organization.id;
  const [a, b] = await Promise.all([
    pedir(plataforma, "POST", rutaDeReinicio(id)),
    pedir(plataforma, "POST", rutaDeReinicio(id)),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const rechazado = a.status === 409 ? a : b;
  assert.equal(rechazado.json.error?.message, YA_SE_ESTA_REINICIANDO);
  await verificarDatosDeUso(id, demo.usuarios.taller.id);
});

test("reiniciar con configuración de ejemplo faltante: 409 antes de borrar nada", async () => {
  assert.ok(demo, "depende del test de alta");
  const id = demo.organization.id;
  const este = await prisma.branch.findFirstOrThrow({
    where: { organizationId: id, name: "Sucursal Este" },
  });
  await prisma.branch.update({
    where: { id: este.id },
    data: { name: "Sucursal Este (renombrada)" },
  });
  try {
    const antes = await conteos(id);
    const res = await pedir(plataforma, "POST", rutaDeReinicio(id));
    assert.equal(res.status, 409);
    assert.match(String(res.json.error?.message), /sucursal Sucursal Este/);
    assert.deepEqual(await conteos(id), antes);
  } finally {
    await prisma.branch.update({ where: { id: este.id }, data: { name: "Sucursal Este" } });
  }
});

test("reiniciar una automotora sin modo demo (aunque tenga el slug del Taller Demo): 400 sin borrar nada", async () => {
  const sinDemo = await crearOrgDePrueba("demo-taller", "COMPLETA", "AUTOMOTORA", 1);
  orgsDeTest.push(sinDemo.id);
  await prisma.contact.create({
    data: { organizationId: sinDemo.id, firstName: "Cliente", lastName: "Real" },
  });
  const { slug } = await prisma.organization.findUniqueOrThrow({ where: { id: sinDemo.id } });
  // El slug de demo NO es una plantilla de PATRONES_DE_SLUG_DE_PRUEBA a propósito.
  const slugDeDemo = `taller-demo-reinicio-${randomUUID().slice(0, 8)}`;
  await prisma.organization.update({ where: { id: sinDemo.id }, data: { slug: slugDeDemo } });
  try {
    const antes = await conteos(sinDemo.id);
    const res = await pedir(plataforma, "POST", rutaDeReinicio(sinDemo.id));
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.message, NO_ES_UNA_DEMO);
    assert.deepEqual(await conteos(sinDemo.id), antes);
  } finally {
    await prisma.organization.update({ where: { id: sinDemo.id }, data: { slug } });
  }
});
