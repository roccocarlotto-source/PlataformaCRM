import type { Activity } from "../features/activity/types";

// Fixture compartida entre los tests de features/activity/. dueDate/
// completedAt son ISO 8601 completos (con hora) — a diferencia de
// opportunityFixtures.ts, nunca solo fecha.
export function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act1",
    organizationId: "org-1",
    type: "TASK",
    authorId: "u1",
    assigneeId: null,
    companyId: "co1",
    contactId: null,
    opportunityId: null,
    subject: "Llamar para renovación",
    body: null,
    dueDate: null,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
