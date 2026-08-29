import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { createBranch, deleteBranch, updateBranch } from "./branch.service";
import { createResource, deleteResource } from "./resource.service";
import { createServiceType, deleteServiceType, updateServiceType } from "./serviceType.service";

// P2.1, primer tramo — Branch / Resource / ServiceType contra Postgres real.
//
// Lo que se prueba acá y no se puede probar sin base: los tres RESTRICT de
// borrado y sus carreras, y la validación cruzada sucursal↔recurso, que es la
// que el documento de diseño no menciona y sin la cual un servicio "de la
// sucursal A" puede terminar usando un recurso de la B.
//
// La validación de zona horaria vive en src/utils/timezone.test.ts: es pura y no
// necesita base.
//
// CADA TEST TRAE SU PROPIA ORGANIZACIÓN. El runner corre los archivos de
// integración en paralelo contra una base compartida; sin aislar por
// organización, dos archivos se pisarían los conteos.

const TZ = "America/Argentina/Buenos_Aires";

interface Escenario {
  organizationId: string;
}

async function montar(etiqueta: string): Promise<Escenario> {
  const org = await prisma.organization.create({
    data: {
      name: `Booking ${etiqueta} ${randomUUID()}`,
      slug: `booking-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  return { organizationId: org.id };
}

async function desmontar(escenario: Escenario) {
  await prisma.serviceType.deleteMany({ where: { organizationId: escenario.organizationId } });
  await prisma.resource.deleteMany({ where: { organizationId: escenario.organizationId } });
  await prisma.branch.deleteMany({ where: { organizationId: escenario.organizationId } });
  await prisma.organization.delete({ where: { id: escenario.organizationId } });
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

// ---------------------------------------------------------------------------
// Camino feliz y forma de los datos
// ---------------------------------------------------------------------------

test("se puede armar la configuración completa: sucursal -> recurso -> servicio", async () => {
  const escenario = await montar("feliz");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    assert.equal(branch.timezone, TZ);

    const resource = await createResource(escenario.organizationId, {
      branchId: branch.id,
      name: "Juan (barbero)",
      type: "PERSON",
    });
    assert.equal(resource.branchId, branch.id);

    const servicio = await createServiceType(escenario.organizationId, {
      branchId: branch.id,
      resourceId: resource.id,
      name: "Corte de pelo",
      durationMin: 30,
    });

    assert.equal(servicio.durationMin, 30);
    assert.equal(servicio.capacity, 1, "capacity default = 1 (turno exclusivo)");
    assert.equal(servicio.resourceId, resource.id);
  } finally {
    await desmontar(escenario);
  }
});

test("una organización sin Booking tiene CERO sucursales, y eso es válido", async () => {
  // No hay invariante de "al menos una sucursal activa", a diferencia de
  // Pipeline: el onboarding no crea ninguna y nada del CRM depende de que exista.
  const escenario = await montar("sin-sucursal");
  try {
    const cuantas = await prisma.branch.count({
      where: { organizationId: escenario.organizationId },
    });
    assert.equal(cuantas, 0);
  } finally {
    await desmontar(escenario);
  }
});

test("se puede borrar la ÚNICA sucursal de una organización — no hay mínimo que proteger", async () => {
  const escenario = await montar("ultima");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Única", timezone: TZ });
    await deleteBranch(escenario.organizationId, branch.id);

    const persistida = await prisma.branch.findUnique({ where: { id: branch.id } });
    assert.notEqual(persistida?.deletedAt, null);
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// La validación cruzada sucursal ↔ recurso
// ---------------------------------------------------------------------------

test("un ServiceType NO puede usar un recurso de otra sucursal", async () => {
  // El invariante que el documento de diseño no menciona. La FK compuesta
  // garantiza la ORGANIZACIÓN, no la sucursal — sin esta validación, un servicio
  // "de la sucursal A" usando un recurso de la B se guarda sin protestar y el
  // error aparece recién al intentar reservar.
  const escenario = await montar("cruzada");
  try {
    const centro = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    const norte = await createBranch(escenario.organizationId, { name: "Norte", timezone: TZ });

    const recursoDeNorte = await createResource(escenario.organizationId, {
      branchId: norte.id,
      name: "Sala 2",
      type: "ROOM",
    });

    const err = await capturar(() =>
      createServiceType(escenario.organizationId, {
        branchId: centro.id,
        resourceId: recursoDeNorte.id,
        name: "Masaje",
        durationMin: 60,
      }),
    );

    assertAppError(err, 400, "El recurso indicado no pertenece a la sucursal especificada");

    const cuantos = await prisma.serviceType.count({
      where: { organizationId: escenario.organizationId },
    });
    assert.equal(cuantos, 0, "no debe haber quedado ningún servicio");
  } finally {
    await desmontar(escenario);
  }
});

test("updateServiceType: cambiar de sucursal sin cambiar el recurso es 400, no una inconsistencia silenciosa", async () => {
  // Misma regla y misma forma que updateOpportunity con pipelineId/stageId.
  const escenario = await montar("update-cruzada");
  try {
    const centro = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    const norte = await createBranch(escenario.organizationId, { name: "Norte", timezone: TZ });
    const recurso = await createResource(escenario.organizationId, {
      branchId: centro.id,
      name: "Juan",
      type: "PERSON",
    });
    const servicio = await createServiceType(escenario.organizationId, {
      branchId: centro.id,
      resourceId: recurso.id,
      name: "Corte",
      durationMin: 30,
    });

    const err = await capturar(() =>
      updateServiceType(escenario.organizationId, servicio.id, { branchId: norte.id }),
    );

    assertAppError(
      err,
      400,
      "Si cambiás la sucursal, indicá también el nuevo resourceId en la misma operación",
    );

    const persistido = await prisma.serviceType.findUniqueOrThrow({ where: { id: servicio.id } });
    assert.equal(persistido.branchId, centro.id, "no debe haber cambiado de sucursal");
  } finally {
    await desmontar(escenario);
  }
});

test("updateServiceType: mover sucursal Y recurso juntos, a un recurso de la sucursal nueva, funciona", async () => {
  const escenario = await montar("update-mueve");
  try {
    const centro = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    const norte = await createBranch(escenario.organizationId, { name: "Norte", timezone: TZ });
    const enCentro = await createResource(escenario.organizationId, {
      branchId: centro.id,
      name: "Juan",
      type: "PERSON",
    });
    const enNorte = await createResource(escenario.organizationId, {
      branchId: norte.id,
      name: "Pedro",
      type: "PERSON",
    });
    const servicio = await createServiceType(escenario.organizationId, {
      branchId: centro.id,
      resourceId: enCentro.id,
      name: "Corte",
      durationMin: 30,
    });

    const actualizado = await updateServiceType(escenario.organizationId, servicio.id, {
      branchId: norte.id,
      resourceId: enNorte.id,
    });

    assert.equal(actualizado.branchId, norte.id);
    assert.equal(actualizado.resourceId, enNorte.id);
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// Los RESTRICT de borrado
// ---------------------------------------------------------------------------

test("deleteBranch rechaza con 400 si la sucursal tiene recursos activos, y la sucursal sigue viva", async () => {
  const escenario = await montar("branch-restrict");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    await createResource(escenario.organizationId, {
      branchId: branch.id,
      name: "Juan",
      type: "PERSON",
    });

    const err = await capturar(() => deleteBranch(escenario.organizationId, branch.id));

    assertAppError(
      err,
      400,
      "No se puede eliminar una sucursal que tiene recursos activos. Eliminá primero sus recursos.",
    );

    const persistida = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });
    assert.equal(persistida.deletedAt, null, "el rechazo no debe dejar el borrado a medias");
  } finally {
    await desmontar(escenario);
  }
});

test("deleteResource rechaza con 400 si el recurso tiene servicios activos", async () => {
  const escenario = await montar("resource-restrict");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    const recurso = await createResource(escenario.organizationId, {
      branchId: branch.id,
      name: "Juan",
      type: "PERSON",
    });
    await createServiceType(escenario.organizationId, {
      branchId: branch.id,
      resourceId: recurso.id,
      name: "Corte",
      durationMin: 30,
    });

    const err = await capturar(() => deleteResource(escenario.organizationId, recurso.id));

    assertAppError(
      err,
      400,
      "No se puede eliminar un recurso que tiene servicios activos. Eliminá primero sus servicios.",
    );

    const persistido = await prisma.resource.findUniqueOrThrow({ where: { id: recurso.id } });
    assert.equal(persistido.deletedAt, null);
  } finally {
    await desmontar(escenario);
  }
});

test("el borrado en orden funciona: servicio, recurso, sucursal", async () => {
  // El RESTRICT no es un callejón sin salida: obliga a limpiar de abajo hacia
  // arriba, que es el orden correcto.
  const escenario = await montar("orden");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    const recurso = await createResource(escenario.organizationId, {
      branchId: branch.id,
      name: "Juan",
      type: "PERSON",
    });
    const servicio = await createServiceType(escenario.organizationId, {
      branchId: branch.id,
      resourceId: recurso.id,
      name: "Corte",
      durationMin: 30,
    });

    await deleteServiceType(escenario.organizationId, servicio.id);
    await deleteResource(escenario.organizationId, recurso.id);
    await deleteBranch(escenario.organizationId, branch.id);

    const viva = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });
    assert.notEqual(viva.deletedAt, null);
  } finally {
    await desmontar(escenario);
  }
});

test("un hijo YA BORRADO no bloquea: el RESTRICT mira deletedAt, no la existencia", async () => {
  const escenario = await montar("borrado-no-bloquea");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    const recurso = await createResource(escenario.organizationId, {
      branchId: branch.id,
      name: "Juan",
      type: "PERSON",
    });
    await deleteResource(escenario.organizationId, recurso.id);

    await deleteBranch(escenario.organizationId, branch.id);

    const persistida = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });
    assert.notEqual(persistida.deletedAt, null);
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// Las carreras — la mitad que el chequeo solo no cubre
// ---------------------------------------------------------------------------

test("createResource vs deleteBranch: nunca queda un recurso activo en una sucursal borrada", async () => {
  // Sin el lock de fila de la sucursal, los dos pasan su chequeo y el recurso
  // queda colgando. Es la lección de ALTO-8: un RESTRICT decide sobre un conteo,
  // y un conteo sin punto de serialización no decide nada.
  const escenario = await montar("carrera-branch");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });

    await Promise.allSettled([
      createResource(escenario.organizationId, {
        branchId: branch.id,
        name: "Juan",
        type: "PERSON",
      }),
      deleteBranch(escenario.organizationId, branch.id),
    ]);

    // La aserción es sobre el ESTADO, no sobre quién ganó: los dos
    // interleavings son legítimos y ninguno puede dejar un huérfano.
    const huerfanos = await prisma.resource.count({
      where: {
        organizationId: escenario.organizationId,
        deletedAt: null,
        branch: { deletedAt: { not: null } },
      },
    });
    assert.equal(huerfanos, 0, "quedó un recurso activo en una sucursal borrada");
  } finally {
    await desmontar(escenario);
  }
});

test("createServiceType vs deleteResource: nunca queda un servicio activo en un recurso borrado", async () => {
  const escenario = await montar("carrera-resource");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    const recurso = await createResource(escenario.organizationId, {
      branchId: branch.id,
      name: "Juan",
      type: "PERSON",
    });

    await Promise.allSettled([
      createServiceType(escenario.organizationId, {
        branchId: branch.id,
        resourceId: recurso.id,
        name: "Corte",
        durationMin: 30,
      }),
      deleteResource(escenario.organizationId, recurso.id),
    ]);

    const huerfanos = await prisma.serviceType.count({
      where: {
        organizationId: escenario.organizationId,
        deletedAt: null,
        resource: { deletedAt: { not: null } },
      },
    });
    assert.equal(huerfanos, 0, "quedó un servicio activo en un recurso borrado");
  } finally {
    await desmontar(escenario);
  }
});

// ---------------------------------------------------------------------------
// Aislamiento y defensas de la base
// ---------------------------------------------------------------------------

test("una organización no ve ni puede usar los recursos de otra", async () => {
  const a = await montar("iso-a");
  const b = await montar("iso-b");
  try {
    const branchA = await createBranch(a.organizationId, { name: "A", timezone: TZ });
    const recursoA = await createResource(a.organizationId, {
      branchId: branchA.id,
      name: "Juan",
      type: "PERSON",
    });
    const branchB = await createBranch(b.organizationId, { name: "B", timezone: TZ });

    // B intenta armar un servicio con el recurso de A.
    const err = await capturar(() =>
      createServiceType(b.organizationId, {
        branchId: branchB.id,
        resourceId: recursoA.id,
        name: "Robo",
        durationMin: 30,
      }),
    );

    assertAppError(err, 400, "El recurso indicado no existe o no pertenece a tu organización");
  } finally {
    await desmontar(a);
    await desmontar(b);
  }
});

test("los CHECK de la base rechazan duración 0 y capacidad 0 aunque Zod no esté en el camino", async () => {
  // Zod ya los valida en el borde HTTP. Estos CHECK son la defensa que sobrevive
  // a un camino de escritura que no pase por el controller — un script, un seed,
  // un worker futuro. Se los ejercita escribiendo con Prisma directo, que es
  // exactamente ese caso.
  const escenario = await montar("checks");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    const recurso = await createResource(escenario.organizationId, {
      branchId: branch.id,
      name: "Juan",
      type: "PERSON",
    });

    const base = {
      organizationId: escenario.organizationId,
      branchId: branch.id,
      resourceId: recurso.id,
      name: "Inválido",
    };

    await assert.rejects(
      prisma.serviceType.create({ data: { ...base, durationMin: 0 } }),
      /service_types_duration_positive_check/,
    );

    await assert.rejects(
      prisma.serviceType.create({ data: { ...base, durationMin: 30, capacity: 0 } }),
      /service_types_capacity_positive_check/,
    );
  } finally {
    await desmontar(escenario);
  }
});

test("updateBranch cambia la zona horaria y la persiste", async () => {
  const escenario = await montar("update-tz");
  try {
    const branch = await createBranch(escenario.organizationId, { name: "Centro", timezone: TZ });
    const actualizada = await updateBranch(escenario.organizationId, branch.id, {
      timezone: "America/Montevideo",
    });
    assert.equal(actualizada.timezone, "America/Montevideo");
  } finally {
    await desmontar(escenario);
  }
});
