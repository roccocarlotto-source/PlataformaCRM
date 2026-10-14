// Vehículos de clientes del módulo Servicios (docs/servicios.md §2.2, S3). El
// contrato de /api/servicios/vehiculos. Las fechas sin hora (compra y próximo
// service) viajan como "AAAA-MM-DD": no son instantes y no pasan por zonas.

export type MotivoDeFin = "VENDIDO_A_TERCERO" | "PERMUTA" | "OTRO";

export type EstadoDeOrden =
  | "AGENDADO"
  | "RECIBIDO"
  | "EN_TRABAJO"
  | "ESPERANDO_APROBACION"
  | "LISTO_PARA_RETIRAR"
  | "ENTREGADO"
  | "CANCELADO";

export interface ContactoResumido {
  id: string;
  firstName: string;
  lastName: string;
}

export interface VehiculoDeCliente {
  id: string;
  contactId: string;
  branchId: string | null;
  make: string;
  model: string;
  year: number | null;
  licensePlate: string | null;
  vin: string | null;
  mileage: number | null;
  purchasedOn: string | null;
  nextServiceDueOn: string | null;
  nextServiceSetFromOrderId: string | null;
  remindersOptOut: boolean;
  sourceVehicleId: string | null;
  sourceOpportunityId: string | null;
  ownershipEndedAt: string | null;
  ownershipEndReason: MotivoDeFin | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  contact: ContactoResumido;
  branch: { id: string; name: string } | null;
  ordenAbierta: { id: string; numero: string; status: EstadoDeOrden } | null;
}

export interface CambioDeDueno {
  id: string;
  kind: "CAMBIO_DE_DUENO" | "FIN";
  endReason: MotivoDeFin | null;
  previousPurchasedOn: string | null;
  stockVehicleId: string | null;
  note: string | null;
  changedAt: string;
  fromContact: ContactoResumido;
  toContact: ContactoResumido | null;
  changedBy: { id: string; fullName: string } | null;
}

export interface FichaDeVehiculo extends VehiculoDeCliente {
  cambiosDeDueno: CambioDeDueno[];
}

export interface OrdenDelVehiculo {
  id: string;
  numero: string;
  status: EstadoDeOrden;
  deliveredAt: string | null;
  mileageIn: number | null;
  amount: string | null;
  currency: string | null;
  createdAt: string;
  assignee: { id: string; fullName: string } | null;
  tipos: { id: string; name: string }[];
}

export interface VehiculosQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  contactId?: string;
  branchId?: string;
  incluirNoVigentes?: boolean;
}

export interface VehiculosResponse {
  data: VehiculoDeCliente[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface CamposDelVehiculoInput {
  branchId?: string | null;
  make?: string;
  model?: string;
  year?: number | null;
  licensePlate?: string | null;
  vin?: string | null;
  mileage?: number | null;
  purchasedOn?: string | null;
  nextServiceDueOn?: string | null;
  remindersOptOut?: boolean;
  notes?: string | null;
}

export interface CrearVehiculoInput extends CamposDelVehiculoInput {
  contactId: string;
  make: string;
  model: string;
}

export type CambiarDuenoInput =
  | { toContactId: string; nota?: string | null }
  | { fin: "VENDIDO_A_TERCERO" | "OTRO"; nota?: string | null };

/** El 409 de matrícula o chasis repetido: trae el vehículo que ya la tiene. */
export const VEHICULO_DUPLICADO = "VEHICULO_DUPLICADO";
