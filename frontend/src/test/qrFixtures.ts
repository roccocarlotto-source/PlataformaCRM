import type { QrCode } from "../features/qr/types";

// Fixture compartida entre los tests de features/qr/ — mismo criterio que
// companyFixtures.ts. Un QR digital REUSABLE recién creado: la forma que
// devuelve POST /api/qr/digital y que trae el listado. El id es un uuid real
// porque buildPublicResolutionUrl lo exige.
export function makeQrCode(overrides: Partial<QrCode> = {}): QrCode {
  return {
    id: "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11",
    organizationId: "org-1",
    branchId: "b1",
    displayNumber: 1,
    name: "Mostrador",
    message: null,
    destinationUrl: "https://g.page/r/abc/review",
    qrType: "REUSABLE",
    usedAt: null,
    claimedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
