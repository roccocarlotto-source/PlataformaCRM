import { ACTION_CREATE_FOLLOW_UP, TRIGGER_OPPORTUNITY_WON } from "../features/automation/catalog";
import type { Automation } from "../features/automation/types";

// Fixture compartida entre los tests de features/automation/ (listado y
// formulario). Los valores por defecto son los de una regla recién creada por
// la pantalla: activa, con el trigger y la acción por defecto del catálogo, y
// una config de seguimiento válida.
export function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "au1",
    organizationId: "org-1",
    name: "Seguimiento post-venta",
    triggerType: TRIGGER_OPPORTUNITY_WON,
    actionType: ACTION_CREATE_FOLLOW_UP,
    actionConfig: { subject: "Llamar para coordinar la entrega", daysUntilDue: 3 },
    triggerConfig: {},
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
