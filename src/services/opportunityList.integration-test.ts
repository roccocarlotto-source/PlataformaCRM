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

// ---------------------------------------------------------------------------
// GET /api/opportunities trae, en cada fila, el nombre del contacto, la
// empresa, el proceso y la etapa: la tabla ya no pide un GET por cada uno
// (era una segunda ronda de requests, ~10 consultas cada una). Una relación
// borrada viaja como null, que es lo que la tabla mostraba antes ("—").
// ---------------------------------------------------------------------------

let org: OrgDePrueba;
let otra: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

interface Fila {
  title: string;
  contactId: string | null;
  contact: { id: string; firstName: string; lastName: string } | null;
  company: { id: string; name: string } | null;
  pipeline: { id: string; name: string } | null;
  stage: { id: string; name: string } | null;
}

async function sembrar(o: OrgDePrueba, prefijo: string) {
  const pipeline = await prisma.pipeline.create({
    data: { organizationId: o.id, name: `${prefijo} Ventas` },
  });
  const stage = await prisma.stage.create({
    data: { organizationId: o.id, pipelineId: pipeline.id, name: `${prefijo} Nuevo`, order: 0 },
  });
  const vigente = await prisma.contact.create({
    data: { organizationId: o.id, firstName: `${prefijo}Ana`, lastName: "Vigente" },
  });
  const borrado = await prisma.contact.create({
    data: { organizationId: o.id, firstName: `${prefijo}Beto`, lastName: "Borrado" },
  });
  const empresa = await prisma.company.create({
    data: { organizationId: o.id, name: `${prefijo} Empresa SA` },
  });
  const empresaBorrada = await prisma.company.create({
    data: { organizationId: o.id, name: `${prefijo} Cerrada SRL` },
  });
  const base = {
    organizationId: o.id,
    ownerId: o.authIds[0],
    pipelineId: pipeline.id,
    stageId: stage.id,
  };
  await prisma.opportunity.create({
    data: { ...base, title: `${prefijo} con todo`, contactId: vigente.id, companyId: empresa.id },
  });
  await prisma.opportunity.create({
    data: { ...base, title: `${prefijo} contacto borrado`, contactId: borrado.id },
  });
  await prisma.opportunity.create({
    data: { ...base, title: `${prefijo} solo empresa borrada`, companyId: empresaBorrada.id },
  });
  await prisma.contact.update({ where: { id: borrado.id }, data: { deletedAt: new Date() } });
  await prisma.company.update({
    where: { id: empresaBorrada.id },
    data: { deletedAt: new Date() },
  });
  return { pipeline, stage, vigente, borrado, empresa };
}

let datos: Awaited<ReturnType<typeof sembrar>>;

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  org = await crearOrgDePrueba("opp-lista", "COMPLETA", "AUTOMOTORA", 1);
  otra = await crearOrgDePrueba("opp-lista", "COMPLETA", "AUTOMOTORA", 1);
  datos = await sembrar(org, "A");
  await sembrar(otra, "B");
});

// borrarOrgDePrueba no borra empresas: van antes, después de sus oportunidades.
async function borrar(o: OrgDePrueba | undefined) {
  if (!o) return;
  await prisma.opportunity.deleteMany({ where: { organizationId: o.id } });
  await prisma.company.deleteMany({ where: { organizationId: o.id } });
  await borrarOrgDePrueba(o);
}

after(async () => {
  if (cerrar) await cerrar();
  await borrar(org);
  await borrar(otra);
});

async function listar() {
  const r = await pedir(org, "GET", "/api/opportunities?pageSize=20&sortBy=title&sortOrder=asc");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return (r.json as { data: Fila[] }).data;
}

test("cada fila trae los nombres de sus relaciones; las borradas, null", async () => {
  const filas = await listar();
  assert.deepEqual(
    filas.map((f) => f.title),
    ["A con todo", "A contacto borrado", "A solo empresa borrada"],
    "solo las de la organización propia",
  );
  const [conTodo, contactoBorrado, empresaBorrada] = filas;

  assert.deepEqual(conTodo.contact, {
    id: datos.vigente.id,
    firstName: "AAna",
    lastName: "Vigente",
  });
  assert.deepEqual(conTodo.company, { id: datos.empresa.id, name: "A Empresa SA" });
  assert.deepEqual(conTodo.pipeline, { id: datos.pipeline.id, name: "A Ventas" });
  assert.deepEqual(conTodo.stage, { id: datos.stage.id, name: "A Nuevo" });

  // El id sigue estando (la fila no cambia); el nombre, no.
  assert.equal(contactoBorrado.contactId, datos.borrado.id);
  assert.equal(contactoBorrado.contact, null);
  assert.equal(empresaBorrada.contact, null);
  assert.equal(empresaBorrada.company, null);
  assert.deepEqual(empresaBorrada.stage, { id: datos.stage.id, name: "A Nuevo" });
});

test("el listado entra en su presupuesto de consultas", async () => {
  // Autenticación, la página y el total, y los nombres: contacto, empresa,
  // proceso y etapa, en paralelo (findNombresParaElListado).
  const { consultas } = await contarConsultas(() => listar());
  assert.ok(consultas.length <= 7, `${consultas.length} consultas:\n${consultas.join("\n")}`);
});
