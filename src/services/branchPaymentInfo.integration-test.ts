import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  CATALOGO_DE_TOOLS,
  NOMBRE_TOOL_PAGO,
  type ContextoDeEjecucionDeTool,
} from "./agentTools.service";
import { createBranch, getBranchById, updateBranch } from "./branch.service";
import { desmontar, montar, type Escenario } from "./vehicle.test-helper";

// ---------------------------------------------------------------------------
// Datos de cobro por sucursal (ítem 74 de docs/frontend-cambios-pendientes.md)
// contra Postgres real:
//
//   A. CONFIGURARLOS — branch.service.ts guarda paymentLinkUrl y
//      bankTransferDetails tal cual vienen, con el contrato de siempre en el
//      PATCH: undefined no toca, null vacía.
//   B. LEERLOS DESDE EL AGENTE — get_payment_info devuelve lo que tiene la
//      sucursal de la CONVERSACIÓN, y con nada configurado devuelve el objeto
//      igual, con los dos flags en false.
//
// La validación del borde (http(s)://, topes de largo) está en
// branch.controller.test.ts, sin base.
//
// DOS ORGANIZACIONES (vehicle.test-helper): B solo existe para el caso
// cross-tenant — una conversación de A que apuntara a la sucursal de B no ve
// sus datos de cobro.
// ---------------------------------------------------------------------------

const TZ = "America/Montevideo";
const LINK = "https://mpago.la/2abc3de";
const TRANSFERENCIA = "Banco República\nCuenta 001234567-00001\nTitular: Casa Central SRL";

let a: Escenario;
let b: Escenario;

before(async () => {
  a = await montar("branch-payment-a");
  b = await montar("branch-payment-b");
});

after(async () => {
  await desmontar(a, b);
});

function contextoDe(organizationId: string, branchId: string): ContextoDeEjecucionDeTool {
  // La tool solo lee organizationId y branchId; el resto no toca la base.
  return {
    organizationId,
    conversation: {
      id: "00000000-0000-4000-8000-000000000002",
      contactId: "00000000-0000-4000-8000-000000000003",
      branchId,
      agentId: "00000000-0000-4000-8000-000000000005",
    },
  };
}

async function datosDeCobro(organizationId: string, branchId: string) {
  const resultado = await CATALOGO_DE_TOOLS.get(NOMBRE_TOOL_PAGO)!.ejecutar(
    {},
    contextoDe(organizationId, branchId),
  );
  assert.equal(resultado.ok, true);
  return resultado.ok ? resultado.data : undefined;
}

// ---------------------------------------------------------------------------
// A. Configurarlos
// ---------------------------------------------------------------------------

test("crear: sin los campos, la sucursal nace sin datos de cobro", async () => {
  const branch = await createBranch(a.organizationId, { name: "Sin cobro", timezone: TZ });
  assert.equal(branch.paymentLinkUrl, null);
  assert.equal(branch.bankTransferDetails, null);
});

test("crear: con los dos, quedan guardados y se leen de vuelta desde la base", async () => {
  const branch = await createBranch(a.organizationId, {
    name: "Con cobro",
    timezone: TZ,
    paymentLinkUrl: LINK,
    bankTransferDetails: TRANSFERENCIA,
  });
  const leida = await getBranchById(a.organizationId, branch.id);
  assert.equal(leida.paymentLinkUrl, LINK);
  // Texto libre: los saltos de línea se conservan tal cual.
  assert.equal(leida.bankTransferDetails, TRANSFERENCIA);
});

test("actualizar: son independientes — tocar uno no toca el otro, ni al resto de la sucursal", async () => {
  const branch = await createBranch(a.organizationId, {
    name: "Independientes",
    timezone: TZ,
    paymentLinkUrl: LINK,
  });

  const conTransferencia = await updateBranch(a.organizationId, branch.id, {
    bankTransferDetails: TRANSFERENCIA,
  });
  assert.equal(conTransferencia.paymentLinkUrl, LINK, "undefined no toca la columna");
  assert.equal(conTransferencia.bankTransferDetails, TRANSFERENCIA);

  // Un PATCH que solo cambia el nombre deja los dos como estaban.
  const renombrada = await updateBranch(a.organizationId, branch.id, { name: "Renombrada" });
  assert.equal(renombrada.paymentLinkUrl, LINK);
  assert.equal(renombrada.bankTransferDetails, TRANSFERENCIA);
});

test("actualizar: null vacía cada campo por separado", async () => {
  const branch = await createBranch(a.organizationId, {
    name: "A vaciar",
    timezone: TZ,
    paymentLinkUrl: LINK,
    bankTransferDetails: TRANSFERENCIA,
  });

  const sinLink = await updateBranch(a.organizationId, branch.id, { paymentLinkUrl: null });
  assert.equal(sinLink.paymentLinkUrl, null);
  assert.equal(sinLink.bankTransferDetails, TRANSFERENCIA);

  const sinNada = await updateBranch(a.organizationId, branch.id, { bankTransferDetails: null });
  assert.equal(sinNada.paymentLinkUrl, null);
  assert.equal(sinNada.bankTransferDetails, null);
});

// ---------------------------------------------------------------------------
// B. get_payment_info
// ---------------------------------------------------------------------------

test("get_payment_info: devuelve lo configurado en la sucursal de la conversación", async () => {
  const branch = await createBranch(a.organizationId, {
    name: "Tool con los dos",
    timezone: TZ,
    paymentLinkUrl: LINK,
    bankTransferDetails: TRANSFERENCIA,
  });
  assert.deepEqual(await datosDeCobro(a.organizationId, branch.id), {
    hasPaymentLink: true,
    paymentLinkUrl: LINK,
    hasBankTransfer: true,
    bankTransferDetails: TRANSFERENCIA,
  });
});

test("get_payment_info: con uno solo configurado, el otro viene en false/null", async () => {
  const branch = await createBranch(a.organizationId, {
    name: "Tool solo transferencia",
    timezone: TZ,
    bankTransferDetails: TRANSFERENCIA,
  });
  assert.deepEqual(await datosDeCobro(a.organizationId, branch.id), {
    hasPaymentLink: false,
    paymentLinkUrl: null,
    hasBankTransfer: true,
    bankTransferDetails: TRANSFERENCIA,
  });
});

test("get_payment_info: sin nada configurado no rompe — devuelve los dos flags en false", async () => {
  // La sucursal que montar() crea no tiene datos de cobro.
  assert.deepEqual(await datosDeCobro(a.organizationId, a.branchId), {
    hasPaymentLink: false,
    paymentLinkUrl: null,
    hasBankTransfer: false,
    bankTransferDetails: null,
  });
});

test("get_payment_info: una sucursal de OTRA organización no se lee — es 'no configurado'", async () => {
  await updateBranch(b.organizationId, b.branchId, {
    paymentLinkUrl: LINK,
    bankTransferDetails: TRANSFERENCIA,
  });
  // Contexto de A apuntando al branchId de B: findBranchById filtra por
  // organización, así que no hay nada que devolver.
  assert.deepEqual(await datosDeCobro(a.organizationId, b.branchId), {
    hasPaymentLink: false,
    paymentLinkUrl: null,
    hasBankTransfer: false,
    bankTransferDetails: null,
  });
  // Y la propia B sí los ve, para que el caso de arriba no pase por accidente.
  const deB = (await datosDeCobro(b.organizationId, b.branchId)) as { paymentLinkUrl: string };
  assert.equal(deB.paymentLinkUrl, LINK);
});

test("la tool no escribe nada: la sucursal queda igual después de ejecutarla", async () => {
  const antes = await prisma.branch.findUniqueOrThrow({ where: { id: a.branchId } });
  await datosDeCobro(a.organizationId, a.branchId);
  const despues = await prisma.branch.findUniqueOrThrow({ where: { id: a.branchId } });
  assert.equal(despues.updatedAt.getTime(), antes.updatedAt.getTime());
});
