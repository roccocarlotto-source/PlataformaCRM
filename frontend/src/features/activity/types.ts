// Reconstruido desde el contrato real del backend (src/routes/activity.routes.ts,
// src/controllers/activity.controller.ts, src/services/activity.service.ts,
// src/repositories/activity.repository.ts, prisma/schema.prisma modelo Activity).
// No se agrega ningún campo que el backend no devuelva o no acepte: no hay
// status/priority/isCompleted en el modelo real (verificado, no asumido).

export type ActivityType = "CALL" | "MEETING" | "EMAIL" | "TASK" | "NOTE";

export const ACTIVITY_TYPES: ActivityType[] = ["CALL", "MEETING", "EMAIL", "TASK", "NOTE"];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  CALL: "Llamada",
  MEETING: "Reunión",
  EMAIL: "Email",
  TASK: "Tarea",
  NOTE: "Nota",
};

// dueDate/completedAt son DateTime reales (con hora) en Prisma — sin
// @db.Date, a diferencia de Opportunity.expectedCloseDate/actualCloseDate.
// Viajan como ISO 8601 completo, nunca como "YYYY-MM-DD" — ver
// activity/datetimeLocal.ts para la conversión hacia/desde
// <input type="datetime-local">.
export interface Activity {
  id: string;
  organizationId: string;
  type: ActivityType;
  authorId: string;
  assigneeId: string | null;
  companyId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  subject: string;
  body: string | null;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ActivityListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ActivityListResponse {
  data: Activity[];
  pagination: ActivityListPagination;
}

export type ActivitySortBy = "createdAt" | "updatedAt" | "dueDate" | "completedAt" | "subject";
export type SortOrder = "asc" | "desc";

// Filtros reales de GET /api/activities (activity.controller.ts listQuerySchema)
// — dueDateFrom/dueDateTo y completedAtFrom/completedAtTo son rangos, no
// igualdad exacta; search cubre subject/body vía OR server-side.
export interface ActivityListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: ActivityType;
  authorId?: string;
  assigneeId?: string;
  companyId?: string;
  contactId?: string;
  opportunityId?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  completedAtFrom?: string;
  completedAtTo?: string;
  sortBy?: ActivitySortBy;
  sortOrder?: SortOrder;
}

// Create: companyId/contactId/opportunityId son opcionales acá pero el
// backend exige al menos uno (refine de Zod) — validado también en el
// frontend antes del submit (ver relationPatch.ts hasAtLeastOneRelation).
// Nunca nullable en create (a diferencia de update): un valor vacío se
// OMITE, nunca se envía null (createActivitySchema no tiene .nullable()
// en ningún campo).
export interface CreateActivityInput {
  type: ActivityType;
  subject: string;
  body?: string;
  dueDate?: string;
  completedAt?: string;
  assigneeId?: string;
  companyId?: string;
  contactId?: string;
  opportunityId?: string;
}

// Update: todos opcionales, y body/dueDate/completedAt/assigneeId/companyId/
// contactId/opportunityId aceptan además `null` explícito para limpiar
// (updateActivitySchema: .nullable().optional() en los siete). authorId NO
// existe acá — no se puede editar, sale exclusivamente de req.auth.userId.
export interface UpdateActivityInput {
  type?: ActivityType;
  subject?: string;
  body?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
  assigneeId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
}
