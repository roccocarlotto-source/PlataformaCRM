import type { ContactCustomFieldDefinition } from "../features/contactCustomField/types";

// Fixture de una definición de campo personalizado de contactos (B6).
export function makeDefinicion(
  overrides: Partial<ContactCustomFieldDefinition> = {},
): ContactCustomFieldDefinition {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "org-1",
    key: "patente",
    label: "Patente",
    type: "TEXT",
    options: [],
    agentEditable: true,
    position: 0,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
