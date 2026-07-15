import type { Invitation } from "../features/invitation/types";

// Fixture compartida entre los tests de features/invitation/. roleId/
// invitedById son UUIDs crudos, fieles al contrato real (sin include, ver
// types.ts).
export function makeInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: "inv1",
    organizationId: "org-1",
    email: "invitado@example.com",
    roleId: "role-user",
    invitedById: "u1",
    status: "PENDING",
    expiresAt: "2026-01-08T00:00:00.000Z",
    acceptedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
