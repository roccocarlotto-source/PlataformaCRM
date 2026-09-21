// Reconstruido desde el contrato real del backend
// (src/controllers/automation.controller.ts, src/services/automation.service.ts,
// prisma/schema.prisma modelo Automation). Ítem 62 de
// docs/frontend-cambios-pendientes.md; diseño del motor en
// docs/automations-architecture.md.
//
// No se declara ningún campo que el backend no devuelva o no acepte: cada uno
// de los de abajo está verificado contra el modelo y contra
// createAutomationSchema/updateAutomationSchema del controller.

// Una regla configurada: "cuando pase triggerType, ejecutá actionType con esta
// actionConfig". Es CONFIGURACIÓN, no historial — por eso tiene deletedAt
// (soft delete), igual que Agent o Branch.
export interface Automation {
  id: string;
  organizationId: string;
  name: string;
  // Strings libres en la base y en el borde HTTP: el catálogo vive en código,
  // no en el schema (docs/automations-architecture.md §3). Por eso acá son
  // `string` y no una unión cerrada — ver catalog.ts, que es el espejo del
  // catálogo del backend y sabe traducirlos a un rótulo legible, pero no los
  // impone como tipo: un valor que el backend ya conoce y este catálogo
  // todavía no tiene que poder LISTARSE, no romper el tipado.
  triggerType: string;
  actionType: string;
  // La configuración de la acción. Su forma la decide cada acción, no el
  // modelo: para activity.create_follow_up son { subject, daysUntilDue }.
  actionConfig: Record<string, unknown>;
  // La configuración del TRIGGER (ítem 76), con el mismo criterio que
  // actionConfig: su forma la decide cada trigger. "{}" para opportunity.won;
  // { daysWithoutActivity } para opportunity.stale.
  triggerConfig: Record<string, unknown>;
  // Desactivar una regla NO la borra: el dispatcher simplemente la saltea.
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AutomationListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AutomationListResponse {
  data: Automation[];
  pagination: AutomationListPagination;
}

export type AutomationSortBy = "name" | "createdAt";
export type SortOrder = "asc" | "desc";

// listQuerySchema del controller. `search` busca por NOMBRE de la regla —ver
// buildWhere en src/repositories/automation.repository.ts—, no por el
// contenido de la config.
export interface AutomationListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  triggerType?: string;
  isActive?: boolean;
  sortBy?: AutomationSortBy;
  sortOrder?: SortOrder;
}

// createAutomationSchema. Requeridos de verdad: name, triggerType, actionType
// y actionConfig; isActive tiene default true en la base, y triggerConfig
// "{}" (un trigger que exige config, como opportunity.stale, da 400 sin ella).
export interface CreateAutomationInput {
  name: string;
  triggerType: string;
  actionType: string;
  actionConfig: Record<string, unknown>;
  triggerConfig?: Record<string, unknown>;
  isActive?: boolean;
}

// updateAutomationSchema: los mismos campos, parciales, al menos uno. El
// service revalida el actionConfig EFECTIVO contra la acción EFECTIVA, así que
// mandar los cuatro juntos (como hace el formulario) es el camino seguro:
// cambiar solo el actionType obligaría al backend a revalidar la config vieja
// contra el schema nuevo.
export type UpdateAutomationInput = Partial<CreateAutomationInput>;
