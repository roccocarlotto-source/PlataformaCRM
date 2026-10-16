// Primero: el contador tiene que quedar como singleton antes de lib/prisma.
import { contarConsultas } from "../lib/contarConsultas.test-helper";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { findRoleByName } from "../repositories/role.repository";
import { usarCacheDeAuthParaTests, vaciarContextosDeAuth } from "./auth.service";
import { cambiarEdicionDeOrganizacion } from "./organizationAdmin.service";
import { activarModulo } from "./organizationModules.service";

// ---------------------------------------------------------------------------
// La caché de autenticación ENCENDIDA (30 s, el default de producción; la
// suite corre con 0): un cambio hecho por la API vale desde el próximo request
// de ese usuario, sin esperar el TTL. Y el control: un cambio hecho directo en
// la base NO se ve hasta que vence, o sea que la caché está de verdad activa y
// lo que hace pasar los otros casos es la invalidación.
// ---------------------------------------------------------------------------

let taller: OrgDePrueba;
let esencial: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

// El usuario 0 es el ADMIN que hace los cambios; el 1, a quien se los hacen.
const comoActor = (metodo: string, path: string, body?: unknown) =>
  pedir(taller, metodo, path, body, taller.tokens[0]);
const meDelOtro = () => pedir(taller, "GET", "/api/me", undefined, taller.tokens[1]);
const otro = () => taller.authIds[1];

before(async () => {
  usarCacheDeAuthParaTests(30_000);
  ({ baseUrl, cerrar } = await levantarApp());
  taller = await crearOrgDePrueba("cache-auth", "COMPLETA", "AUTOMOTORA", 2);
  esencial = await crearOrgDePrueba("cache-auth", "ESENCIAL", "AUTOMOTORA", 1);
});

after(async () => {
  usarCacheDeAuthParaTests(null);
  if (cerrar) await cerrar();
  if (taller) await borrarOrgDePrueba(taller);
  if (esencial) await borrarOrgDePrueba(esencial);
});

async function rolEnMe(): Promise<string> {
  const r = await meDelOtro();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return (r.json as { role: string }).role;
}

test("cambiar el rol por la API se ve en el próximo request; directo en la base, no", async () => {
  assert.equal(await rolEnMe(), "ADMIN"); // queda en la caché

  const cambio = await comoActor("PATCH", `/api/users/${otro()}`, { role: "USER" });
  assert.equal(cambio.status, 200, JSON.stringify(cambio.json));
  assert.equal(await rolEnMe(), "USER");

  // Control: por fuera de la API la caché manda hasta que vence.
  const admin = await findRoleByName("ADMIN");
  await prisma.user.update({ where: { id: otro() }, data: { roleId: admin!.id } });
  assert.equal(await rolEnMe(), "USER");

  // Lo deja como estaba (ADMIN), por la API, para los casos que siguen.
  const vuelta = await comoActor("PATCH", `/api/users/${otro()}`, { role: "ADMIN" });
  assert.equal(vuelta.status, 200, JSON.stringify(vuelta.json));
  assert.equal(await rolEnMe(), "ADMIN");
});

test("desactivar corta el acceso en el próximo request, y reactivar lo devuelve", async () => {
  assert.equal((await meDelOtro()).status, 200);

  const baja = await comoActor("PATCH", `/api/users/${otro()}`, { isActive: false });
  assert.equal(baja.status, 200, JSON.stringify(baja.json));
  const rechazo = await meDelOtro();
  assert.equal(rechazo.status, 403, JSON.stringify(rechazo.json));

  const alta = await comoActor("PATCH", `/api/users/${otro()}`, { isActive: true });
  assert.equal(alta.status, 200, JSON.stringify(alta.json));
  assert.equal((await meDelOtro()).status, 200);
});

test("los módulos activables se ven en el próximo request", async () => {
  const antes = await meDelOtro();
  assert.ok(!(antes.json as { modulos: string[] }).modulos.includes("servicios"));

  await activarModulo(taller.id, "servicios", taller.authIds[0]);
  const despues = await meDelOtro();
  assert.ok((despues.json as { modulos: string[] }).modulos.includes("servicios"));
});

test("subir de edición se ve en el próximo request", async () => {
  const me = () => pedir(esencial, "GET", "/api/me", undefined, esencial.tokens[0]);
  assert.equal(((await me()).json as { edition: string }).edition, "ESENCIAL");

  await cambiarEdicionDeOrganizacion(esencial.id, "COMPLETA");
  assert.equal(((await me()).json as { edition: string }).edition, "COMPLETA");
});

test("varios requests a la vez, con la caché vacía, leen al usuario una sola vez", async () => {
  vaciarContextosDeAuth();
  const { resultado, consultas } = await contarConsultas(() =>
    Promise.all(Array.from({ length: 5 }, () => meDelOtro())),
  );
  assert.ok(resultado.every((r) => r.status === 200));
  // La consulta de autenticación (findUserForAuth) es la única con role_name.
  const deAuth = consultas.filter((sql) => sql.includes("AS role_name"));
  assert.equal(deAuth.length, 1, `${deAuth.length} lecturas del usuario`);
});

// Va último: remover no tiene vuelta atrás por la API.
test("remover de la organización corta el acceso en el próximo request", async () => {
  assert.equal((await meDelOtro()).status, 200);

  const remover = await comoActor("DELETE", `/api/users/${otro()}`);
  assert.ok(remover.status < 300, JSON.stringify(remover.json));
  const rechazo = await meDelOtro();
  assert.equal(rechazo.status, 403, JSON.stringify(rechazo.json));
});
