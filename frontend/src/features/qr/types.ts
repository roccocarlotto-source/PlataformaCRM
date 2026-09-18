// Reconstruido desde el contrato real del backend (src/controllers/qr.controller.ts,
// src/services/qr.service.ts, src/repositories/qrCode.repository.ts,
// prisma/schema.prisma modelo QrCode).
// No se agrega ningún campo que el backend no devuelva o no acepte.
//
// Reverificado contra el schema en el ítem 53 de
// docs/frontend-cambios-pendientes.md: la migración
// 20260904120000_remove_qr_claim_and_single_use eliminó las columnas `qrType`,
// `usedAt` y `claimedAt` (se sacó el QR físico reclamable y el de un solo uso),
// y este archivo se había quedado declarándolas. El backend nunca las mandaba,
// así que llegaban `undefined` y todo lo que dependía de ellas mostraba valores
// vacíos o fijos sin que se notara. Acá ya no están.

// Los endpoints de negocio devuelven la fila entera de Prisma (findMany /
// create / findFirst sin `select`). Dos diferencias con el shape que la guía
// de Fase 3 daba como esperable, confirmadas contra el schema real:
//   - NO hay `updatedAt`: el modelo QrCode no tiene esa columna (a diferencia
//     de Company/Branch). No se inventa.
//   - `displayNumber` es nullable en la columna, y `branchId`, `name` y
//     `destinationUrl` se tipan nullable acá aunque la migración de arriba los
//     dejó NOT NULL. Es a propósito: el tipo más laxo no inventa nada (el
//     backend nunca manda null en esos tres) y la UI ya los muestra con "—" si
//     faltaran. Ajustarlos —y limpiar los `??` que dejarían de hacer falta— es
//     un ítem aparte, no éste.
// `deletedAt` viaja pero es siempre null en el listado (deletedAt: null en el
// WHERE del repositorio).
export interface QrCode {
  id: string;
  organizationId: string;
  branchId: string | null;
  displayNumber: number | null;
  name: string | null;
  message: string | null;
  destinationUrl: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface QrCodeListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface QrCodeListResponse {
  data: QrCode[];
  pagination: QrCodeListPagination;
}

export type QrCodeSortBy = "createdAt" | "displayNumber";
export type SortOrder = "asc" | "desc";

// listQrQuerySchema de qr.controller.ts. Sin `search`: el contrato no lo
// tiene, no se inventa del lado del frontend.
export interface QrCodeListQuery {
  page?: number;
  pageSize?: number;
  branchId?: string;
  sortBy?: QrCodeSortBy;
  sortOrder?: SortOrder;
}

// createDigitalQrSchema: branchId + name + destinationUrl obligatorios, message
// opcional (vacío → null en el backend). Sin `qrType`: desde la migración de
// arriba es el único camino de creación y todo QR nace digital y reusable, así
// que el Zod del backend ya no lo declara —y al no ser `.strict()` lo venía
// descartando en silencio, no rechazándolo—.
export interface CreateDigitalQrInput {
  branchId: string;
  name: string;
  destinationUrl: string;
  message?: string | null;
}

// claimQrSchema: mismo shape que digital más el qrId del sticker.
//
// OJO: POST /api/qr/claim ya NO existe en el backend (lo sacó la misma
// migración; ver el comentario de qr.routes.ts). Esto y su consumidor
// —api.ts::claimQrCode y la ruta /qr/claim/:id de ClaimPage— quedan en pie
// porque sacarlos es borrar una página entera con su ruta y sus tests: un ítem
// propio, anotado en el 53. Hoy esa pantalla le pega a un endpoint inexistente.
export interface ClaimQrInput {
  qrId: string;
  branchId: string;
  name: string;
  destinationUrl: string;
  message?: string | null;
}

// updateQrSchema: parcial de verdad, al menos un campo; `message: null` lo
// vacía explícitamente. Sin branchId: mover un QR de sucursal no es una
// operación del contrato.
export interface UpdateQrInput {
  name?: string;
  destinationUrl?: string;
  message?: string | null;
}
