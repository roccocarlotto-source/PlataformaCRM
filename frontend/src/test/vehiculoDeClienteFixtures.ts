import type { FichaDeOrden, FichaDeVehiculo, VehiculoDeCliente } from "../features/servicios/types";

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

export function makeFichaDeOrden(overrides: Partial<FichaDeOrden> = {}): FichaDeOrden {
  return {
    id: "o1",
    numero: "OS-0007",
    status: "RECIBIDO",
    scheduledFor: null,
    createdAt: "2026-10-14T12:00:00.000Z",
    deliveredAt: null,
    cancelledAt: null,
    amount: null,
    currency: null,
    vehiculo: { id: "cv1", make: "Toyota", model: "Hilux", year: 2020, licensePlate: "SBC 1001" },
    contact: { id: "ct1", firstName: "Ana", lastName: "Ejemplo" },
    branch: { id: "b1", name: "Taller Centro" },
    assignee: null,
    enEstadoDesde: "2026-10-14T12:00:00.000Z",
    customerVehicleId: "cv1",
    contactId: "ct1",
    branchId: "b1",
    bookingId: null,
    assigneeId: null,
    mileageIn: 45000,
    damageNotes: null,
    notes: null,
    receivedAt: "2026-10-14T12:00:00.000Z",
    workStartedAt: null,
    readyAt: null,
    cancelReason: null,
    nextServiceDueOn: null,
    createdBy: { id: "u1", fullName: "Encargado" },
    tipos: [],
    aprobaciones: [],
    historial: [
      {
        id: "h1",
        fromStatus: null,
        toStatus: "RECIBIDO",
        changedAt: "2026-10-14T12:00:00.000Z",
        note: null,
        changedBy: { id: "u1", fullName: "Encargado" },
      },
    ],
    aprobacionPendiente: false,
    proximoServicePropuesto: null,
    ...overrides,
  };
}
