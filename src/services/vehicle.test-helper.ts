import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { desmontar as desmontarEscenario, type Escenario } from "./escenario.test-helper";
import { createVehicle, type CreateVehicleInput } from "./vehicle.service";

// ---------------------------------------------------------------------------
// Escenarios del módulo de stock de vehículos para los tests de integración.
// SOLO PARA TESTS: el nombre *.test-helper.ts lo deja fuera del build, igual
// que lib/carreras.test-helper.ts.
//
// La organización con su sucursal y su ADMIN es la de escenario.test-helper.ts
// (genérica, docs/ordenamiento-productos.md P3): se reexporta acá para que los
// tests del stock importen todo de un solo lugar. Lo propio de este helper son
// las unidades, las fotos y un `desmontar` que borra primero las tablas del
// stock, en el orden que las FK RESTRICT exigen (las fotos antes que las
// unidades), y después lo genérico.
// ---------------------------------------------------------------------------

export { assertAppError, capturar, montar, type Escenario } from "./escenario.test-helper";

export async function desmontar(...escenarios: Escenario[]) {
  for (const e of escenarios) {
    await prisma.vehiclePhoto.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.vehicleChangeLog.deleteMany({ where: { organizationId: e.organizationId } });
    await prisma.vehicle.deleteMany({ where: { organizationId: e.organizationId } });
    await desmontarEscenario(e);
  }
}

export function borrador(e: Escenario, extra: Partial<CreateVehicleInput> = {}) {
  return createVehicle(e.organizationId, {
    condition: "USED",
    make: "Toyota",
    model: "Corolla",
    year: 2022,
    branchId: e.branchId,
    ...extra,
  });
}

// Una ficha que cumple los diez campos siempre exigidos más los tres de usado.
// Le falta solo la foto para poder publicarse.
export const completoUsado: Partial<CreateVehicleInput> = {
  bodyType: "SEDAN",
  priceListUsd: 25_000,
  priceListLocal: 30_000_000,
  transmission: "CVT",
  fuelType: "GASOLINE",
  exteriorColor: "Blanco",
  vin: "9BR53ZEC2P0000001",
  licensePlate: "AB123CD",
  mileage: 45_000,
  titleHolder: "Juan Pérez",
};

// Una fila de VehiclePhoto SIN objeto en Storage, para los tests que solo
// necesitan que la unidad "tenga una foto" (la regla de completitud) y no
// hablan con Storage. Los que sí lo hacen usan uploadVehiclePhoto.
export function fotoSinStorage(e: Escenario, vehicleId: string, position = 0, isCover = true) {
  return prisma.vehiclePhoto.create({
    data: {
      organizationId: e.organizationId,
      vehicleId,
      storagePath: `${e.organizationId}/${vehicleId}/${randomUUID()}.jpg`,
      position,
      isCover,
    },
  });
}
