import { Prisma } from "@prisma/client";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { esperarBloqueadoPor, sostenerTransaccion } from "../lib/carreras.test-helper";
import { prisma } from "../lib/prisma";
import { lockBranchForUpdate } from "../repositories/branch.repository";
import { AppError } from "../utils/AppError";
import { createBranch, deleteBranch } from "./branch.service";
import {
  createDigitalQrCode,
  deleteQrCode,
  getNextQrDisplayNumber,
  listQrCodes,
  updateQrCode,
} from "./qr.service";

// ---------------------------------------------------------------------------
// digital / listar / editar / borrar contra Postgres real
// (docs/qr-integration.md, Fase 2 — "Verificación"). Lo que no se puede probar
// sin base: el aislamiento entre organizaciones, la serie de display_number por
// sucursal bajo concurrencia real, el índice único que la sostiene, y la
// anti-enumeración de PATCH/DELETE.
//
// CADA TEST TRAE SU PROPIA ORGANIZACIÓN, igual que booking-config.
//
// HASTA 20260904120000_remove_qr_claim_and_single_use este archivo también
// probaba claimQrCode (el claim de un QR físico) y qrType — se eliminaron
// junto con esas funcionalidades. Ver docs/qr-integration.md, sección "Qué se
// desvió".
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
    ...extra,
  });
}

test("digital: no se puede asociar a una Branch ajena o inexistente — mismo 400 que resource.service, sin confirmar que exista", async () => {
  const a = await montar("branch-a");
  const b = await montar("branch-b");
  try {
    const ajena = await capturar(() => digital(a, { branchId: b.branchId }));
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
// display_number — serie POR SUCURSAL que reusa los números liberados
// (§54 de docs/frontend-cambios-pendientes.md; antes DEC-064/066, un contador
// durable por organización que solo subía).
// ---------------------------------------------------------------------------

test("display_number: la serie es por SUCURSAL — dos sucursales de la misma organización arrancan las dos en 1", async () => {
  const e = await montar("num-sucursal");
  try {
    const norte = await createBranch(e.organizationId, { name: "Norte", timezone: TZ });

    const centro1 = await digital(e);
    const norte1 = await digital(e, { branchId: norte.id });
    const centro2 = await digital(e);
    const norte2 = await digital(e, { branchId: norte.id });

    assert.deepEqual([centro1.displayNumber, centro2.displayNumber], [1, 2]);
    assert.deepEqual(
      [norte1.displayNumber, norte2.displayNumber],
      [1, 2],
      "cada sucursal lleva su propia serie: dos sucursales pueden tener su QR 1 a la vez",
    );
  } finally {
    await desmontar(e);
  }
});

test("display_number: es por sucursal, no global — dos organizaciones no se pisan", async () => {
  const a = await montar("num-a");
  const b = await montar("num-b");
  try {
    const a1 = await digital(a);
    const b1 = await digital(b);
    const a2 = await digital(a);

    assert.deepEqual([a1.displayNumber, a2.displayNumber], [1, 2]);
    assert.equal(b1.displayNumber, 1);
  } finally {
    await desmontar(a, b);
  }
});

test("display_number: una creación que falla por sucursal ajena NO quema el número", async () => {
  const e = await montar("num-rollback");
  try {
    const primero = await digital(e);
    assert.equal(primero.displayNumber, 1);

    await capturar(() => digital(e, { branchId: randomUUID() }));

    const segundo = await digital(e);
    assert.equal(segundo.displayNumber, 2, "el intento fallido no adelantó la serie");
  } finally {
    await desmontar(e);
  }
});

// EL CASO QUE MOTIVÓ EL §54, con los números exactos del pedido de Rocco. Los
// casos más chicos de arriba lo cubren de a pedazos; éste está escrito
// entero y explícito porque es LA razón del ítem: hasta la migración
// 20260921120000 el contador por organización habría contestado 11 acá.
test("display_number: 10 QRs, se borran 9 y queda el N° 1 — el siguiente es 2, no 11", async () => {
  const e = await montar("num-rocco");
  try {
    const diez = [];
    for (let i = 0; i < 10; i++) {
      diez.push(await digital(e, { name: `QR ${String(i + 1)}` }));
    }
    assert.deepEqual(
      diez.map((q) => q.displayNumber),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );

    for (const qr of diez.slice(1)) {
      await deleteQrCode(e.organizationId, qr.id);
    }

    const sugerido = await getNextQrDisplayNumber(e.organizationId, e.branchId);
    assert.equal(sugerido.suggestedDisplayNumber, 2, "el viejo contador habría sugerido 11");

    const siguiente = await digital(e);
    assert.equal(siguiente.displayNumber, 2, "y el QR creado se lleva ese mismo número");
  } finally {
    await desmontar(e);
  }
});

test("display_number: borrar el ÚLTIMO libera su número — el próximo lo reusa", async () => {
  const e = await montar("num-borrado");
  try {
    const q1 = await digital(e);
    const q2 = await digital(e);
    assert.equal(q2.displayNumber, 2);

    await deleteQrCode(e.organizationId, q2.id);

    const q3 = await digital(e);
    assert.equal(q3.displayNumber, 2, "el 2 volvió a estar libre");

    // El QR borrado conserva su número en la fila (no se limpia), pero ya no
    // lo ocupa: el índice único es parcial.
    const borrado = await prisma.qrCode.findUniqueOrThrow({ where: { id: q2.id } });
    assert.equal(borrado.displayNumber, 2);
    assert.equal(q1.displayNumber, 1);
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// N° escrito a mano (§54, segunda decisión de Rocco)
// ---------------------------------------------------------------------------

test("display_number a mano: se usa tal cual, y el sugerido siguiente sale del máximo activo", async () => {
  const e = await montar("num-manual");
  try {
    const qr = await digital(e, { displayNumber: 47 });
    assert.equal(qr.displayNumber, 47);

    const sugerido = await getNextQrDisplayNumber(e.organizationId, e.branchId);
    assert.equal(sugerido.suggestedDisplayNumber, 48);
  } finally {
    await desmontar(e);
  }
});

test("display_number a mano: repetir el de un QR ACTIVO de la misma sucursal -> 409, y no se crea nada", async () => {
  const e = await montar("num-choque");
  try {
    await digital(e, { displayNumber: 5 });

    const err = await capturar(() => digital(e, { displayNumber: 5 }));
    assertAppError(err, 409, "Ya existe un QR activo con ese número en esta sucursal");

    assert.equal(
      await prisma.qrCode.count({ where: { organizationId: e.organizationId } }),
      1,
      "el rechazo no dejó ninguna fila a medio crear",
    );
  } finally {
    await desmontar(e);
  }
});

test("display_number a mano: el mismo número SÍ se puede repetir en otra sucursal, y reusar el de un QR borrado", async () => {
  const e = await montar("num-permitido");
  try {
    const norte = await createBranch(e.organizationId, { name: "Norte", timezone: TZ });

    const centro = await digital(e, { displayNumber: 7 });
    const enNorte = await digital(e, { branchId: norte.id, displayNumber: 7 });
    assert.equal(enNorte.displayNumber, 7, "la unicidad es por sucursal, no por organización");

    await deleteQrCode(e.organizationId, centro.id);
    const reusado = await digital(e, { displayNumber: 7 });
    assert.equal(reusado.displayNumber, 7, "el número de un QR borrado vuelve al pool");
  } finally {
    await desmontar(e);
  }
});

test("display_number a mano: también se corrige al editar, y chocar con un activo de la misma sucursal -> 409", async () => {
  const e = await montar("num-patch");
  try {
    const q1 = await digital(e);
    const q2 = await digital(e);

    const editado = await updateQrCode(e.organizationId, q2.id, { displayNumber: 30 });
    assert.equal(editado.displayNumber, 30);
    assert.equal(editado.name, "Mostrador", "el PATCH parcial no tocó lo demás");

    const err = await capturar(() => updateQrCode(e.organizationId, q1.id, { displayNumber: 30 }));
    assertAppError(err, 409, "Ya existe un QR activo con ese número en esta sucursal");

    const intacto = await prisma.qrCode.findUniqueOrThrow({ where: { id: q1.id } });
    assert.equal(intacto.displayNumber, 1, "el rechazo dejó el número anterior");
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// El sugerido (GET /api/qr/next-display-number)
// ---------------------------------------------------------------------------

test("sugerido: 1 en una sucursal sin QRs, y el mismo 400 anti-enumeración que el alta para una sucursal ajena", async () => {
  const a = await montar("sug-a");
  const b = await montar("sug-b");
  try {
    const vacio = await getNextQrDisplayNumber(a.organizationId, a.branchId);
    assert.deepEqual(vacio, { branchId: a.branchId, suggestedDisplayNumber: 1 });

    const ajena = await capturar(() => getNextQrDisplayNumber(a.organizationId, b.branchId));
    assertAppError(ajena, 400, "La sucursal indicada no existe o no pertenece a tu organización");

    const inexistente = await capturar(() =>
      getNextQrDisplayNumber(a.organizationId, randomUUID()),
    );
    assertAppError(
      inexistente,
      400,
      "La sucursal indicada no existe o no pertenece a tu organización",
    );
  } finally {
    await desmontar(a, b);
  }
});

// ---------------------------------------------------------------------------
// Concurrencia — el lock pasó de organización a SUCURSAL (§54)
// ---------------------------------------------------------------------------

test("display_number: carrera real — el segundo create se bloquea en el lock de la SUCURSAL y recibe el número siguiente", async () => {
  const e = await montar("num-carrera");
  try {
    // A toma el MISMO lock que toma crearConDisplayNumber y aplica el efecto
    // de un create rival (inserta el QR 1 de esa sucursal), sin commitear.
    const a = await sostenerTransaccion(async (tx) => {
      await lockBranchForUpdate(e.branchId, e.organizationId, tx);
      await tx.qrCode.create({
        data: {
          organizationId: e.organizationId,
          branchId: e.branchId,
          displayNumber: 1,
          name: "Rival",
          destinationUrl: DESTINO,
          message: null,
        },
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
      "B leyó el máximo DESPUÉS de que A commiteara, no antes — si no, los dos serían 1",
    );
  } finally {
    await desmontar(e);
  }
});

// LA CONTRACARA DEL TEST DE ARRIBA, y la razón de que el lock sea de sucursal
// y no de organización: dos altas en sucursales distintas del mismo tenant no
// compiten por nada, así que no tienen por qué esperarse. Con
// lockOrganizationForUpdate —lo que había antes del §54— este create quedaría
// esperando a que A commitee.
test("display_number: un create en OTRA sucursal del mismo tenant no espera al lock de la primera", async () => {
  const e = await montar("num-sin-espera");
  try {
    const norte = await createBranch(e.organizationId, { name: "Norte", timezone: TZ });

    const a = await sostenerTransaccion(async (tx) => {
      await lockBranchForUpdate(e.branchId, e.organizationId, tx);
    });

    let avisarPlazo: (valor: string) => void = () => undefined;
    const plazo = new Promise<string>((resolve) => {
      avisarPlazo = resolve;
    });
    const temporizador = setTimeout(() => {
      avisarPlazo("bloqueado");
    }, 5_000);

    try {
      const enNorte = digital(e, { branchId: norte.id });
      const resultado = await Promise.race([enNorte.then(() => "creado"), plazo]);
      assert.equal(
        resultado,
        "creado",
        "el create de otra sucursal no debería esperar al lock de la primera",
      );
      assert.equal((await enNorte).displayNumber, 1);
    } finally {
      clearTimeout(temporizador);
      a.liberar();
      await a.terminada;
    }
  } finally {
    await desmontar(e);
  }
});

// El índice único NO es decoración: es la barrera que queda cuando el lock no
// alcanza —el número escrito a mano no pasa por ninguna lectura que
// serializar—. Acá se lo viola desde Prisma crudo, sin pasar por el service,
// para afirmar que la constraint existe en la base con el predicado correcto.
test("display_number: el índice único parcial rechaza dos activos con el mismo número, y acepta uno borrado con ese número", async () => {
  const e = await montar("num-indice");
  try {
    const qr = await digital(e, { displayNumber: 3 });

    const fila = {
      organizationId: e.organizationId,
      branchId: e.branchId,
      displayNumber: 3,
      name: "Crudo",
      destinationUrl: DESTINO,
      message: null,
    };

    await assert.rejects(
      () => prisma.qrCode.create({ data: fila }),
      (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
      "Postgres tiene que rechazar el segundo activo con el mismo número",
    );

    // Con el primero borrado, el predicado del índice deja de contarlo.
    await deleteQrCode(e.organizationId, qr.id);
    const segundo = await prisma.qrCode.create({ data: fila });
    assert.equal(segundo.displayNumber, 3);
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

test("editar: cambia name/destinationUrl/message, message se puede vaciar", async () => {
  const e = await montar("update");
  try {
    const qr = await digital(e, { message: "hola" });

    const editado = await updateQrCode(e.organizationId, qr.id, {
      name: "Caja",
      destinationUrl: "https://instagram.com/x",
    });
    assert.equal(editado.name, "Caja");
    assert.equal(editado.destinationUrl, "https://instagram.com/x");
    assert.equal(editado.message, "hola", "un campo no enviado no cambia");

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

// ---------------------------------------------------------------------------
// RESTRICT nuevo de deleteBranch — QRs huérfanos
//
// Un QrCode no cambia de sucursal (updateQrCode no acepta branchId), así que
// sin este chequeo el soft delete de la sucursal deja un QR activo apuntando
// a un branchId que findBranchById ya no resuelve — el mismo tipo de
// inconsistencia que ALTO-8 cerró para recursos/servicios y que P2.1 paso 2
// cerró para Google Calendar. Mismo criterio: BLOQUEAR, no cascadear.
// ---------------------------------------------------------------------------

test("no se puede borrar una sucursal con QRs activos, y la sucursal sigue viva", async () => {
  const e = await montar("branch-restrict");
  try {
    const qr = await digital(e);

    const err = await capturar(() => deleteBranch(e.organizationId, e.branchId));
    assertAppError(
      err,
      400,
      "No se puede eliminar una sucursal que tiene QRs activos. Eliminá primero sus QRs.",
    );

    const persistida = await prisma.branch.findUniqueOrThrow({ where: { id: e.branchId } });
    assert.equal(persistida.deletedAt, null, "la sucursal no debe quedar borrada tras el rechazo");

    const filaQr = await prisma.qrCode.findUniqueOrThrow({ where: { id: qr.id } });
    assert.equal(filaQr.deletedAt, null);
  } finally {
    await desmontar(e);
  }
});

test("deleteBranch procede cuando el único QR de la sucursal ya está borrado — el bloqueo mira deletedAt, no la existencia", async () => {
  const e = await montar("branch-permite");
  try {
    const qr = await digital(e);
    await deleteQrCode(e.organizationId, qr.id);

    await deleteBranch(e.organizationId, e.branchId);

    const persistida = await prisma.branch.findUniqueOrThrow({ where: { id: e.branchId } });
    assert.notEqual(persistida.deletedAt, null, "la sucursal debía poder borrarse");
  } finally {
    await desmontar(e);
  }
});
