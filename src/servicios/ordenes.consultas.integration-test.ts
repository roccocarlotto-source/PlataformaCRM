// Primero: el contador tiene que quedar como singleton antes de lib/prisma.
import { contarConsultas } from "../lib/contarConsultas.test-helper";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { findOrderById, findOrderByIdConPrisma } from "./repositories/serviceOrder.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { createBranch } from "../services/branch.service";
import { activarModulo } from "../services/organizationModules.service";

// ---------------------------------------------------------------------------
// Cuántas consultas SQL hace cada escritura de una orden, request completo
// (autenticación incluida). En producción cada una es una ida y vuelta de
// ~100-250 ms: la prueba de S4a (2026-10-14) midió 7-9 s por cambio de estado.
// El tope de cada caso es el presupuesto: si una mejora lo baja, se baja el
// tope; si un cambio lo sube, que sea a conciencia.
// ---------------------------------------------------------------------------

let taller: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);
const ORDENES = "/api/servicios/ordenes";
const comoAdmin = (metodo: string, path: string, body?: unknown) =>
  pedir(taller, metodo, path, body, taller.tokens[0]);

let sucursal: string;
let duena: string;
let tipos: string[];
const medidas: { caso: string; consultas: number }[] = [];

async function medir(
  caso: string,
  presupuesto: number,
  fn: () => Promise<{ status: number; json: unknown }>,
) {
  const { resultado, consultas } = await contarConsultas(fn);
  assert.ok(
    resultado.status < 300,
    `${caso}: ${resultado.status} ${JSON.stringify(resultado.json)}`,
  );
  medidas.push({ caso, consultas: consultas.length });
  assert.ok(
    consultas.length <= presupuesto,
    `${caso}: ${consultas.length} consultas, el presupuesto es ${presupuesto}`,
  );
  // CONSULTAS_DETALLE=<parte del caso> imprime el SQL de ese caso.
  const detalle = process.env.CONSULTAS_DETALLE;
  if (detalle && caso.includes(detalle)) console.log(consultas.join("\n"));
  return { json: resultado.json as Record<string, unknown> & { id: string }, n: consultas.length };
}

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  taller = await crearOrgDePrueba("servicios-ordenes", "COMPLETA", "AUTOMOTORA", 1);
  await prisma.organization.update({
    where: { id: taller.id },
    data: { timezone: "America/Montevideo", preferredCurrency: "UYU" },
  });
  await activarModulo(taller.id, "servicios", taller.authIds[0]);
  sucursal = (
    await createBranch(taller.id, { name: "Taller Centro", timezone: "America/Montevideo" })
  ).id;
  duena = (
    await prisma.contact.create({
      data: { organizationId: taller.id, firstName: "Duena", lastName: "Consultas" },
    })
  ).id;
  tipos = [];
  for (const [name, meses] of [
    ["Aceite", 6],
    ["Frenos", 3],
  ] as const) {
    const r = await comoAdmin("POST", "/api/servicios/tipos", {
      name,
      nextServiceAfterMonths: meses,
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    tipos.push((r.json as { id: string }).id);
  }
});

after(async () => {
  if (medidas.length > 0) {
    console.log("\nConsultas SQL por request:");
    for (const m of medidas) console.log(`  ${String(m.consultas).padStart(3)}  ${m.caso}`);
  }
  if (cerrar) await cerrar();
  if (taller) await borrarOrgDePrueba(taller);
});

// Las dos lecturas de la ficha tienen que dar lo mismo, campo por campo.
async function fichaIgualAPrisma(id: string, momento: string) {
  const [cruda, conPrisma] = await Promise.all([
    findOrderById(taller.id, id),
    findOrderByIdConPrisma(taller.id, id),
  ]);
  assert.ok(conPrisma, momento);
  assert.deepStrictEqual(cruda, conPrisma, momento);
}

test("cada escritura de una orden entra en su presupuesto de consultas", async () => {
  const v = await comoAdmin("POST", "/api/servicios/vehiculos", {
    contactId: duena,
    make: "Toyota",
    model: "Hilux",
    branchId: sucursal,
    licensePlate: `CON${randomUUID().slice(0, 6)}`,
  });
  assert.equal(v.status, 201, JSON.stringify(v.json));
  const vehiculoId = (v.json as { id: string }).id;

  // Base: una lectura autenticada mínima, para separar lo que cuesta la
  // autenticación de lo que cuesta la orden.
  await medir("GET /api/me (base: autenticación)", 3, () => comoAdmin("GET", "/api/me"));

  const { json: orden } = await medir("POST orden (Recibido, 2 tipos, valor)", 15, () =>
    comoAdmin("POST", ORDENES, {
      customerVehicleId: vehiculoId,
      estado: "RECIBIDO",
      mileageIn: 50000,
      jobTypeIds: tipos,
      amount: 100,
    }),
  );
  const id = orden.id;
  const estado = (body: Record<string, unknown>) =>
    comoAdmin("POST", `${ORDENES}/${id}/estado`, body);
  await fichaIgualAPrisma(id, "recién creada, sin encargado");

  await medir("GET orden (ficha)", 2, () => comoAdmin("GET", `${ORDENES}/${id}`));
  await medir("PATCH orden (encargado, notas, tipos)", 10, () =>
    comoAdmin("PATCH", `${ORDENES}/${id}`, {
      assigneeId: taller.authIds[0],
      notes: "Ruido al frenar",
      jobTypeIds: [tipos[1]],
    }),
  );
  await medir("estado Recibido → En trabajo", 7, () =>
    estado({ desde: "RECIBIDO", hacia: "EN_TRABAJO" }),
  );
  await medir("estado En trabajo → Esperando aprobación", 7, () =>
    estado({ desde: "EN_TRABAJO", hacia: "ESPERANDO_APROBACION", nota: "Presupuesto enviado" }),
  );
  await medir("POST aprobación (sumar al valor)", 8, () =>
    comoAdmin("POST", `${ORDENES}/${id}/aprobaciones`, {
      description: "Pastillas",
      decision: "APROBADO",
      approverName: "Duena",
      channel: "TELEFONO",
      decidedAt: new Date().toISOString(),
      amount: 50.5,
      sumarAlValor: true,
    }),
  );
  await fichaIgualAPrisma(id, "con encargado, historial y una aprobación");
  await medir("estado Esperando aprobación → En trabajo", 9, () =>
    estado({ desde: "ESPERANDO_APROBACION", hacia: "EN_TRABAJO" }),
  );
  await medir("estado En trabajo → Listo para retirar", 9, () =>
    estado({ desde: "EN_TRABAJO", hacia: "LISTO_PARA_RETIRAR" }),
  );
  const { json: entregada } = await medir("estado Listo para retirar → Entregado", 8, () =>
    estado({ desde: "LISTO_PARA_RETIRAR", hacia: "ENTREGADO", proximoService: "2027-01-14" }),
  );
  assert.equal(entregada.status, "ENTREGADO");
  assert.equal(entregada.amount, "150.50");
  await fichaIgualAPrisma(id, "entregada, con próximo service");
});
