import type { ConversationChannel } from "../agent/types";
import type { VehicleStatus } from "../vehicle/types";
// Reconstruido desde el contrato real del backend (src/controllers/contact.controller.ts,
// src/services/contact.service.ts, prisma/schema.prisma modelo Contact). No se
// agrega ningún campo que el backend no devuelva o no acepte.

export type LifecycleStage = "LEAD" | "MQL" | "SQL" | "CUSTOMER" | "CHURNED";

export interface Contact {
  id: string;
  organizationId: string;
  companyId: string | null;
  ownerId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  lifecycleStage: LifecycleStage;
  source: string | null;
  // Vehículo de interés (F2): la unidad del stock que le interesa, separada de
  // una oportunidad. Quién la cargó decide si el agente la puede cambiar.
  vehicleOfInterestId?: string | null;
  vehicleOfInterestSetBy?: "HUMAN" | "AGENT" | null;
  // Solo en el GET de la ficha: el resumen de la unidad, aunque se haya
  // vendido o dado de baja.
  vehicleOfInterest?: VehicleOfInterestSummary | null;
  // B6: los campos personalizados, { key: valor }, validados por el backend
  // contra las definiciones de la organización. null/ausente = ninguno.
  customFields?: Record<string, unknown> | null;
  // "Cliente desde": la fecha de alta en el sistema anterior, de una
  // importación (docs/importacion-de-datos.md §2.5). Solo lectura. Un día del
  // calendario ("YYYY-MM-DDT00:00:00.000Z"), no un instante.
  customerSince?: string | null;
  // Cuándo lo creó una importación; null si se cargó por otro camino.
  importedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface VehicleOfInterestSummary {
  id: string;
  internalCode: string;
  make: string;
  model: string;
  trim: string | null;
  year: number;
  status: VehicleStatus;
  deletedAt: string | null;
}

export interface ContactListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ContactListResponse {
  data: Contact[];
  pagination: ContactListPagination;
}

export type ContactSortBy = "firstName" | "lastName" | "createdAt" | "lifecycleStage";
export type SortOrder = "asc" | "desc";

// Filtros expuestos en M3: search (cubre firstName/lastName/email vía OR
// server-side), companyId, lifecycleStage, sortBy/sortOrder. ownerId se
// tipa (igual criterio que Company) pero sin filtro visual — ver M2, mismo
// motivo: sin GET /api/users no hay forma de mostrar nombres reales.
// firstName/lastName/email/source individuales no se exponen como filtros
// separados: search ya cubre el caso de uso, y agregarlos sin un control
// visual real sería un campo sin consumidor.
export interface ContactListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  companyId?: string;
  ownerId?: string;
  lifecycleStage?: LifecycleStage;
  // Las dos pestañas de Contactos (ítem 184). Sin vista, todos: es lo que
  // siguen pidiendo ContactSelect y la unión.
  vista?: VistaDeContactos;
  // Solo con vista=consultas: el canal de la última conversación.
  channel?: ConversationChannel;
  sortBy?: ContactSortBy;
  sortOrder?: SortOrder;
}

export type VistaDeContactos = "clientes" | "consultas";

// Lo que la pestaña "Consultas sin identificar" muestra además del contacto:
// su última conversación (contact.service.ts, listarConsultasSinIdentificar).
export interface UltimaConsulta {
  conversationId: string;
  channel: ConversationChannel;
  // El último mensaje del cliente, ya recortado por el backend; null si la
  // conversación no tiene ninguno.
  ultimoMensaje: string | null;
  // Cuándo escribió por última vez.
  ultimoMensajeAt: string;
}

export interface ContactConConsulta extends Contact {
  // null para una consulta sin conversación (cargada por la ingesta con un
  // nombre vacío).
  ultimaConsulta: UltimaConsulta | null;
}

export interface ConsultasListResponse {
  data: ContactConConsulta[];
  pagination: ContactListPagination;
}

// companyId/ownerId: opcionales, tipados como `string` (nunca `string | null`)
// — el backend no soporta limpiarlos a null vía PATCH (contact.service.ts:
// `if (input.companyId)`/`if (input.ownerId)`, chequeo truthy).
//
// email/phone/jobTitle/source: aunque contact.service.ts tipa su
// UpdateContactInput interno como `string | null`, el schema Zod real de
// contact.controller.ts (`contactFields`) solo tiene `.optional()`, sin
// `.nullable()` — un PATCH con `email: null` sería rechazado por Zod antes
// de llegar al service. El contrato HTTP real (lo único que el frontend
// puede ejercitar) es "string opcional", nunca null explícito — se tipa
// acá según ese contrato real, no según el tipo interno del backend.
export interface CreateContactInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  lifecycleStage?: LifecycleStage;
  source?: string;
  companyId?: string;
  ownerId?: string;
  // B6: { key: valor }; null borra el valor. Solo claves de definiciones de
  // la organización; el backend rechaza el resto con 400.
  customFields?: Record<string, string | number | boolean | string[] | null>;
}

// El vehículo de interés solo se edita desde la ficha (PATCH): null lo quita.
export type UpdateContactInput = Partial<CreateContactInput> & {
  vehicleOfInterestId?: string | null;
};
