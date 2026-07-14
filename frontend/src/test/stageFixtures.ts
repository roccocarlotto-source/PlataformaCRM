import type { Stage } from "../features/stage/types";

// Fixture compartida entre los tests de features/stage/. probability se
// fija como string, fiel al contrato real (Prisma.Decimal → toJSON()
// string) — ver features/stage/types.ts.
export function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "st1",
    organizationId: "org-1",
    pipelineId: "pl1",
    name: "Prospecto",
    order: 1,
    probability: "0",
    isWon: false,
    isLost: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}
