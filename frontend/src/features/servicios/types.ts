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
  // S13: solo los que no tienen fecha de compra.
  sinFechaDeCompra?: boolean;
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

// --- Órdenes de servicio (S4a, docs/servicios.md §2.3–§2.5) ----------------

export interface UsuarioResumido {
  id: string;
  fullName: string;
}

export interface VehiculoResumido {
  id: string;
  make: string;
  model: string;
  year: number | null;
  licensePlate: string | null;
}

export interface OrdenDeLista {
  id: string;
  numero: string;
  status: EstadoDeOrden;
  scheduledFor: string | null;
  createdAt: string;
  deliveredAt: string | null;
  cancelledAt: string | null;
  amount: string | null;
  currency: string | null;
  vehiculo: VehiculoResumido;
  contact: ContactoResumido;
  branch: { id: string; name: string };
  assignee: UsuarioResumido | null;
  // Si ya pasó por En trabajo ("Pasar a" o "Volver a" trabajo).
  workStartedAt: string | null;
  enEstadoDesde: string;
}

export interface TipoDeService {
  id: string;
  name: string;
  nextServiceAfterMonths: number | null;
  isActive: boolean;
}

export interface Aprobacion {
  id: string;
  description: string;
  decision: "APROBADO" | "RECHAZADO";
  approverName: string;
  channel: "TELEFONO" | "WHATSAPP" | "PRESENCIAL" | "OTRO";
  decidedAt: string;
  amount: string | null;
  currency: string | null;
  createdAt: string;
  recordedBy: UsuarioResumido;
}

export interface CambioDeEstado {
  id: string;
  fromStatus: EstadoDeOrden | null;
  toStatus: EstadoDeOrden;
  changedAt: string;
  note: string | null;
  changedBy: UsuarioResumido;
}

export type EstadoDeTurno = "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

export interface TurnoDeLaOrden {
  id: string;
  startsAt: string;
  endsAt: string;
  status: EstadoDeTurno;
  servicio: string;
  recurso: string;
}

/** GET /api/servicios/turnos?contactId=: los que se pueden vincular. */
export interface TurnoVinculable {
  id: string;
  startsAt: string;
  endsAt: string;
  branch: { id: string; name: string };
  servicio: string;
  recurso: string;
}

export interface FichaDeOrden extends OrdenDeLista {
  customerVehicleId: string;
  contactId: string;
  branchId: string;
  bookingId: string | null;
  assigneeId: string | null;
  mileageIn: number | null;
  damageNotes: string | null;
  notes: string | null;
  receivedAt: string | null;
  readyAt: string | null;
  cancelReason: string | null;
  nextServiceDueOn: string | null;
  createdBy: UsuarioResumido;
  tipos: { id: string; name: string; nextServiceAfterMonths: number | null }[];
  aprobaciones: Aprobacion[];
  historial: CambioDeEstado[];
  aprobacionPendiente: boolean;
  // El turno vinculado (§4.4), con su estado y horario actuales.
  turno: TurnoDeLaOrden | null;
  proximoServicePropuesto: { fecha: string | null; meses: number | null } | null;
}

export interface OrdenesQuery {
  page?: number;
  pageSize?: number;
  estados?: EstadoDeOrden[];
  branchId?: string;
  assigneeId?: string;
  // La orden de un turno (detalle del turno en la agenda).
  bookingId?: string;
  q?: string;
}

export interface OrdenesResponse {
  data: OrdenDeLista[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface CrearOrdenInput {
  customerVehicleId: string;
  branchId?: string;
  estado: "AGENDADO" | "RECIBIDO";
  scheduledFor?: string | null;
  mileageIn?: number | null;
  assigneeId?: string | null;
  jobTypeIds?: string[];
  notes?: string | null;
  damageNotes?: string | null;
  amount?: number | null;
  currency?: string | null;
  bookingId?: string;
}

export interface ActualizarOrdenInput {
  assigneeId?: string | null;
  scheduledFor?: string | null;
  mileageIn?: number | null;
  damageNotes?: string | null;
  notes?: string | null;
  amount?: number | null;
  currency?: string | null;
  jobTypeIds?: string[];
  // Vincular (id) o desvincular (null) el turno.
  bookingId?: string | null;
}

export interface CambiarEstadoInput {
  desde: EstadoDeOrden;
  hacia: EstadoDeOrden;
  nota?: string | null;
  mileageIn?: number;
  cancelReason?: string;
  proximoService?: string | null;
}

export interface AprobacionInput {
  description: string;
  decision: "APROBADO" | "RECHAZADO";
  approverName: string;
  channel: Aprobacion["channel"];
  decidedAt: string;
  amount?: number | null;
  currency?: string | null;
  sumarAlValor?: boolean;
}

export interface ConfiguracionDelTaller {
  defaultNextServiceMonths: number | null;
  firstServiceAfterMonths: number | null;
}

/** Los 409 de la orden que la pantalla trata distinto. */
export const VEHICULO_EN_EL_TALLER = "VEHICULO_EN_EL_TALLER";
export const FALTA_REGISTRAR_LA_APROBACION = "FALTA_REGISTRAR_LA_APROBACION";

// S11 (docs/servicios.md §4.7): el resumen del taller. Espejo de
// ResumenDelTaller (src/servicios/services/dashboard.service.ts).
export interface OrdenDelResumen {
  id: string;
  numero: string;
  cliente: string;
  vehiculo: string;
  // Desde cuándo está en ese estado (instante ISO).
  desde: string | null;
}

export interface VehiculoDelResumen {
  id: string;
  cliente: string;
  vehiculo: string;
  // "AAAA-MM-DD"
  fecha: string;
}

export interface ListaDelResumen<T> {
  total: number;
  items: T[];
}

export interface ResumenDelTaller {
  hoy: string;
  enElTaller: { total: number; porEstado: Partial<Record<EstadoDeOrden, number>> };
  listosParaRetirar: ListaDelResumen<OrdenDelResumen>;
  esperandoAprobacion: ListaDelResumen<OrdenDelResumen>;
  servicesVencidos: ListaDelResumen<VehiculoDelResumen>;
  servicesEn30Dias: ListaDelResumen<VehiculoDelResumen>;
  turnosCancelados: ListaDelResumen<OrdenDelResumen>;
  // S13 (§7): los recambios.
  recambiosProximos: { total: number; sinFechaDeCompra: number };
  recambiosVencidos: { total: number };
}

// S13 (§7.4): recambios vencidos sin contactar. Espejo de RecambioVencido
// (src/servicios/recambio/lista.service.ts). Las fechas, "AAAA-MM-DD".
export interface RecambioVencido {
  id: string;
  cliente: string;
  vehiculo: string;
  vendedor: string | null;
  compra: string;
  recambio: string;
  aviso: string;
  vencidoHace: number;
}

export interface RecambiosResponse {
  data: RecambioVencido[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export type AccionDelRecambio = "TAREA" | "CONTACTADO";

export interface ResultadoDelRecambio {
  id: string;
  ok: boolean;
  error?: string;
}

// S12 (docs/servicios.md §8.1): avisar al cliente. Espejo de AvisosDeLaOrden
// (src/servicios/services/avisos.service.ts).
export type MedioDeAviso = "TELEFONO" | "WHATSAPP" | "EN_PERSONA";

export interface AvisoDeLaOrden {
  id: string;
  cuando: string;
  persona: string;
  detalle: string;
}

export interface AvisosDeLaOrden {
  sugerencia: string | null;
  conversacion: { id: string; ventanaAbierta: boolean } | null;
  telefono: string | null;
  avisos: AvisoDeLaOrden[];
}
