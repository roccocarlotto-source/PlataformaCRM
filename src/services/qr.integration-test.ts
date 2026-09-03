import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { esperarBloqueadoPor, sostenerTransaccion } from "../lib/carreras.test-helper";
import { prisma } from "../lib/prisma";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import { AppError } from "../utils/AppError";
import { createBranch } from "./branch.service";
import {
  claimQrCode,
  createDigitalQrCode,
  deleteQrCode,
  listQrCodes,
  updateQrCode,
} from "./qr.service";

// ---------------------------------------------------------------------------
// claim / digital / listar / editar / borrar contra Postgres real
// (docs/qr-integration.md, Fase 2 — "Verificación"). Lo que no se puede probar
// sin base: el aislamiento entre organizaciones, el 409 del id ya reclamado, el
// contador de display_number bajo concurrencia real y su rollback, y la
// anti-enumeración de PATCH/DELETE.
//
// CADA TEST TRAE SU PROPIA ORGANIZACIÓN, igual que booking-config.
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";
const DESTINO = "https://g.page/r/test/review";

interface Escenario {
  organizationId: string;
  branchId: string;
}

async function montar(etiqueta: string): Promise<Escenario> {
  const org = await prisma.organization.create({
    data: {
      name: `QR ${etiqueta} ${randomUUID()}`,
      slug: `qr-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const branch = await createBranch(org.id, { name: "Centro", timezone: TZ });
  return { organizationId: org.id, branchId: branch.id };
}

async function desmontar(...escenarios: Escenario[]) {
  for (const e of escenarios) {
    await prisma.qrCode.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.branch.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.organization.delete({ where: { id: e.organizationId } });
  }
}

function assertAppError(err: unknown, statusCode: number, message: string) {
  assert.ok(err instanceof AppError, `debe ser AppError, no un error crudo. Fue: ${String(err)}`);
  assert.equal(err.statusCode, statusCode);
  assert.equal(err.message, message);
}

async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  assert.fail("se esperaba un error y no hubo ninguno");
}

function digital(e: Escenario, extra: Partial<Parameters<typeof createDigitalQrCode>[1]> = {}) {
  return createDigitalQrCode(e.organizationId, {
    branchId: e.branchId,
    name: "Mostrador",
    destinationUrl: DESTINO,
    message: null,
    qrType: "REUSABLE",
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Claim de un QR físico (decisión 4: INSERT con el id del sticker)
// ---------------------------------------------------------------------------

test("claim: la fila nace en el claim con el id del sticker, ya reclamada, REUSABLE y con display_number 1", async () => {
  const e = await montar("claim");
  try {
    const qrId = randomUUID();
    const qr = await claimQrCode(e.organizationId, {
      qrId,
      branchId: e.branchId,
      name: "Mesa 1",
      destinationUrl: DESTINO,
      message: null,
    });
    assert.equal(qr.id, qrId);
    assert.equal(qr.organizationId, e.organizationId);
    assert.equal(qr.branchId, e.branchId);
    assert.equal(qr.qrType, "REUSABLE");
    assert.equal(qr.displayNumber, 1);
    assert.notEqual(qr.claimedAt, null);
    assert.equal(qr.usedAt, null);
  } finally {
    await desmontar(e);
  }
});

test("claim: un id ya reclamado -> 409 genérico, aunque lo intente OTRA organización", async () => {
  const a = await montar("claim-a");
  const b = await montar("claim-b");
  try {
    const qrId = randomUUID();
    const datos = { qrId, name: "Mesa", destinationUrl: DESTINO, message: null };
    await claimQrCode(a.organizationId, { ...datos, branchId: a.branchId });

    const mismaOrg = await capturar(() =>
      claimQrCode(a.organizationId, { ...datos, branchId: a.branchId }),
    );
    assertAppError(mismaOrg, 409, "QR ya reclamado o no existe");

    const otraOrg = await capturar(() =>
      claimQrCode(b.organizationId, { ...datos, branchId: b.branchId }),
    );
    assertAppError(otraOrg, 409, "QR ya reclamado o no existe");

    // Y sigue siendo de A, intacto.
    const fila = await prisma.qrCode.findUnique({ where: { id: qrId } });
    assert.equal(fila?.organizationId, a.organizationId);
  } finally {
    await desmontar(a, b);
  }
});

test("claim/digital: no se puede asociar a una Branch ajena — mismo 400 que resource.service, sin confirmar que exista", async () => {
  const a = await montar("branch-a");
  const b = await montar("branch-b");
  try {
    const ajena = await capturar(() =>
      claimQrCode(a.organizationId, {
        qrId: randomUUID(),
        branchId: b.branchId,
        name: "Mesa",
        destinationUrl: DESTINO,
        message: null,
      }),
    );
    assertAppError(ajena, 400, "La sucursal indicada no existe o no pertenece a tu organización");

    const inexistente = await capturar(() => digital(a, { branchId: randomUUID() }));
    assertAppError(
      inexistente,
      400,
      "La sucursal indicada no existe o no pertenece a tu organización",
    );

    assert.equal(await prisma.qrCode.count({ where: { organizationId: a.organizationId } }), 0);
  } finally {
    await desmontar(a, b);
  }
});

// ---------------------------------------------------------------------------
// display_number (DEC-064/066)
// ---------------------------------------------------------------------------

test("display_number: secuencial por organización, no global; digital y claim comparten el contador", async () => {
  const a = await montar("num-a");
  const b = await montar("num-b");
  try {
    const a1 = await digital(a);
    const a2 = await claimQrCode(a.organizationId, {
      qrId: randomUUID(),
      branchId: a.branchId,
      name: "Físico",
      destinationUrl: DESTINO,
      message: null,
    });
    const b1 = await digital(b);
    const a3 = await digital(a);

    assert.deepEqual([a1.displayNumber, a2.displayNumber, a3.displayNumber], [1, 2, 3]);
    assert.equal(b1.displayNumber, 1, "el contador es por organización");

    const org = await prisma.organization.findUnique({ where: { id: a.organizationId } });
    assert.equal(org?.nextQrDisplayNumber, 4);
  } finally {
    await desmontar(a, b);
  }
});

test("display_number: un claim que falla NO quema el número (la transacción revierte el incremento)", async () => {
  const e = await montar("num-rollback");
  try {
    const primero = await digital(e);
    assert.equal(primero.displayNumber, 1);

    // Falla por id ya reclamado (409) y por sucursal ajena (400): ninguna de las
    // dos tiene que mover el contador.
    await capturar(() =>
      claimQrCode(e.organizationId, {
        qrId: primero.id,
        branchId: e.branchId,
        name: "x",
        destinationUrl: DESTINO,
        message: null,
      }),
    );
    await capturar(() => digital(e, { branchId: randomUUID() }));

    const org = await prisma.organization.findUnique({ where: { id: e.organizationId } });
    assert.equal(org?.nextQrDisplayNumber, 2);

    const segundo = await digital(e);
    assert.equal(segundo.displayNumber, 2);
  } finally {
    await desmontar(e);
  }
});

test("display_number: un QR borrado no libera su número (contador durable, no max()+1)", async () => {
  const e = await montar("num-borrado");
  try {
    const q1 = await digital(e);
    await deleteQrCode(e.organizationId, q1.id);
    const q2 = await digital(e);
    assert.equal(q2.displayNumber, 2);
  } finally {
    await desmontar(e);
  }
});

test("display_number: carrera real — el segundo create se bloquea en el lock de la organización y recibe el número siguiente", async () => {
  const e = await montar("num-carrera");
  try {
    // A toma el MISMO lock que toma crearConDisplayNumber y aplica el efecto de
    // un create rival (incrementa el contador), sin commitear.
    const a = await sostenerTransaccion(async (tx) => {
      await lockOrganizationForUpdate(e.organizationId, tx);
      await tx.organization.update({
        where: { id: e.organizationId },
        data: { nextQrDisplayNumber: { increment: 1 } },
      });
    });

    const b = digital(e);
    await esperarBloqueadoPor(a, b, "createDigitalQrCode");
    a.liberar();
    await a.terminada;

    const creado = await b;
    assert.equal(
      creado.displayNumber,
      2,
      "B leyó el contador DESPUÉS de que A commiteara, no antes",
    );

    const org = await prisma.organization.findUnique({ where: { id: e.organizationId } });
    assert.equal(org?.nextQrDisplayNumber, 3);
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// Listar / editar / borrar
// ---------------------------------------------------------------------------

test("listar: solo los QRs de la organización, sin los borrados, con filtro por sucursal", async () => {
  const a = await montar("list-a");
  const b = await montar("list-b");
  try {
    const norte = await createBranch(a.organizationId, { name: "Norte", timezone: TZ });
    const q1 = await digital(a);
    const q2 = await digital(a, { branchId: norte.id });
    const borrado = await digital(a);
    await deleteQrCode(a.organizationId, borrado.id);
    await digital(b);

    const todos = await listQrCodes(a.organizationId, {
      page: 1,
      pageSize: 20,
      sortBy: "displayNumber",
      sortOrder: "asc",
    });
    assert.deepEqual(
      todos.data.map((q) => q.id),
      [q1.id, q2.id],
    );
    assert.equal(todos.pagination.total, 2);

    const soloNorte = await listQrCodes(a.organizationId, {
      page: 1,
      pageSize: 20,
      branchId: norte.id,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    assert.deepEqual(
      soloNorte.data.map((q) => q.id),
      [q2.id],
    );
  } finally {
    await desmontar(a, b);
  }
});

test("editar: cambia name/destinationUrl/message, message se puede vaciar, qrType no se toca", async () => {
  const e = await montar("update");
  try {
    const qr = await digital(e, { message: "hola", qrType: "SINGLE_USE" });

    const editado = await updateQrCode(e.organizationId, qr.id, {
      name: "Caja",
      destinationUrl: "https://instagram.com/x",
    });
    assert.equal(editado.name, "Caja");
    assert.equal(editado.destinationUrl, "https://instagram.com/x");
    assert.equal(editado.message, "hola", "un campo no enviado no cambia");
    assert.equal(editado.qrType, "SINGLE_USE");

    const sinMensaje = await updateQrCode(e.organizationId, qr.id, { message: null });
    assert.equal(sinMensaje.message, null);
  } finally {
    await desmontar(e);
  }
});

test("editar/borrar: ajeno, inexistente y ya borrado -> el MISMO 404 (anti-enumeración)", async () => {
  const a = await montar("enum-a");
  const b = await montar("enum-b");
  try {
    const deB = await digital(b);
    const borradoDeA = await digital(a);
    await deleteQrCode(a.organizationId, borradoDeA.id);

    for (const id of [deB.id, randomUUID(), borradoDeA.id]) {
      const patch = await capturar(() => updateQrCode(a.organizationId, id, { name: "x" }));
      assertAppError(patch, 404, "QR no encontrado");
      const del = await capturar(() => deleteQrCode(a.organizationId, id));
      assertAppError(del, 404, "QR no encontrado");
    }

    // El de B sigue intacto: A no lo tocó.
    const filaB = await prisma.qrCode.findUnique({ where: { id: deB.id } });
    assert.equal(filaB?.name, "Mostrador");
    assert.equal(filaB?.deletedAt, null);
  } finally {
    await desmontar(a, b);
  }
});

test("borrar: soft delete — deletedAt se setea y name/destinationUrl/message/displayNumber se conservan", async () => {
  const e = await montar("delete");
  try {
    const qr = await digital(e, { message: "m" });
    await deleteQrCode(e.organizationId, qr.id);

    const fila = await prisma.qrCode.findUnique({ where: { id: qr.id } });
    assert.notEqual(fila?.deletedAt, null);
    assert.equal(fila?.name, "Mostrador");
    assert.equal(fila?.destinationUrl, DESTINO);
    assert.equal(fila?.message, "m");
    assert.equal(fila?.displayNumber, 1);
  } finally {
    await desmontar(e);
  }
});
