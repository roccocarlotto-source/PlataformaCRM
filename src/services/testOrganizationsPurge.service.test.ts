import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { slugify } from "../utils/slug";
import {
  calcularOrdenDeBorrado,
  parsearIdsProtegidos,
  PATRONES_DE_SLUG_DE_PRUEBA,
  patronesQueCoinciden,
  type ForeignKey,
} from "./testOrganizationsPurge.service";

// ---------------------------------------------------------------------------
// El catálogo de patrones contra el código real de los tests: si alguien
// agrega un test que crea organizaciones con una plantilla nueva, este archivo
// falla hasta que se la agregue al catálogo. Sin esto, la próxima corrida de la
// purga dejaría esas organizaciones sin ver.
// ---------------------------------------------------------------------------

const RAIZ = join(__dirname, "..", "..");

function archivosDeTest(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosDeTest(ruta);
    return /\.integration-test\.ts$|\.test-helper\.ts$/.test(nombre) ? [ruta] : [];
  });
}

// Instancia una plantilla de test con valores de muestra con la forma real de
// cada generador.
function instanciar(plantilla: string): string {
  return plantilla
    .replace(/\$\{Date\.now\(\)\}/g, "1790000000000")
    .replace(/\$\{randomUUID\(\)\.slice\(0, 8\)\}/g, "a1b2c3d4")
    .replace(/\$\{randomUUID\(\)\}/g, "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")
    .replace(/\$\{sufijo\}/g, "a1b2c3d4")
    .replace(/\$\{[^}]+\}/g, "etiqueta");
}

const plantillas = archivosDeTest(join(RAIZ, "src")).flatMap((archivo) => {
  const origen = relative(RAIZ, archivo).replace(/\\/g, "/");
  const codigo = readFileSync(archivo, "utf8");
  const deSlug = [...codigo.matchAll(/\bslug: `([^`]+)`/g)].map((m) => ({
    origen,
    plantilla: m[1],
    slug: instanciar(m[1]),
  }));
  const deNombre = [...codigo.matchAll(/\borganizationName(?::| =) `([^`]+)`/g)].map((m) => ({
    origen,
    plantilla: m[1],
    slug: slugify(instanciar(m[1])),
  }));
  // Las que empiezan con una variable (`${creado.organization.slug}-bis`) no
  // crean nada: son búsquedas o derivan de otra plantilla ya cubierta.
  return [...deSlug, ...deNombre].filter((p) => !p.plantilla.startsWith("${"));
});

test("el escaneo encuentra las plantillas de los tests (si esto da 0, el escaneo está roto)", () => {
  assert.ok(plantillas.length > 80, `solo ${String(plantillas.length)} plantillas`);
});

test("toda plantilla de slug de un test coincide con un patrón del catálogo que cita ese archivo", () => {
  const sinCubrir = plantillas.filter(
    (p) => !patronesQueCoinciden(p.slug).some((patron) => patron.origen === p.origen),
  );
  assert.deepEqual(
    sinCubrir.map((p) => `${p.origen}: ${p.plantilla} -> ${p.slug}`),
    [],
    "agregar estas plantillas a PATRONES_DE_SLUG_DE_PRUEBA",
  );
});

test("cada patrón del catálogo cita un archivo que existe", () => {
  const faltantes = PATRONES_DE_SLUG_DE_PRUEBA.filter((p) => {
    try {
      return !statSync(join(RAIZ, p.origen)).isFile();
    } catch {
      return true;
    }
  });
  assert.deepEqual(
    faltantes.map((p) => p.origen),
    [],
  );
});

test("slugs de organizaciones reales no coinciden con ningún patrón", () => {
  for (const nombre of [
    "AutoMax",
    "Automotora Pérez",
    "Automation Solutions",
    "Auto Won",
    "Reply Motors",
    "Concurrencia 2026",
    "Kb Autos 1790000000000",
    "Listado Vigente",
    "M4 Org A",
  ]) {
    assert.deepEqual(patronesQueCoinciden(slugify(nombre)), [], nombre);
  }
});

test("los ejemplos del incidente coinciden", () => {
  assert.ok(patronesQueCoinciden("auto-won-1790000000000-a1b2c3d4").length > 0);
  assert.ok(patronesQueCoinciden("auto-stale-x-1790000000000-a1b2c3d4").length > 0);
  // Un slug parecido pero sin el sufijo aleatorio completo no alcanza.
  assert.deepEqual(patronesQueCoinciden("auto-won-1790000000000"), []);
  assert.deepEqual(patronesQueCoinciden("auto-won-179000000000-a1b2c3d4"), []);
});

test("parsearIdsProtegidos: vacía o con un id inválido es un error, nunca 'nada protegido'", () => {
  assert.throws(() => parsearIdsProtegidos(undefined), /vacía/);
  assert.throws(() => parsearIdsProtegidos(" , "), /vacía/);
  assert.throws(() => parsearIdsProtegidos("11111111-1111-1111-1111-11111111111"), /no son UUID/);
  assert.deepEqual(
    parsearIdsProtegidos(
      " 11111111-1111-1111-1111-111111111111 ,22222222-2222-2222-2222-22222222222A",
    ),
    ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-22222222222a"],
  );
});

// ---------------------------------------------------------------------------
// Orden de borrado
// ---------------------------------------------------------------------------

const fk = (hija: string, madre: string, columnasAnulables: string[] = []): ForeignKey => ({
  nombre: `${hija}_${madre}_fkey`,
  hija,
  madre,
  columnasAnulables,
});

const antes = (orden: string[], a: string, b: string): boolean =>
  orden.indexOf(a) < orden.indexOf(b);

test("orden: hijas antes que madres", () => {
  const { tablas, anular } = calcularOrdenDeBorrado(
    ["users", "stages", "pipelines", "opportunities"],
    [
      fk("users", "organizations"),
      fk("stages", "pipelines"),
      fk("opportunities", "stages"),
      fk("opportunities", "pipelines"),
      fk("opportunities", "users"),
      fk("users", "roles"),
    ],
  );
  assert.equal(tablas.length, 4);
  assert.ok(antes(tablas, "opportunities", "stages"));
  assert.ok(antes(tablas, "stages", "pipelines"));
  assert.ok(antes(tablas, "opportunities", "users"));
  assert.deepEqual(anular, []);
});

test("orden: un ciclo se corta anulando su FK anulable", () => {
  const ciclo = fk("messages", "agent_inbound_jobs", ["inbound_job_id"]);
  const { tablas, anular } = calcularOrdenDeBorrado(
    ["messages", "agent_inbound_jobs", "conversations"],
    [ciclo, fk("agent_inbound_jobs", "messages"), fk("messages", "conversations")],
  );
  assert.deepEqual(anular, [ciclo]);
  assert.ok(antes(tablas, "agent_inbound_jobs", "messages"));
  assert.ok(antes(tablas, "messages", "conversations"));
});

test("orden: las FKs de un invariante (empresa o contacto de la oportunidad) no se anulan aunque estén en el ciclo", () => {
  const conNombre = (nombre: string, base: ForeignKey): ForeignKey => ({ ...base, nombre });
  const opContacto = conNombre(
    "opportunities_organization_id_contact_id_fkey",
    fk("opportunities", "contacts", ["contact_id"]),
  );
  const interes = fk("contacts", "vehicles", ["vehicle_of_interest_id"]);
  const opVehiculo = fk("opportunities", "vehicles", ["vehicle_id"]);
  const vehiculoOp = fk("vehicles", "opportunities", ["reserved_opportunity_id"]);
  const { tablas, anular } = calcularOrdenDeBorrado(
    ["opportunities", "contacts", "vehicles"],
    [opContacto, interes, opVehiculo, vehiculoOp],
  );
  assert.ok(!anular.includes(opContacto), "la oportunidad no se queda sin contacto");
  assert.ok(anular.includes(interes));
  assert.ok(antes(tablas, "opportunities", "contacts"));
});

test("orden: autorreferencia anulable se anula; la no anulable no frena", () => {
  const auto = fk("activities", "activities", ["parent_id"]);
  const r = calcularOrdenDeBorrado(["activities"], [auto]);
  assert.deepEqual(r, { tablas: ["activities"], anular: [auto] });
  assert.deepEqual(calcularOrdenDeBorrado(["a"], [fk("a", "a")]), { tablas: ["a"], anular: [] });
});

test("orden: ciclo sin FK anulable aborta", () => {
  assert.throws(() => calcularOrdenDeBorrado(["a", "b"], [fk("a", "b"), fk("b", "a")]), /Ciclo/);
});

test("orden: una tabla sin organization_id que referencia a una de negocio aborta", () => {
  assert.throws(
    () => calcularOrdenDeBorrado(["contacts"], [fk("_ContactToTag", "contacts")]),
    /_ContactToTag.*no tiene organization_id/,
  );
});
