import type { KnowledgeBaseEntry } from "../features/knowledgeBase/types";

// Fixture compartida entre los tests de features/knowledgeBase/ (listado y
// formulario). Los valores por defecto son los de una entrada recién creada
// por la pantalla: activa, con un título corto y un contenido de un párrafo.
export function makeKnowledgeBaseEntry(
  overrides: Partial<KnowledgeBaseEntry> = {},
): KnowledgeBaseEntry {
  return {
    id: "kb1",
    organizationId: "org-1",
    branchId: "b1",
    title: "Horarios de atención",
    content: "Lunes a viernes de 9 a 18. Sábados de 9 a 13.",
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
