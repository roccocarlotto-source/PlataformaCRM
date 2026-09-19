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

// ---------------------------------------------------------------------------
// Ítem 60 — completar el contenido desde un archivo.
// ---------------------------------------------------------------------------

// Lo que devuelve POST /api/knowledge-base/extract-text. El archivo NO se
// guarda en ningún lado: sube, se le extrae el texto y se descarta. Lo único
// que queda es este string, que entra al campo Contenido como una carga
// inicial editable — no como una fuente de verdad aparte.
export interface KnowledgeBaseExtractedText {
  text: string;
  // El backend recorta a 20.000 caracteres (MAX_CARACTERES_EXTRAIDOS) para no
  // mandar de vuelta un PDF de 80 páginas que igual no iba a entrar en el
  // campo. Cuando es true, lo que se ve NO es todo el documento.
  truncated: boolean;
}

// Los tres formatos que el backend acepta, en el orden en que se nombran en
// los textos de la pantalla. Solo .docx moderno: el .doc binario viejo no
// entra, y es una decisión —ver el comentario de MIMETYPES_SOPORTADOS en
// src/services/knowledgeBaseExtraction.service.ts.
export const EXTENSIONES_ARCHIVO_SOPORTADAS = [".txt", ".docx", ".pdf"] as const;
