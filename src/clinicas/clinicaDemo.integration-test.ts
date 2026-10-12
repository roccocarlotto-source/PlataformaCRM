import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { DateTime } from "luxon";
import { CLINICA_HABILITADA } from "../config/ediciones";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import {
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { registroDeAcciones } from "../services/automationActions";
import { ACCIONES_INCORPORADAS } from "../services/automationRegistrations";
import { ejecutarPurga, simularPurga } from "../services/testOrganizationsPurge.service";
import { AppError } from "../utils/AppError";
import { env } from "../config/env";
import { createAgent } from "../services/agent.service";
import { createBranch } from "../services/branch.service";
import {
  esSlugDeClinicaDemo,
  MODELO_DEL_AGENTE_DE_LA_DEMO,
  PACIENTES,
  ZONA_DE_LA_DEMO,
} from "./demo/config";
import { cargarDatosDeEjemplo, DEMO_CON_DATOS, DEMO_SOLO_EN_CLINICAS } from "./demo/datosDeEjemplo";
import { programarRecordatorio } from "./recordatorios/programacion.service";
import {
  DEMO_CON_GOOGLE,
  DEMO_CON_RECORDATORIO_ACTIVO,
  NO_ES_UNA_DEMO,
} from "./demo/reinicioDeLaDemo.service";

// ---------------------------------------------------------------------------
// La Clínica Demo (docs/rubros.md §12, R19), contra la app real, Postgres y
// GoTrue locales.
//
// La llave CLINICA_HABILITADA está en false y así se prueba: la demo se crea
// igual por su endpoint, y el alta común de una clínica sigue en 400.
//
// LIMPIEZA. La demo tiene el slug `clinica-demo-…`, que la purga de
// organizaciones de test nunca toca (§12.1, y lo prueba este archivo). Para
// borrarla, el after() la renombra a un slug de este archivo
// (demo-r19-…, registrado en PATRONES_DE_SLUG_DE_PRUEBA) y corre la purga
// acotada a las organizaciones de este archivo.
// ---------------------------------------------------------------------------

let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);
const ruta = "/api/admin/organizations/clinica-demo";

// El platform admin vive en una automotora de test; el ADMIN común, en otra.
let plataforma: OrgDePrueba;
let comun: OrgDePrueba;
// Una clínica vacía, que la demo no puede tocar (aislamiento).
let otraClinica: OrgDePrueba;
const orgsDeTest: string[] = [];
let demo: { organization: { id: string; slug: string }; admin: { id: string } } | undefined;

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  // server.ts registra las acciones del motor al arrancar; la app de test no.
  for (const accion of ACCIONES_INCORPORADAS) registroDeAcciones.registrar(accion);
  plataforma = await crearOrgDePrueba("demo-r19", "COMPLETA", "AUTOMOTORA", 1);
  comun = await crearOrgDePrueba("demo-r19", "COMPLETA", "AUTOMOTORA", 1);
  otraClinica = await crearOrgDePrueba("demo-r19", "COMPLETA", "CLINICA", 1);
  orgsDeTest.push(plataforma.id, comun.id, otraClinica.id);
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
      data: { slug: `demo-r19-limpieza-${Date.now()}-${randomUUID().slice(0, 8)}` },
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

/**
 * Los datos de uso de la demo, recién cargados (en el alta o en el
 * reinicio): 8 pacientes inventados sin teléfono; 24 turnos en los 14 días
 * desde mañana (uno sobreturno, 3 confirmados, ninguno un domingo) y 3
 * atendidos la semana anterior; el bloqueo del viernes; ninguna tarea.
 * Devuelve los turnos próximos.
 */
async function verificarDatosDeUso(id: string) {
  const pacientes = await prisma.contact.findMany({ where: { organizationId: id } });
  assert.equal(pacientes.length, 8);
  assert.ok(pacientes.every((p) => p.phone === null && String(p.email).endsWith("@example.com")));
  assert.deepEqual(
    pacientes.map((p) => `${p.firstName} ${p.lastName}`).sort(),
    PACIENTES.map((p) => `${p.nombre} ${p.apellido}`).sort(),
  );

  const turnos = await prisma.booking.findMany({ where: { organizationId: id } });
  const ahora = DateTime.now().setZone(ZONA_DE_LA_DEMO);
  const manana = ahora.startOf("day").plus({ days: 1 });
  const proximos = turnos.filter((t) => t.startsAt.getTime() > ahora.toMillis());
  const pasados = turnos.filter((t) => t.startsAt.getTime() <= ahora.toMillis());
  assert.equal(proximos.length, 24);
  assert.ok(proximos.every((t) => t.status === "CONFIRMED"));
  assert.equal(proximos.filter((t) => t.isOverbooking).length, 1);
  assert.equal(proximos.filter((t) => t.patientConfirmedAt !== null).length, 3);
  for (const t of proximos) {
    const inicio = DateTime.fromJSDate(t.startsAt, { zone: ZONA_DE_LA_DEMO });
    assert.ok(inicio >= manana && inicio < manana.plus({ days: 14 }), inicio.toISO() ?? "");
    assert.notEqual(inicio.weekday, 7, "ningún turno un domingo");
  }
  // Repartidos en las dos semanas, los tres profesionales y las cuatro
  // prestaciones.
  assert.ok(proximos.some((t) => t.startsAt >= manana.plus({ days: 7 }).toJSDate()));
  assert.equal(new Set(proximos.map((t) => t.resourceId)).size, 3);
  assert.equal(new Set(proximos.map((t) => t.serviceTypeId)).size, 4);
  const lunes = ahora.startOf("week");
  assert.equal(pasados.length, 3);
  assert.ok(
    pasados.every(
      (t) =>
        t.status === "COMPLETED" &&
        t.completedAt !== null &&
        t.completedBy === "PERSONA" &&
        t.startsAt >= lunes.minus({ weeks: 1 }).toJSDate() &&
        t.startsAt < lunes.toJSDate(),
    ),
  );

  const bloqueos = await prisma.resourceTimeOff.findMany({ where: { organizationId: id } });
  assert.equal(bloqueos.length, 1);
  const inicioDelBloqueo = DateTime.fromJSDate(bloqueos[0].startsAt, { zone: ZONA_DE_LA_DEMO });
  assert.equal(inicioDelBloqueo.weekday, 5, "viernes");
  assert.equal(inicioDelBloqueo.hour, 13);
  assert.ok(inicioDelBloqueo >= manana && inicioDelBloqueo < manana.plus({ days: 7 }));
  // El bloqueo va antes de los turnos: no generó tareas.
  assert.equal(await prisma.activity.count({ where: { organizationId: id } }), 0);
  return proximos;
}

function emailDePrueba(etiqueta: string): string {
  return `demo-r19-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
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

/** Lo que una organización tiene, para comparar antes y después. */
async function conteos(organizationId: string) {
  const where = { organizationId };
  return {
    sedes: await prisma.branch.count({ where }),
    profesionales: await prisma.resource.count({ where }),
    prestaciones: await prisma.serviceType.count({ where }),
    contactos: await prisma.contact.count({ where }),
    turnos: await prisma.booking.count({ where }),
    entradas: await prisma.knowledgeBaseEntry.count({ where }),
    agentes: await prisma.agent.count({ where }),
    automatizaciones: await prisma.automation.count({ where }),
    qrs: await prisma.qrCode.count({ where }),
    bloqueos: await prisma.resourceTimeOff.count({ where }),
  };
}

// ---------------------------------------------------------------------------
// Quién puede
// ---------------------------------------------------------------------------

test("sin sesión 401 y un ADMIN que no es platform admin 403, sin crear nada", async () => {
  const email = emailDePrueba("prohibido");
  const body = { adminFullName: "Persona de Prueba", adminEmail: email, sufijo: "Prohibida" };

  assert.equal((await pedir(comun, "POST", ruta, body, null)).status, 401);
  const prohibido = await pedir(comun, "POST", ruta, body);
  assert.equal(prohibido.status, 403);

  assert.equal(await prisma.user.findUnique({ where: { email } }), null);
  assert.equal(
    await prisma.organization.findUnique({ where: { slug: "clinica-demo-prohibida" } }),
    null,
  );
});

test("la llave sigue en false: el alta común de una clínica da 400 y no crea nada", async () => {
  assert.equal(CLINICA_HABILITADA, false);
  const email = emailDePrueba("alta-comun");
  const alta = await pedir(plataforma, "POST", "/api/admin/organizations", {
    organizationName: "Clinica Comun R19",
    adminFullName: "Persona de Prueba",
    adminEmail: email,
    industry: "CLINICA",
  });
  assert.equal(alta.status, 400);
  assert.match(String(alta.json.error?.message), /CLINICA todavía no está disponible/);
  assert.equal(await prisma.user.findUnique({ where: { email } }), null);
  assert.equal(
    await prisma.organization.findUnique({ where: { slug: "clinica-comun-r19" } }),
    null,
  );

  // El body del endpoint de la demo no elige rubro ni nombre.
  const conRubro = await pedir(plataforma, "POST", ruta, {
    adminFullName: "Persona de Prueba",
    adminEmail: email,
    industry: "AUTOMOTORA",
  });
  assert.equal(conRubro.status, 400);
});

// ---------------------------------------------------------------------------
// La demo
// ---------------------------------------------------------------------------

test("el platform admin crea la Clínica Demo con la llave en false: 201 con los datos de §12.2", async () => {
  const antesOtra = await conteos(otraClinica.id);
  const antesPlataforma = await conteos(plataforma.id);
  const email = emailDePrueba("feliz");
  const sufijo = `R19 ${Date.now()} ${randomUUID().slice(0, 8)}`;

  const res = await pedir(plataforma, "POST", ruta, {
    adminFullName: "Persona de Prueba",
    adminEmail: email,
    sufijo,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  demo = res.json as unknown as typeof demo;
  const id = demo!.organization.id;

  assert.ok(esSlugDeClinicaDemo(demo!.organization.slug), demo!.organization.slug);
  assert.deepEqual(res.json.datosDeEjemplo, {
    sedes: 1,
    profesionales: 3,
    prestaciones: 4,
    bloqueos: 1,
    entradasDeConocimiento: 7,
    pacientes: 8,
    turnosProximos: 24,
    sobreturnos: 1,
    turnosConfirmados: 3,
    turnosAtendidos: 3,
    turnosOmitidos: 0,
    agentes: 1,
    qrs: 1,
    automatizaciones: 3,
  });

  // La organización y su admin.
  const org = await prisma.organization.findUniqueOrThrow({ where: { id } });
  assert.equal(org.name, `Clínica Demo ${sufijo}`);
  assert.equal(org.industry, "CLINICA");
  assert.equal(org.edition, "ESENCIAL");
  assert.equal(org.timezone, ZONA_DE_LA_DEMO);
  const clinica = await prisma.clinicSettings.findUniqueOrThrow({ where: { organizationId: id } });
  assert.equal(clinica.contactTerm, "PACIENTE");
  assert.match(String(clinica.privacyNoticeText), /^Texto de ejemplo/);
  assert.equal(clinica.privacyPolicyUrl, "https://example.com/privacidad");
  const admin = await prisma.user.findUniqueOrThrow({
    where: { id: demo!.admin.id },
    include: { role: true },
  });
  assert.equal(admin.email, email);
  assert.equal(admin.role.name, "ADMIN");
  assert.equal(admin.organizationId, id);

  // Sede, horario y recordatorio.
  const sede = await prisma.branch.findFirstOrThrow({ where: { organizationId: id } });
  assert.equal(sede.name, "Sede Centro");
  assert.equal(await prisma.branchBusinessHours.count({ where: { branchId: sede.id } }), 6);
  const deLaSede = await prisma.clinicBranchSettings.findUniqueOrThrow({
    where: { branchId: sede.id },
  });
  assert.equal(deLaSede.reminderHoursBefore, 24);
  assert.equal(deLaSede.lateBookingReminder, "NO_ENVIAR");

  // Profesionales, prestaciones y bloqueo.
  const recursos = await prisma.resource.findMany({
    where: { organizationId: id },
    orderBy: { name: "asc" },
  });
  assert.deepEqual(
    recursos.map((r) => r.name),
    ["Dra. Lucía Ejemplo", "Lic. Martina Prueba", "Lic. Sofía Muestra"],
  );
  assert.ok(recursos.every((r) => r.type === "PERSON" && r.googleCalendarId === null));
  const prestaciones = await prisma.serviceType.findMany({
    where: { organizationId: id },
    orderBy: { name: "asc" },
  });
  assert.deepEqual(
    prestaciones.map((p) => [p.name, p.durationMin, p.followUpAfterDays]),
    [
      ["Consulta dermatológica", 30, 180],
      ["Depilación láser", 45, 30],
      ["Limpieza facial", 60, 30],
      ["Peeling químico", 45, null],
    ],
  );
  const limpieza = prestaciones.find((p) => p.name === "Limpieza facial")!;
  assert.equal(
    await prisma.serviceTypeResource.count({ where: { serviceTypeId: limpieza.id } }),
    2,
  );
  const bloqueo = await prisma.resourceTimeOff.findFirstOrThrow({ where: { organizationId: id } });
  assert.equal(bloqueo.resourceId, recursos[0].id);
  const inicioDelBloqueo = DateTime.fromJSDate(bloqueo.startsAt, { zone: ZONA_DE_LA_DEMO });
  assert.equal(inicioDelBloqueo.weekday, 5, "viernes");
  assert.equal(inicioDelBloqueo.hour, 13);
  // Antes de los turnos: no generó tareas.
  assert.equal(await prisma.activity.count({ where: { organizationId: id } }), 0);

  // Base de conocimiento.
  const entradas = await prisma.knowledgeBaseEntry.findMany({ where: { organizationId: id } });
  assert.equal(entradas.length, 7);
  const indicaciones = entradas.filter((e) => e.kind === "INDICACIONES");
  assert.equal(indicaciones.length, 1);
  assert.match(indicaciones[0].content, /^Texto de ejemplo/);
  assert.ok(entradas.some((e) => e.content.includes("No trabajamos con mutualistas")));

  // Pacientes y turnos: los datos de uso (los mismos que deja el reinicio).
  const proximos = await verificarDatosDeUso(id);

  // Nada sale de la plataforma: agente y reglas inactivos, ni plantillas ni
  // mensajes del turno.
  const agentes = await prisma.agent.findMany({ where: { organizationId: id } });
  assert.equal(agentes.length, 1);
  assert.equal(agentes[0].name, "Recepción virtual");
  assert.equal(agentes[0].isActive, false);
  assert.equal(agentes[0].participation, null, "sin nivel (ESENCIAL)");
  assert.equal(agentes[0].whatsappPhoneNumberId, null);
  // Con el modelo explícito de la demo, no el de la plataforma.
  assert.equal(agentes[0].modelProvider, MODELO_DEL_AGENTE_DE_LA_DEMO.modelProvider);
  assert.equal(agentes[0].modelName, MODELO_DEL_AGENTE_DE_LA_DEMO.modelName);
  const reglas = await prisma.automation.findMany({ where: { organizationId: id } });
  assert.deepEqual(reglas.map((r) => [r.triggerType, r.actionType]).sort(), [
    ["booking.completed", "booking.schedule_control"],
    ["booking.completed", "booking.send_qr_review"],
    ["booking.reminder_due", "booking.send_reminder"],
  ]);
  assert.ok(reglas.every((r) => !r.isActive));
  const qr = await prisma.qrCode.findFirstOrThrow({ where: { organizationId: id } });
  assert.ok(qr.destinationUrl.startsWith("https://example.com/"));
  assert.equal(
    (
      reglas.find((r) => r.actionType === "booking.send_qr_review")!.actionConfig as {
        delayMinutes: number;
      }
    ).delayMinutes,
    180,
  );
  assert.equal(await prisma.whatsappTemplate.count({ where: { organizationId: id } }), 0);
  assert.equal(await prisma.bookingMessage.count({ where: { organizationId: id } }), 0);
  // Lo que haría el outbox con los booking.created: sin regla activa, nada.
  for (const turno of proximos) {
    assert.equal(await programarRecordatorio(id, turno.id), "SIN_REGLA");
  }
  assert.equal(await prisma.bookingMessage.count({ where: { organizationId: id } }), 0);

  // Aislamiento: las otras organizaciones, igual que antes.
  assert.deepEqual(await conteos(otraClinica.id), antesOtra);
  assert.deepEqual(await conteos(plataforma.id), antesPlataforma);
});

test("cargarDatosDeEjemplo sobre la demo ya cargada: 409, sin mezclar", async () => {
  assert.ok(demo, "depende del test anterior");
  const antes = await conteos(demo.organization.id);
  const err = await esperarAppError(
    () => cargarDatosDeEjemplo(demo!.organization.id, demo!.admin.id),
    409,
  );
  assert.equal(err.message, DEMO_CON_DATOS);
  assert.deepEqual(await conteos(demo.organization.id), antes);
});

test("la purga de organizaciones de test nunca toca la Clínica Demo", async () => {
  assert.ok(demo, "depende del test de alta");
  const alcance = { organizaciones: [demo.organization.id], identidades: [] };

  const plan = await simularPurga(prisma, { protegidas: [], alcance });
  assert.deepEqual(plan.organizaciones, []);
  const { resultados } = await ejecutarPurga(prisma, { protegidas: [], alcance });
  assert.deepEqual(resultados, []);

  const sigue = await prisma.organization.findUnique({ where: { id: demo.organization.id } });
  assert.ok(sigue && esSlugDeClinicaDemo(sigue.slug));
  assert.equal(await prisma.contact.count({ where: { organizationId: demo.organization.id } }), 8);
});

// ---------------------------------------------------------------------------
// cargarDatosDeEjemplo: nunca mezcla datos de ejemplo con reales (§12.1)
// ---------------------------------------------------------------------------

test("cargarDatosDeEjemplo: 409 en una automotora y en una clínica con un contacto (aunque esté dado de baja)", async () => {
  const enAutomotora = await esperarAppError(
    () => cargarDatosDeEjemplo(comun.id, comun.authIds[0]),
    409,
  );
  assert.equal(enAutomotora.message, DEMO_SOLO_EN_CLINICAS);
  assert.equal(await prisma.branch.count({ where: { organizationId: comun.id } }), 0);

  const conDatos = await crearOrgDePrueba("demo-r19", "COMPLETA", "CLINICA", 1);
  orgsDeTest.push(conDatos.id);
  await prisma.contact.create({
    data: {
      organizationId: conDatos.id,
      firstName: "Paciente",
      lastName: "De Prueba",
      deletedAt: new Date(),
    },
  });
  const antes = await conteos(conDatos.id);
  const err = await esperarAppError(
    () => cargarDatosDeEjemplo(conDatos.id, conDatos.authIds[0]),
    409,
  );
  assert.equal(err.message, DEMO_CON_DATOS);
  assert.deepEqual(await conteos(conDatos.id), antes);
});

test("cargarDatosDeEjemplo con un admin de otra organización: 400 sin escribir nada", async () => {
  const antes = await conteos(otraClinica.id);
  await esperarAppError(() => cargarDatosDeEjemplo(otraClinica.id, plataforma.authIds[0]), 400);
  assert.deepEqual(await conteos(otraClinica.id), antes);
});

test("un agente común (fuera de la demo) sigue naciendo con el modelo de la plataforma (OPENROUTER_MODEL)", async () => {
  const sucursal = await createBranch(comun.id, {
    name: `Sucursal ${randomUUID().slice(0, 8)}`,
    timezone: "America/Montevideo",
  });
  const agente = await createAgent(comun.id, {
    branchId: sucursal.id,
    name: "Asistente",
    instructions: "Sos el asistente.",
    enabledTools: [],
    channels: ["WEB"],
    allowedOrigins: [],
    guardrails: {},
    guardrailsText: "",
    isActive: false,
  });
  try {
    assert.equal(agente.modelProvider, "openrouter");
    assert.equal(agente.modelName, env.OPENROUTER_MODEL);
  } finally {
    await prisma.agent.delete({ where: { id: agente.id } });
  }
});

// ---------------------------------------------------------------------------
// Reiniciar los datos de la demo (§12.3):
// POST /api/admin/organizations/:organizationId/demo/reiniciar
// ---------------------------------------------------------------------------

const rutaDeReinicio = (organizationId: string) =>
  `/api/admin/organizations/${organizationId}/demo/reiniciar`;

/** La configuración de una organización, con sus ids: el reinicio no la toca. */
async function configuracion(organizationId: string) {
  const where = { organizationId };
  const ids = async (filas: Promise<{ id: string }[]>) => (await filas).map((f) => f.id).sort();
  const orden = { id: "asc" as const };
  return {
    organizacion: await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    clinica: await prisma.clinicSettings.findUnique({ where }),
    sedes: await ids(prisma.branch.findMany({ where, orderBy: orden })),
    deLaSede: await prisma.clinicBranchSettings.findMany({ where, orderBy: { branchId: "asc" } }),
    horarioDeLaSede: await prisma.branchBusinessHours.count({ where }),
    profesionales: await prisma.resource.findMany({ where, orderBy: orden }),
    horarios: await prisma.workingHours.count({ where }),
    prestaciones: await prisma.serviceType.findMany({ where, orderBy: orden }),
    profesionalesDePrestaciones: await prisma.serviceTypeResource.count({ where }),
    conocimiento: await ids(prisma.knowledgeBaseEntry.findMany({ where, orderBy: orden })),
    agentes: await prisma.agent.findMany({ where, orderBy: orden }),
    automatizaciones: await prisma.automation.findMany({ where, orderBy: orden }),
    qrs: await ids(prisma.qrCode.findMany({ where, orderBy: orden })),
    usuarios: await prisma.user.findMany({ where, orderBy: orden }),
    invitaciones: await ids(prisma.invitation.findMany({ where, orderBy: orden })),
  };
}

test("reiniciar: sin sesión 401, un ADMIN que no es platform admin 403, una organización que no existe 404", async () => {
  assert.ok(demo, "depende del test de alta");
  const antes = await conteos(demo.organization.id);
  const ruta = rutaDeReinicio(demo.organization.id);

  assert.equal((await pedir(comun, "POST", ruta, undefined, null)).status, 401);
  assert.equal((await pedir(comun, "POST", ruta)).status, 403);
  assert.equal((await pedir(plataforma, "POST", rutaDeReinicio(randomUUID()))).status, 404);
  assert.equal((await pedir(plataforma, "POST", rutaDeReinicio("no-es-un-uuid"))).status, 400);

  assert.deepEqual(await conteos(demo.organization.id), antes);
});

test("reiniciar: una clínica que no es demo y una automotora (aunque tenga el slug de la demo) dan 400 y no se borra nada", async () => {
  // La clínica común, con un paciente.
  await prisma.contact.create({
    data: { organizationId: otraClinica.id, firstName: "Paciente", lastName: "De Prueba" },
  });
  const antesClinica = await conteos(otraClinica.id);
  const enClinica = await pedir(plataforma, "POST", rutaDeReinicio(otraClinica.id));
  assert.equal(enClinica.status, 400);
  assert.equal(enClinica.json.error?.message, NO_ES_UNA_DEMO);
  assert.deepEqual(await conteos(otraClinica.id), antesClinica);

  // Una automotora con un contacto, renombrada con un slug de demo: el rubro
  // también cuenta. Nace con un slug de este archivo (demo-r19-…) y vuelve a
  // él en el finally, para que la purga del after() la borre. El slug de demo
  // NO es una plantilla de PATRONES_DE_SLUG_DE_PRUEBA a propósito (§12.1):
  // ninguna purga puede reconocer un slug de demo.
  const automotora = await crearOrgDePrueba("demo-r19", "COMPLETA", "AUTOMOTORA", 1);
  orgsDeTest.push(automotora.id);
  await prisma.contact.create({
    data: { organizationId: automotora.id, firstName: "Cliente", lastName: "De Prueba" },
  });
  const { slug } = await prisma.organization.findUniqueOrThrow({ where: { id: automotora.id } });
  const slugDeDemo = `clinica-demo-automotora-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await prisma.organization.update({ where: { id: automotora.id }, data: { slug: slugDeDemo } });
  try {
    const antes = await conteos(automotora.id);
    const res = await pedir(plataforma, "POST", rutaDeReinicio(automotora.id));
    assert.equal(res.status, 400);
    assert.equal(res.json.error?.message, NO_ES_UNA_DEMO);
    assert.deepEqual(await conteos(automotora.id), antes);
  } finally {
    await prisma.organization.update({ where: { id: automotora.id }, data: { slug } });
  }
});

test("reiniciar con la regla del recordatorio activa o con Google conectado: 409 sin borrar nada", async () => {
  assert.ok(demo, "depende del test de alta");
  const id = demo.organization.id;
  const antes = await conteos(id);

  const recordatorio = await prisma.automation.findFirstOrThrow({
    where: { organizationId: id, triggerType: "booking.reminder_due" },
  });
  await prisma.automation.update({ where: { id: recordatorio.id }, data: { isActive: true } });
  try {
    const res = await pedir(plataforma, "POST", rutaDeReinicio(id));
    assert.equal(res.status, 409);
    assert.equal(res.json.error?.message, DEMO_CON_RECORDATORIO_ACTIVO);
  } finally {
    await prisma.automation.update({ where: { id: recordatorio.id }, data: { isActive: false } });
  }

  const sede = await prisma.branch.findFirstOrThrow({ where: { organizationId: id } });
  const conexion = await prisma.googleCalendarConnection.create({
    data: { organizationId: id, branchId: sede.id, refreshToken: "token-de-prueba" },
  });
  try {
    const res = await pedir(plataforma, "POST", rutaDeReinicio(id));
    assert.equal(res.status, 409);
    assert.equal(res.json.error?.message, DEMO_CON_GOOGLE);
  } finally {
    await prisma.googleCalendarConnection.delete({ where: { id: conexion.id } });
  }

  assert.deepEqual(await conteos(id), antes);
});

test("reiniciar la demo: borra los datos de uso, conserva la configuración y vuelve a cargar los de ejemplo desde mañana", async () => {
  assert.ok(demo, "depende del test de alta");
  const id = demo.organization.id;
  const antesOtra = await conteos(otraClinica.id);
  const antesPlataforma = await conteos(plataforma.id);

  // Una Recepción, además del ADMIN de la demo. Su identidad de Supabase la
  // borra la purga del after(), con la organización.
  const email = emailDePrueba("recepcion");
  const identidad = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password: `Clave-${randomUUID()}`,
    email_confirm: true,
  });
  if (identidad.error || !identidad.data.user) throw new Error(String(identidad.error?.message));
  const recepcion = await prisma.user.create({
    data: {
      id: identidad.data.user.id,
      organizationId: id,
      roleId: (await prisma.role.findUniqueOrThrow({ where: { name: "RECEPCION" } })).id,
      email,
      fullName: "Recepción de Prueba",
    },
  });

  // Datos de uso de antes: una conversación con mensajes, una tarea y un
  // mensaje programado de un turno, además de los pacientes y turnos.
  const [agente] = await prisma.agent.findMany({ where: { organizationId: id } });
  const [turno] = await prisma.booking.findMany({
    where: { organizationId: id, status: "CONFIRMED" },
    take: 1,
  });
  const conversacion = await prisma.conversation.create({
    data: {
      organizationId: id,
      branchId: agente.branchId,
      agentId: agente.id,
      contactId: turno.contactId,
      channel: "WHATSAPP",
    },
  });
  await prisma.message.createMany({
    data: [
      {
        organizationId: id,
        conversationId: conversacion.id,
        direction: "INBOUND",
        senderType: "CONTACT",
        content: "Hola, quería un turno",
      },
      {
        organizationId: id,
        conversationId: conversacion.id,
        direction: "OUTBOUND",
        senderType: "AGENT",
        content: "Hola, te ayudo",
      },
    ],
  });
  const tarea = await prisma.activity.create({
    data: {
      organizationId: id,
      type: "TASK",
      authorId: recepcion.id,
      subject: "Llamar al paciente",
      contactId: turno.contactId,
      sourceBookingId: turno.id,
    },
  });
  const recordatorio = await prisma.automation.findFirstOrThrow({
    where: { organizationId: id, triggerType: "booking.reminder_due" },
  });
  const mensajeDelTurno = await prisma.bookingMessage.create({
    data: {
      organizationId: id,
      bookingId: turno.id,
      contactId: turno.contactId,
      automationId: recordatorio.id,
      kind: "REMINDER",
      bookingStartsAt: turno.startsAt,
      scheduledFor: turno.startsAt,
      nextAttemptAt: turno.startsAt,
    },
  });
  const pacientesDeAntes = (await prisma.contact.findMany({ where: { organizationId: id } })).map(
    (c) => c.id,
  );
  const turnosDeAntes = (await prisma.booking.findMany({ where: { organizationId: id } })).map(
    (t) => t.id,
  );
  const bloqueoDeAntes = await prisma.resourceTimeOff.findFirstOrThrow({
    where: { organizationId: id },
  });
  const configuracionDeAntes = await configuracion(id);

  const res = await pedir(plataforma, "POST", rutaDeReinicio(id));
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.organizationId, id);
  assert.deepEqual(res.json.cargados, {
    bloqueos: 1,
    pacientes: 8,
    turnosProximos: 24,
    sobreturnos: 1,
    turnosConfirmados: 3,
    turnosAtendidos: 3,
    turnosOmitidos: 0,
  });
  const borrados = res.json.borrados as Record<string, number>;
  assert.equal(borrados.pacientes, 8);
  assert.equal(borrados.turnos, turnosDeAntes.length);
  assert.equal(borrados.conversaciones, 1);
  assert.equal(borrados.mensajes, 2);
  assert.equal(borrados.tareas, 1);
  assert.equal(borrados.mensajesDeTurnos, 1);
  assert.equal(borrados.bloqueos, 1);

  // Lo de antes ya no está.
  assert.equal(await prisma.contact.count({ where: { id: { in: pacientesDeAntes } } }), 0);
  assert.equal(await prisma.booking.count({ where: { id: { in: turnosDeAntes } } }), 0);
  assert.equal(await prisma.conversation.count({ where: { id: conversacion.id } }), 0);
  assert.equal(await prisma.message.count({ where: { conversationId: conversacion.id } }), 0);
  assert.equal(await prisma.activity.count({ where: { id: tarea.id } }), 0);
  assert.equal(await prisma.bookingMessage.count({ where: { id: mensajeDelTurno.id } }), 0);
  assert.equal(await prisma.resourceTimeOff.count({ where: { id: bloqueoDeAntes.id } }), 0);

  // La configuración, con los mismos ids (y los dos usuarios).
  const configuracionDespues = await configuracion(id);
  assert.deepEqual(configuracionDespues, configuracionDeAntes);
  assert.deepEqual(
    configuracionDespues.usuarios.map((u) => u.id).sort(),
    [demo.admin.id, recepcion.id].sort(),
  );

  // Los datos de ejemplo de nuevo, con fechas relativas a hoy.
  const proximos = await verificarDatosDeUso(id);

  // Nada para mandar: ni mensajes del turno ni plantillas; en el outbox solo
  // los booking.created de los turnos nuevos, que sin regla activa no
  // agendan nada.
  assert.equal(await prisma.bookingMessage.count({ where: { organizationId: id } }), 0);
  assert.equal(await prisma.whatsappTemplate.count({ where: { organizationId: id } }), 0);
  const eventos = await prisma.outboxEvent.findMany({ where: { organizationId: id } });
  assert.equal(eventos.length, proximos.length);
  assert.ok(eventos.every((e) => e.eventType === "booking.created"));
  for (const t of proximos) {
    assert.equal(await programarRecordatorio(id, t.id), "SIN_REGLA");
  }
  assert.equal(await prisma.bookingMessage.count({ where: { organizationId: id } }), 0);

  // Aislamiento: las otras organizaciones, igual que antes.
  assert.deepEqual(await conteos(otraClinica.id), antesOtra);
  assert.deepEqual(await conteos(plataforma.id), antesPlataforma);
});
