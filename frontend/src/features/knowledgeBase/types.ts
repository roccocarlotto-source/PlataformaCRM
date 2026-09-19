// Reconstruido desde el contrato real del backend
// (src/controllers/knowledgeBaseEntry.controller.ts,
// src/services/knowledgeBaseEntry.service.ts, prisma/schema.prisma modelo
// KnowledgeBaseEntry). Ítem 59 de docs/frontend-cambios-pendientes.md; diseño
// del módulo de agentes en docs/ai-agent-architecture.md.
//
// No se declara ningún campo que el backend no devuelva o no acepte: cada uno
// de los de abajo está verificado contra el modelo y contra
// createKnowledgeBaseEntrySchema/updateKnowledgeBaseEntrySchema del controller.

export interface KnowledgeBaseEntry {
  id: string;
  organizationId: string;
  branchId: string;
  title: string;
  content: string;
  // Oculta la entrada del prompt de los agentes de la sucursal sin borrarla.
  // NO es lo mismo que deletedAt: inactiva se lista, se edita y se puede
  // volver a activar.
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface KnowledgeBaseListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface KnowledgeBaseListResponse {
  data: KnowledgeBaseEntry[];
  pagination: KnowledgeBaseListPagination;
}

export type KnowledgeBaseSortBy = "title" | "createdAt";
export type SortOrder = "asc" | "desc";

// listQuerySchema del controller. `search` busca por TÍTULO y no por
// contenido — ver el comentario de buildWhere en
// src/repositories/knowledgeBaseEntry.repository.ts.
export interface KnowledgeBaseListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  branchId?: string;
  isActive?: boolean;
  sortBy?: KnowledgeBaseSortBy;
  sortOrder?: SortOrder;
}

// createKnowledgeBaseEntrySchema. Requeridos de verdad: branchId, title y
// content; isActive tiene default true en la base.
export interface CreateKnowledgeBaseEntryInput {
  branchId: string;
  title: string;
  content: string;
  isActive?: boolean;
}

// updateKnowledgeBaseEntrySchema: los mismos campos, parciales, al menos uno —
// INCLUIDO branchId, a diferencia de UpdateAgentInput. Una entrada de KB sí
// cambia de sucursal: no hay ningún dato histórico denormalizado que dependa
// de ella (no existe el equivalente de Conversation.branchId), así que no hay
// razón de integridad para prohibirlo. Ver la nota de
// UpdateKnowledgeBaseEntryInput en src/services/knowledgeBaseEntry.service.ts.
export type UpdateKnowledgeBaseEntryInput = Partial<CreateKnowledgeBaseEntryInput>;
