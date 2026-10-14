import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { MODULOS, MODULOS_ACTIVABLES, SOLO_CLINICA } from "../config/ediciones";
import { OPCIONES_DE_TRANSACCION_LARGA, prisma } from "../lib/prisma";
import { MODULO_NO_INCLUIDO } from "../middlewares/moduloDeLaEdicion";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { cambiarRubroDeOrganizacion } from "../services/organizationAdmin.service";

// ---------------------------------------------------------------------------
// S2 de docs/servicios.md (§1): activar y desactivar el módulo Servicios
// contra la app real, con ADMIN reales de Supabase local.
//
//   - Sin el módulo, GET /api/servicios/configuracion da 403
//     MODULO_NO_INCLUIDO con motivo NO_ACTIVADO, y /me es el de siempre.
//   - Activar (PUT, solo platform admin) se ve en el request SIGUIENTE con el
//     mismo token: la caché de autenticación se vacía (no se espera el TTL).
//     Desactivar, igual. Reactivar conserva enabled_at.
//   - Una clínica no lo tiene ni con una fila escrita a mano (403 RUBRO), y
//     activarlo en una clínica es un 400 que no escribe nada.
//   - Idempotentes; 401 sin sesión, 403 a un ADMIN que no es platform admin,
//     400 a un módulo que no es activable, 404 a una organización que no existe.
// ---------------------------------------------------------------------------

let automotora: OrgDePrueba;
let esencial: OrgDePrueba;
let clinica: OrgDePrueba;
// El platform admin: un usuario de una organización propia, en la allowlist.
let plataforma: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

const CONFIGURACION = "/api/servicios/configuracion";
const modulo = (orgId: string, m = "servicios") => `/api/admin/organizations/${orgId}/modulos/${m}`;

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  automotora = await crearOrgDePrueba("servicios-activacion", "COMPLETA", "AUTOMOTORA", 1);
  esencial = await crearOrgDePrueba("servicios-activacion", "ESENCIAL", "AUTOMOTORA", 1);
  clinica = await crearOrgDePrueba("servicios-activacion", "COMPLETA", "CLINICA", 1);
  plataforma = await crearOrgDePrueba("servicios-activacion", "COMPLETA", "AUTOMOTORA", 1);
  await prisma.platformAdmin.create({ data: { userId: plataforma.authIds[0] } });
});

after(async () => {
  if (cerrar) await cerrar();
  if (plataforma)
    await prisma.platformAdmin.deleteMany({ where: { userId: plataforma.authIds[0] } });
  for (const org of [automotora, esencial, clinica, plataforma]) await borrarOrgDePrueba(org);
});

function comoPlataforma(metodo: "PUT" | "DELETE", path: string) {
  return pedir(plataforma, metodo, path, undefined, plataforma.tokens[0]);
}

async function filaDelModulo(organizationId: string) {
  return prisma.organizationModule.findUnique({
    where: { organizationId_module: { organizationId, module: "servicios" } },
  });
}

test("sin el módulo: la ruta da 403 NO_ACTIVADO y /me es la lista de siempre", async () => {
  const r = await pedir(automotora, "GET", CONFIGURACION);
  assert.equal(r.status, 403);
  assert.equal(r.json.error?.code, MODULO_NO_INCLUIDO);
  assert.equal(r.json.error?.modulo, "servicios");
  assert.equal(r.json.error?.motivo, "NO_ACTIVADO");

  const me = await pedir(automotora, "GET", "/api/me");
  assert.equal(me.status, 200);
  assert.deepEqual(
    me.json.modulos,
    MODULOS.filter((m) => !SOLO_CLINICA.has(m) && !MODULOS_ACTIVABLES.has(m)),
  );
});

test("activar se ve en el request siguiente con el mismo token; desactivar también; reactivar conserva enabled_at", async () => {
  const token = automotora.tokens[0];
  // El contexto del usuario queda en la caché sin el módulo.
  const antes = await pedir(automotora, "GET", CONFIGURACION, undefined, token);
  assert.equal(antes.status, 403);

  const inicio = Date.now();
  const activar = await comoPlataforma("PUT", modulo(automotora.id));
  assert.equal(activar.status, 200, JSON.stringify(activar.json));
  assert.deepEqual(activar.json, {
    organizationId: automotora.id,
    modulo: "servicios",
    activo: true,
  });
  const despues = await pedir(automotora, "GET", CONFIGURACION, undefined, token);
  assert.ok(Date.now() - inicio < 5_000, "antes del TTL de la caché (5 s)");
  assert.equal(despues.status, 200, "con el mismo token, sin esperar el TTL");
  assert.deepEqual(despues.json, { defaultNextServiceMonths: 12, firstServiceAfterMonths: 12 });

  const me = await pedir(automotora, "GET", "/api/me", undefined, token);
  assert.deepEqual(
    me.json.modulos,
    MODULOS.filter((m) => !SOLO_CLINICA.has(m)),
    "la lista de siempre más servicios, en el orden del catálogo",
  );
  const fila = await filaDelModulo(automotora.id);
  assert.ok(fila);
  assert.equal(fila.enabledById, plataforma.authIds[0]);
  assert.equal(fila.disabledAt, null);
  assert.ok(
    await prisma.workshopSettings.findUnique({ where: { organizationId: automotora.id } }),
    "activar crea la configuración del taller",
  );

  // Idempotente: el segundo PUT no crea otra fila ni toca enabled_at.
  const otraVez = await comoPlataforma("PUT", modulo(automotora.id));
  assert.equal(otraVez.status, 200);
  const igual = await filaDelModulo(automotora.id);
  assert.equal(igual?.enabledAt.getTime(), fila.enabledAt.getTime());

  // Desactivar: el request siguiente vuelve al 403.
  const desactivar = await comoPlataforma("DELETE", modulo(automotora.id));
  assert.equal(desactivar.status, 200);
  assert.equal(desactivar.json.activo, false);
  const bloqueada = await pedir(automotora, "GET", CONFIGURACION, undefined, token);
  assert.equal(bloqueada.status, 403);
  assert.equal(bloqueada.json.error?.motivo, "NO_ACTIVADO");
  const baja = await filaDelModulo(automotora.id);
  assert.ok(baja?.disabledAt);
  assert.equal(baja?.disabledById, plataforma.authIds[0]);
  const meSin = await pedir(automotora, "GET", "/api/me", undefined, token);
  assert.ok(!(meSin.json.modulos as string[]).includes("servicios"));

  // Desactivar dos veces: 200 sin cambios.
  const otraBaja = await comoPlataforma("DELETE", modulo(automotora.id));
  assert.equal(otraBaja.status, 200);
  assert.equal(
    (await filaDelModulo(automotora.id))?.disabledAt?.getTime(),
    baja?.disabledAt?.getTime(),
  );

  // Reactivar: limpia la baja y conserva la primera activación.
  const reactivar = await comoPlataforma("PUT", modulo(automotora.id));
  assert.equal(reactivar.status, 200);
  const reactivada = await filaDelModulo(automotora.id);
  assert.equal(reactivada?.disabledAt, null);
  assert.equal(reactivada?.disabledById, null);
  assert.equal(reactivada?.enabledAt.getTime(), fila.enabledAt.getTime());
  assert.equal((await pedir(automotora, "GET", CONFIGURACION, undefined, token)).status, 200);
});

test("el listado de Plataforma trae los módulos activados de cada organización", async () => {
  const r = await pedir(
    plataforma,
    "GET",
    "/api/admin/organizations",
    undefined,
    plataforma.tokens[0],
  );
  assert.equal(r.status, 200);
  const filas = r.json as unknown as { id: string; industry: string; modulosActivados: string[] }[];
  const deLaAutomotora = filas.find((o) => o.id === automotora.id);
  const deLaClinica = filas.find((o) => o.id === clinica.id);
  assert.deepEqual(deLaAutomotora?.modulosActivados, ["servicios"]);
  assert.deepEqual(deLaClinica?.modulosActivados, []);
  assert.equal(deLaClinica?.industry, "CLINICA");
});

test("ESENCIAL: el módulo se suma a la edición", async () => {
  assert.equal((await pedir(esencial, "GET", CONFIGURACION)).json.error?.motivo, "NO_ACTIVADO");
  assert.equal((await comoPlataforma("PUT", modulo(esencial.id))).status, 200);
  assert.equal((await pedir(esencial, "GET", CONFIGURACION)).status, 200);
  const me = await pedir(esencial, "GET", "/api/me");
  const modulos = me.json.modulos as string[];
  assert.ok(modulos.includes("servicios"));
  assert.ok(!modulos.includes("cotizaciones"), "la edición sigue siendo ESENCIAL");
});

test("sin fila de configuración, la ruta devuelve los defaults", async () => {
  await prisma.workshopSettings.deleteMany({ where: { organizationId: esencial.id } });
  const r = await pedir(esencial, "GET", CONFIGURACION);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { defaultNextServiceMonths: 12, firstServiceAfterMonths: 12 });
});

test("una clínica no tiene el módulo ni con una fila escrita a mano; activarlo es 400 y no escribe nada", async () => {
  const activar = await comoPlataforma("PUT", modulo(clinica.id));
  assert.equal(activar.status, 400);
  assert.equal(activar.json.error?.code, "MODULO_NO_DISPONIBLE_EN_EL_RUBRO");
  assert.equal(await filaDelModulo(clinica.id), null);
  assert.equal(await prisma.workshopSettings.count({ where: { organizationId: clinica.id } }), 0);

  await prisma.organizationModule.create({
    data: { organizationId: clinica.id, module: "servicios", enabledById: randomUUID() },
  });
  const r = await pedir(clinica, "GET", CONFIGURACION);
  assert.equal(r.status, 403);
  assert.equal(r.json.error?.motivo, "RUBRO");
  const me = await pedir(clinica, "GET", "/api/me");
  assert.ok(!(me.json.modulos as string[]).includes("servicios"));
  await prisma.organizationModule.deleteMany({ where: { organizationId: clinica.id } });
});

test("cambiar el rubro de una organización con servicios activado: 409", async () => {
  // Por el service: la ruta responde 400 antes, mientras CLINICA no se ofrece.
  await assert.rejects(
    cambiarRubroDeOrganizacion(automotora.id, "CLINICA", {
      clinicaHabilitada: true,
      transaction: (fn) => prisma.$transaction(fn, OPCIONES_DE_TRANSACCION_LARGA),
      vaciarCacheDeAuth: () => undefined,
    }),
    (err: unknown) =>
      (err as { statusCode?: number }).statusCode === 409 &&
      /servicios/.test((err as Error).message),
  );
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: automotora.id } });
  assert.equal(org.industry, "AUTOMOTORA");
});

test("solo el platform admin: 401 sin sesión, 403 al ADMIN de la organización; 400 si no es activable; 404 si no existe", async () => {
  const sinSesion = await pedir(automotora, "PUT", modulo(automotora.id), undefined, null);
  assert.equal(sinSesion.status, 401);
  for (const metodo of ["PUT", "DELETE"] as const) {
    const admin = await pedir(
      automotora,
      metodo,
      modulo(automotora.id),
      undefined,
      automotora.tokens[0],
    );
    assert.equal(admin.status, 403, `${metodo} como ADMIN de la organización`);
  }
  const noActivable = await comoPlataforma("PUT", modulo(automotora.id, "stock"));
  assert.equal(noActivable.status, 400);
  assert.equal(noActivable.json.error?.code, "MODULO_NO_ACTIVABLE");
  assert.equal((await comoPlataforma("PUT", modulo(randomUUID()))).status, 404);
  assert.equal((await comoPlataforma("DELETE", modulo(randomUUID()))).status, 404);
});
