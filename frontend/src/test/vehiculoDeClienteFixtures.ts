import type { FichaDeVehiculo, VehiculoDeCliente } from "../features/servicios/types";

// Un vehículo de cliente del taller (docs/servicios.md §2.2), con datos de
// ejemplo inventados.
export function makeVehiculoDeCliente(
  overrides: Partial<VehiculoDeCliente> = {},
): VehiculoDeCliente {
  return {
    id: "cv1",
    contactId: "ct1",
    branchId: null,
    make: "Toyota",
    model: "Hilux",
    year: 2020,
    licensePlate: "SBC 1001",
    vin: null,
    mileage: 45000,
    purchasedOn: null,
    nextServiceDueOn: "2027-01-10",
    nextServiceSetFromOrderId: null,
    remindersOptOut: false,
    sourceVehicleId: null,
    sourceOpportunityId: null,
    ownershipEndedAt: null,
    ownershipEndReason: null,
    notes: null,
    createdAt: "2026-10-14T12:00:00.000Z",
    updatedAt: "2026-10-14T12:00:00.000Z",
    contact: { id: "ct1", firstName: "Ana", lastName: "Ejemplo" },
    branch: null,
    ordenAbierta: null,
    ...overrides,
  };
}

export function makeFichaDeVehiculo(overrides: Partial<FichaDeVehiculo> = {}): FichaDeVehiculo {
  return { ...makeVehiculoDeCliente(overrides), cambiosDeDueno: [], ...overrides };
}
