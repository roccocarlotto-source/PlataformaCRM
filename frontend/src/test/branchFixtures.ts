import type { Branch } from "../features/branch/types";

// Fixture compartida entre los tests que consumen features/branch/
// (BranchSelect, QrListPage, QrFormDialog, ClaimPage).
export function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: "b1",
    organizationId: "org-1",
    name: "Casa Central",
    timezone: "America/Montevideo",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
