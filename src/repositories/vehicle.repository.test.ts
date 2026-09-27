import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../lib/prisma";
import { aCodigoDeEquipamiento, countVehiclesInStockByBranch } from "./vehicle.repository";

// La búsqueda de texto de search_vehicles (ítem 86) lleva el texto al formato
// de los códigos de equipamiento para buscarlo con `has`. Tiene que dar el
// mismo código que arma la pantalla del vehículo al cargar el chip
// (finalizeEquipmentCode, frontend/src/features/vehicle/equipment.ts), o un
// "techo solar" nunca encontraría TECHO_SOLAR.

test("aCodigoDeEquipamiento: sin acentos, mayúsculas, separadores a _", () => {
  assert.equal(aCodigoDeEquipamiento("techo solar"), "TECHO_SOLAR");
  assert.equal(aCodigoDeEquipamiento("Cámara de retroceso"), "CAMARA_DE_RETROCESO");
  assert.equal(aCodigoDeEquipamiento("  aire-acondicionado  "), "AIRE_ACONDICIONADO");
  assert.equal(aCodigoDeEquipamiento("ABS!"), "ABS");
});

test("aCodigoDeEquipamiento: un texto sin nada rescatable queda vacío", () => {
  assert.equal(aCodigoDeEquipamiento("¿?"), "");
});

// El conteo del RESTRICT de deleteBranch (ítem 167): lo que llega a Prisma,
// con un `db` falso que captura el WHERE.
test("countVehiclesInStockByBranch: sucursal + organización, sin borrados, sin SOLD ni DELIVERED", async () => {
  let where: unknown;
  const db = {
    vehicle: {
      count: async (args: { where: unknown }) => {
        where = args.where;
        return 3;
      },
    },
  } as unknown as Db;

  assert.equal(await countVehiclesInStockByBranch("branch-1", "org-a", db), 3);
  assert.deepEqual(where, {
    branchId: "branch-1",
    organizationId: "org-a",
    deletedAt: null,
    status: { notIn: ["SOLD", "DELIVERED"] },
  });
});
