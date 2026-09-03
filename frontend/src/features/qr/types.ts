// Reconstruido desde el contrato real del backend (src/controllers/qr.controller.ts,
// src/services/qr.service.ts, src/repositories/qrCode.repository.ts,
// prisma/schema.prisma modelo QrCode — Fase 2 mergeada de docs/qr-integration.md).
// No se agrega ningún campo que el backend no devuelva o no acepte.

export type QrType = "REUSABLE" | "SINGLE_USE";

// Los endpoints de negocio devuelven la fila entera de Prisma (findMany /
// create / findFirst sin `select`). Dos diferencias con el shape que la guía
// de Fase 3 daba como esperable, confirmadas contra el schema real:
//   - NO hay `updatedAt`: el modelo QrCode no tiene esa columna (a diferencia
//     de Company/Branch). No se inventa.
//   - `displayNumber`, `name` y `destinationUrl` son nullable en la columna
//     (herencia del modelo de stock pre-insertado del original), aunque todo
//     camino de escritura de Fase 2 los deja siempre poblados. Se tipan como
//     los devuelve el backend y la UI los muestra con "—" si faltan.
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
  qrType: QrType;
  usedAt: string | null;
  claimedAt: string | null;
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

// createDigitalQrSchema: branchId + name + destinationUrl obligatorios,
// message opcional (vacío → null en el backend), qrType opcional con default
// REUSABLE server-side. Es el ÚNICO camino por el que nace un SINGLE_USE
// (desvío 1 de Fase 2).
export interface CreateDigitalQrInput {
  branchId: string;
  name: string;
  destinationUrl: string;
  message?: string | null;
  qrType?: QrType;
}

// claimQrSchema: mismo shape que digital más el qrId del sticker, SIN qrType
// (un QR físico es siempre REUSABLE por construcción).
export interface ClaimQrInput {
  qrId: string;
  branchId: string;
  name: string;
  destinationUrl: string;
  message?: string | null;
}

// updateQrSchema: parcial de verdad, al menos un campo; `message: null` lo
// vacía explícitamente. Ni branchId ni qrType: inmutables tras la creación.
export interface UpdateQrInput {
  name?: string;
  destinationUrl?: string;
  message?: string | null;
}

// Estado derivado en el cliente, no una columna (docs/qr-integration.md,
// Fase 3, QrListPage). Con el modelo de Fase 2 (la fila nace en el claim, ya
// reclamada) "SIN_RECLAMAR" no debería aparecer nunca — se conserva la rama
// por si el modelo de stock pre-insertado termina siendo el elegido.
export type QrCodeStatus = "SIN_RECLAMAR" | "USADO" | "ACTIVO";

export function estadoDeQr(qr: QrCode): QrCodeStatus {
  if (qr.claimedAt === null) return "SIN_RECLAMAR";
  if (qr.qrType === "SINGLE_USE" && qr.usedAt !== null) return "USADO";
  return "ACTIVO";
}
