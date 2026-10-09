import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { findRoleByName } from "../repositories/role.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { createBranch } from "../services/branch.service";
import {
  RUBRO_CON_DATOS,
  cambiarRubroDeOrganizacion,
  createOrganizationWithFoundingAdmin,
  defaultOrganizationAdminDeps,
  type CambiarRubroDeps,
} from "../services/organizationAdmin.service";
import { AppError } from "../utils/AppError";
import {
  CONFIGURACION_DE_SEDE_POR_DEFECTO,
  leerConfiguracionDeSede,
} from "./repositories/clinicSettings.repository";

// ---------------------------------------------------------------------------
// Alta y configuración de la clínica (docs/rubros.md §15, R3), contra Postgres
// y GoTrue reales y la app real.
//
// La llave CLINICA_HABILITADA está en false: por la API, CLINICA se rechaza.
// Los caminos con la llave en true se prueban llamando a los services con la
// llave inyectada, igual que hizo ediciones con ESENCIAL_HABILITADA. Las
// organizaciones CLINICA de los demás casos se crean directo en la base (hasta
// que se abra la llave, nadie puede crearlas por la app).
// ---------------------------------------------------------------------------

let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);
const orgs: OrgDePrueba[] = [];
const authUsersExtra: string[] = [];

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
});

after(async () => {
  if (cerrar) await cerrar();
  for (const org of orgs) {
    await prisma.platformAdmin.deleteMany({ where: { userId: { in: org.authIds } } });
    await borrarOrgDePrueba(org);
  }
  for (const id of authUsersExtra) await getSupabaseAdmin().auth.admin.deleteUser(id);
});

async function org(
  edition: "COMPLETA" | "ESENCIAL",
  industry: "AUTOMOTORA" | "CLINICA",
): Promise<OrgDePrueba> {
  const creada = await crearOrgDePrueba("clinica-config", edition, industry, 1);
  orgs.push(creada);
  return creada;
}

function depsDeRubro(): { deps: CambiarRubroDeps; vaciados: () => number } {
  let vaciados = 0;
  return {
    deps: {
      clinicaHabilitada: true,
      transaction: (fn) => prisma.$transaction(fn),
      vaciarCacheDeAuth: () => {
        vaciados++;
      },
    },
    vaciados: () => vaciados,
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

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

test("alta CLINICA (llave inyectada en true): nace CLINICA con su ClinicSettings en PACIENTE", async () => {
  let creado: Awaited<ReturnType<typeof createOrganizationWithFoundingAdmin>> | undefined;
  try {
    creado = await createOrganizationWithFoundingAdmin(
      {
        organizationName: `Clinica Alta ${Date.now()}`,
        adminFullName: "Persona de Prueba",
        adminEmail: `clinica-alta-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`,
        industry: "CLINICA",
      },
      { ...defaultOrganizationAdminDeps, clinicaHabilitada: true },
    );
    assert.equal(creado.organization.industry, "CLINICA");
    const fila = await prisma.clinicSettings.findUniqueOrThrow({
      where: { organizationId: creado.organization.id },
    });
    assert.equal(fila.contactTerm, "PACIENTE");
    assert.equal(fila.privacyNoticeText, null);
  } finally {
    if (creado) {
      await prisma.user.deleteMany({ where: { id: creado.admin.id } });
      await prisma.organization.deleteMany({ where: { id: creado.organization.id } });
      await getSupabaseAdmin().auth.admin.deleteUser(creado.admin.id);
    }
  }
});

test("por la API: GET /industries da solo AUTOMOTORA y el alta CLINICA es 400 sin crear nada (la llave en false)", async () => {
  const plataforma = await org("COMPLETA", "AUTOMOTORA");
  await prisma.platformAdmin.create({ data: { userId: plataforma.authIds[0] } });

  const rubros = await pedir(plataforma, "GET", "/api/admin/organizations/industries");
  assert.equal(rubros.status, 200);
  assert.deepEqual(rubros.json, { industries: ["AUTOMOTORA"] });

  const email = `clinica-cerrada-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const alta = await pedir(plataforma, "POST", "/api/admin/organizations", {
    organizationName: `Clinica Cerrada ${Date.now()}`,
    adminFullName: "Persona de Prueba",
    adminEmail: email,
    industry: "CLINICA",
  });
  assert.equal(alta.status, 400);
  assert.match(String(alta.json.error?.message), /CLINICA todavía no está disponible/);
  assert.equal(await prisma.user.findUnique({ where: { email } }), null);

  const rubroRaro = await pedir(plataforma, "POST", "/api/admin/organizations", {
    organizationName: "x",
    adminFullName: "y",
    adminEmail: email,
    industry: "FERRETERIA",
  });
  assert.equal(rubroRaro.status, 400);

  // El cambio de rubro a CLINICA también queda cerrado por la llave.
  const destino = await org("COMPLETA", "AUTOMOTORA");
  const cambio = await pedir(
    plataforma,
    "PATCH",
    `/api/admin/organizations/${destino.id}/industry`,
    { industry: "CLINICA" },
  );
  assert.equal(cambio.status, 400);
  // Pedir el que ya tiene: 200 sin cambios.
  const mismo = await pedir(
    plataforma,
    "PATCH",
    `/api/admin/organizations/${destino.id}/industry`,
    { industry: "AUTOMOTORA" },
  );
  assert.equal(mismo.status, 200);
  assert.deepEqual(mismo.json, { id: destino.id, industry: "AUTOMOTORA" });

  // Un ADMIN que no es platform admin: 403.
  const ajeno = await pedir(destino, "PATCH", `/api/admin/organizations/${destino.id}/industry`, {
    industry: "AUTOMOTORA",
  });
  assert.equal(ajeno.status, 403);
  const ajenoRubros = await pedir(destino, "GET", "/api/admin/organizations/industries");
  assert.equal(ajenoRubros.status, 403);
});

// ---------------------------------------------------------------------------
// Sucursales
// ---------------------------------------------------------------------------

test("sucursal de una clínica: nace con su ClinicBranchSettings con los defaults; la de una automotora, sin nada", async () => {
  const clinica = await org("COMPLETA", "CLINICA");
  const automotora = await org("COMPLETA", "AUTOMOTORA");

  const sede = await pedir(clinica, "POST", "/api/branches", {
    name: "Sede Centro",
    timezone: "America/Montevideo",
  });
  assert.equal(sede.status, 201, JSON.stringify(sede.json));
  const fila = await prisma.clinicBranchSettings.findUniqueOrThrow({
    where: { branchId: sede.json.id as string },
  });
  assert.equal(fila.organizationId, clinica.id);
  assert.equal(fila.reminderHoursBefore, 24);
  assert.equal(fila.lateBookingReminder, "NO_ENVIAR");
  assert.equal(fila.lateBookingHoursBefore, 2);
  assert.equal(fila.noResponseTaskHours, 4);
  assert.equal(fila.minHoursToChangeBooking, null);

  const sucursal = await pedir(automotora, "POST", "/api/branches", {
    name: "Casa central",
    timezone: "America/Montevideo",
  });
  assert.equal(sucursal.status, 201);
  assert.equal(
    await prisma.clinicBranchSettings.count({ where: { organizationId: automotora.id } }),
    0,
  );
});

test("sin la fila de la sede, la lectura devuelve los defaults (nada depende de que exista)", async () => {
  const clinica = await org("COMPLETA", "CLINICA");
  // Creada como automotora: sin fila, como una sede anterior al cambio de rubro.
  const branch = await createBranch(clinica.id, { name: "Sin fila", timezone: "UTC" });
  assert.equal(await prisma.clinicBranchSettings.count({ where: { branchId: branch.id } }), 0);
  assert.deepEqual(
    await leerConfiguracionDeSede(clinica.id, branch.id),
    CONFIGURACION_DE_SEDE_POR_DEFECTO,
  );
});

test("la base rechaza la configuración de una sede con horas fuera de rango", async () => {
  const clinica = await org("COMPLETA", "CLINICA");
  const branch = await createBranch(clinica.id, { name: "Rango", timezone: "UTC" }, "CLINICA");
  for (const data of [
    { reminderHoursBefore: 0 },
    { reminderHoursBefore: 73 },
    { lateBookingHoursBefore: 0 },
    { lateBookingHoursBefore: 24 },
  ]) {
    await assert.rejects(
      prisma.clinicBranchSettings.update({ where: { branchId: branch.id }, data }),
      /check constraint/i,
      JSON.stringify(data),
    );
  }
  await prisma.clinicBranchSettings.update({
    where: { branchId: branch.id },
    data: { reminderHoursBefore: 72, lateBookingHoursBefore: 23 },
  });
});

// ---------------------------------------------------------------------------
// Cambio de rubro (D1)
// ---------------------------------------------------------------------------

test("cambio de rubro sin datos: a CLINICA crea ClinicSettings y vacía la caché; volver no borra nada; repetir no hace nada", async () => {
  const destino = await org("COMPLETA", "AUTOMOTORA");
  const { deps, vaciados } = depsDeRubro();

  assert.deepEqual(await cambiarRubroDeOrganizacion(destino.id, "CLINICA", deps), {
    id: destino.id,
    industry: "CLINICA",
  });
  assert.equal(vaciados(), 1);
  assert.equal(
    (await prisma.organization.findUniqueOrThrow({ where: { id: destino.id } })).industry,
    "CLINICA",
  );
  assert.equal(await prisma.clinicSettings.count({ where: { organizationId: destino.id } }), 1);

  await cambiarRubroDeOrganizacion(destino.id, "CLINICA", deps);
  assert.equal(vaciados(), 1, "el mismo rubro: sin cambios ni caché vaciada");

  await cambiarRubroDeOrganizacion(destino.id, "AUTOMOTORA", deps);
  assert.equal(vaciados(), 2);
  assert.equal(
    await prisma.clinicSettings.count({ where: { organizationId: destino.id } }),
    1,
    "volver a AUTOMOTORA no borra la configuración",
  );

  // Ida y vuelta: la fila vieja se conserva, sin duplicarse.
  await prisma.clinicSettings.update({
    where: { organizationId: destino.id },
    data: { contactTerm: "CLIENTE" },
  });
  await cambiarRubroDeOrganizacion(destino.id, "CLINICA", deps);
  const fila = await prisma.clinicSettings.findUniqueOrThrow({
    where: { organizationId: destino.id },
  });
  assert.equal(fila.contactTerm, "CLIENTE");
});

test("cambio de rubro con datos de negocio: 409 sin cambiar nada, incluso con el contacto dado de baja", async () => {
  const destino = await org("COMPLETA", "AUTOMOTORA");
  const { deps, vaciados } = depsDeRubro();
  const contacto = await prisma.contact.create({
    data: {
      organizationId: destino.id,
      firstName: "Persona",
      lastName: "De Prueba",
      deletedAt: new Date(),
    },
  });

  const err = await esperarAppError(
    () => cambiarRubroDeOrganizacion(destino.id, "CLINICA", deps),
    409,
  );
  assert.equal(err.message, RUBRO_CON_DATOS);
  assert.equal(vaciados(), 0);
  assert.equal(
    (await prisma.organization.findUniqueOrThrow({ where: { id: destino.id } })).industry,
    "AUTOMOTORA",
  );
  assert.equal(await prisma.clinicSettings.count({ where: { organizationId: destino.id } }), 0);

  await prisma.contact.delete({ where: { id: contacto.id } });
  await cambiarRubroDeOrganizacion(destino.id, "CLINICA", deps);
});

test("cambio a CLINICA con un usuario USER vigente: 409; con el USER dado de baja, pasa", async () => {
  const destino = await org("COMPLETA", "AUTOMOTORA");
  const { deps } = depsDeRubro();
  const rolUser = await findRoleByName("USER");
  if (!rolUser) throw new Error("No está sembrado el rol USER");
  const email = `clinica-config-user-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  authUsersExtra.push(data.user.id);
  await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId: destino.id,
      roleId: rolUser.id,
      email,
      fullName: "Vendedor de Prueba",
    },
  });

  const err = await esperarAppError(
    () => cambiarRubroDeOrganizacion(destino.id, "CLINICA", deps),
    409,
  );
  assert.match(err.message, /rol que CLINICA no admite \(USER\)/);

  await prisma.user.update({
    where: { id: data.user.id },
    data: { deletedAt: new Date(), isActive: false },
  });
  await cambiarRubroDeOrganizacion(destino.id, "CLINICA", deps);
});

test("cambio de rubro de una organización inexistente o dada de baja: 404", async () => {
  const { deps } = depsDeRubro();
  await esperarAppError(() => cambiarRubroDeOrganizacion(randomUUID(), "CLINICA", deps), 404);
});

// ---------------------------------------------------------------------------
// /me y /organization
// ---------------------------------------------------------------------------

test("clínica: /me trae contactTerm y el vocabulario del rubro; /organization muestra rubro y edición y el ADMIN cambia el término", async () => {
  const clinica = await org("ESENCIAL", "CLINICA");

  // Sin fila de ClinicSettings (creada directo en la base): los defaults.
  const me = await pedir(clinica, "GET", "/api/me");
  assert.equal(me.status, 200);
  assert.equal(me.json.industry, "CLINICA");
  assert.equal(me.json.contactTerm, "PACIENTE");
  const vocabulario = me.json.vocabulario as Record<string, Record<string, string>>;
  assert.equal(vocabulario.contacto.pluralTitulo, "Pacientes");
  assert.equal(vocabulario.reserva.pluralTitulo, "Turnos");

  const settings = await pedir(clinica, "GET", "/api/organization");
  assert.equal(settings.status, 200);
  assert.equal(settings.json.industry, "CLINICA");
  assert.equal(settings.json.edition, "ESENCIAL");
  assert.equal(settings.json.contactTerm, "PACIENTE");

  const cambio = await pedir(clinica, "PATCH", "/api/organization", { contactTerm: "CLIENTE" });
  assert.equal(cambio.status, 200, JSON.stringify(cambio.json));
  assert.equal(cambio.json.contactTerm, "CLIENTE");
  const meDespues = await pedir(clinica, "GET", "/api/me");
  assert.equal(meDespues.json.contactTerm, "CLIENTE");
  assert.equal(
    (meDespues.json.vocabulario as Record<string, Record<string, string>>).contacto.pluralTitulo,
    "Clientes",
  );

  // El rubro y la edición no se cambian por acá.
  assert.equal(
    (await pedir(clinica, "PATCH", "/api/organization", { industry: "AUTOMOTORA" })).status,
    400,
  );
  assert.equal(
    (await pedir(clinica, "PATCH", "/api/organization", { contactTerm: "SOCIO" })).status,
    400,
  );
});

test("automotora: el término del contacto no existe (400) y /organization lo devuelve en null", async () => {
  const automotora = await org("COMPLETA", "AUTOMOTORA");
  const cambio = await pedir(automotora, "PATCH", "/api/organization", { contactTerm: "PACIENTE" });
  assert.equal(cambio.status, 400);
  assert.equal(await prisma.clinicSettings.count({ where: { organizationId: automotora.id } }), 0);

  const settings = await pedir(automotora, "GET", "/api/organization");
  assert.equal(settings.json.industry, "AUTOMOTORA");
  assert.equal(settings.json.edition, "COMPLETA");
  assert.equal(settings.json.contactTerm, null);
});
