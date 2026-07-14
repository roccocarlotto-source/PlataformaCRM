import type { User } from "../features/user/types";

// Fixture compartida entre los tests que consumen features/user/ (UserSelect,
// resolución de Owner en Opportunity).
export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    organizationId: "org-1",
    roleId: "role-admin",
    email: "ana@example.com",
    fullName: "Ana Pérez",
    isActive: true,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    role: {
      id: "role-admin",
      name: "ADMIN",
      description: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}
