import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { DateTime } from "luxon";
import { CLINICA_HABILITADA } from "../config/ediciones";
import { prisma } from "../lib/prisma";
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
import { esSlugDeClinicaDemo, ZONA_DE_LA_DEMO } from "./demo/config";
import { cargarDatosDeEjemplo, DEMO_CON_DATOS, DEMO_SOLO_EN_CLINICAS } from "./demo/datosDeEjemplo";
import { programarRecordatorio } from "./recordatorios/programacion.service";

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
    turnosProximos: 15,
    sobreturnos: 1,
    turnosConfirmados: 3,
    turnosAtendidos: 3,
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

  // Pacientes: inventados y sin teléfono.
  const pacientes = await prisma.contact.findMany({ where: { organizationId: id } });
  assert.equal(pacientes.length, 8);
  assert.ok(pacientes.every((p) => p.phone === null && String(p.email).endsWith("@example.com")));

  // Turnos: 15 la semana siguiente (uno sobreturno, 3 confirmados) y 3
  // atendidos la anterior.
  const turnos = await prisma.booking.findMany({ where: { organizationId: id } });
  const ahora = Date.now();
  const proximos = turnos.filter((t) => t.startsAt.getTime() > ahora);
  const pasados = turnos.filter((t) => t.startsAt.getTime() <= ahora);
  assert.equal(proximos.length, 15);
  assert.ok(proximos.every((t) => t.status === "CONFIRMED"));
  assert.equal(proximos.filter((t) => t.isOverbooking).length, 1);
  assert.equal(proximos.filter((t) => t.patientConfirmedAt !== null).length, 3);
  const lunesProximo = DateTime.now().setZone(ZONA_DE_LA_DEMO).startOf("week").plus({ weeks: 1 });
  assert.ok(
    proximos.every(
      (t) =>
        t.startsAt >= lunesProximo.toJSDate() &&
        t.startsAt < lunesProximo.plus({ weeks: 1 }).toJSDate(),
    ),
  );
  assert.equal(pasados.length, 3);
  assert.ok(
    pasados.every(
      (t) => t.status === "COMPLETED" && t.completedAt !== null && t.completedBy === "PERSONA",
    ),
  );

  // Nada sale de la plataforma: agente y reglas inactivos, ni plantillas ni
  // mensajes del turno.
  const agentes = await prisma.agent.findMany({ where: { organizationId: id } });
  assert.equal(agentes.length, 1);
  assert.equal(agentes[0].name, "Recepción virtual");
  assert.equal(agentes[0].isActive, false);
  assert.equal(agentes[0].participation, null, "sin nivel (ESENCIAL)");
  assert.equal(agentes[0].whatsappPhoneNumberId, null);
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
