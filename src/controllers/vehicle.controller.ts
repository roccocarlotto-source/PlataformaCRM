import type { Response } from "express";
import { z } from "zod";
import {
  createVehicle,
  deleteVehicle,
  getVehicleById,
  getVehicleChangeLog,
  listVehicles,
  updateVehicle,
} from "../services/vehicle.service";
import { getVehiclePhotos } from "../services/vehiclePhoto.service";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

// ---------------------------------------------------------------------------
// Frontera de validación del módulo de stock de vehículos (Fase 2a). Molde:
// qr.controller.ts. Zod repite acá los límites que la base sostiene por CHECK
// (montos >= 0, año 1900..2100, comisión 0..100, magnitudes técnicas) para
// que un body inválido sea un 400 con mensaje y no un 500 de Postgres; los
// largos son los VarChar del schema.
//
// Convenciones de los campos de texto nullable: trim, y vacío -> null (mismo
// criterio que `message` en QR), así "borrar el contenido de un campo" desde
// un formulario llega a la base como NULL y no como "". VIN y patente además
// van en mayúsculas y sin espacios: son identificadores que se comparan por
// igualdad exacta (unicidad en el service), y "ab 123 cd" y "AB123CD" son la
// misma patente.
// ---------------------------------------------------------------------------

const idParamSchema = z.string().uuid("id inválido");

const conditionSchema = z.enum(["NEW", "USED"]);
const statusSchema = z.enum(["AVAILABLE", "RESERVED", "IN_PREPARATION", "IN_TRANSIT", "SOLD"]);
const bodyTypeSchema = z.enum([
  "SEDAN",
  "HATCHBACK",
  "SUV",
  "PICKUP",
  "COUPE",
  "WAGON",
  "VAN",
  "UTILITY",
  "MINIVAN",
]);
const originSchema = z.enum([
  "DIRECT_PURCHASE",
  "TRADE_IN",
  "CONSIGNMENT",
  "IMPORT",
  "BRANCH_TRANSFER",
]);
const publicationCurrencySchema = z.enum(["BOTH", "USD_ONLY", "LOCAL_ONLY"]);
const transmissionSchema = z.enum(["MANUAL", "AUTOMATIC", "AUTOMATIC_SEQUENTIAL", "CVT"]);
const fuelTypeSchema = z.enum(["GASOLINE", "DIESEL", "HYBRID", "ELECTRIC", "CNG", "GASOLINE_CNG"]);
const colorFinishSchema = z.enum(["SOLID", "METALLIC", "PEARL", "MATTE"]);
const drivetrainSchema = z.enum(["FRONT", "REAR", "FOUR_BY_FOUR", "AWD"]);
const warrantySchema = z.enum(["NONE", "FACTORY", "DEALER_6M", "DEALER_12M"]);

// Texto nullable con trim y "vacío = null".
function nullableText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} no puede superar los ${max} caracteres`)
    .nullable()
    .transform((valor) => (valor === null || valor.length === 0 ? null : valor));
}

// Identificadores: mayúsculas y sin espacios internos.
function nullableIdentifier(max: number, label: string) {
  return z
    .string()
    .transform((valor) => valor.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().max(max, `${label} no puede superar los ${max} caracteres`))
    .nullable()
    .transform((valor) => (valor === null || valor.length === 0 ? null : valor));
}

function requiredText(max: number, label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} es requerido`)
    .max(max, `${label} no puede superar los ${max} caracteres`);
}

// z.number() y NO z.coerce.number() en el body — M-9 de la auditoría del
// 2026-08-29: coerce convertiría un null explícito en 0.
const MONEY_MAX = 999_999_999_999.99; // Decimal(14, 2)
function nullableMoney(label: string) {
  return z
    .number()
    .min(0, `${label} debe ser mayor o igual a 0`)
    .max(MONEY_MAX, `${label} supera el máximo admitido`)
    .nullable();
}

function nullablePositiveInt(label: string) {
  return z
    .number()
    .int(`${label} debe ser un entero`)
    .positive(`${label} debe ser mayor a 0`)
    .nullable();
}

const nullableDate = z.coerce.date().nullable();

const nullableHttpUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(2048, `${label} no puede superar los 2048 caracteres`)
    .regex(/^https?:\/\//i, `${label} tiene que empezar con http:// o https://`)
    .nullable();

// Códigos de equipamiento ("ABS", "AIRBAG_LATERAL"...). El catálogo cerrado lo
// fija la UI cuando exista la ficha (Fase 2 frontend); acá se valida la forma
// del código y que no haya repetidos, no la pertenencia a una lista.
const EQUIPMENT_CODE_MAX = 50;
const EQUIPMENT_MAX_ITEMS = 100;
const equipmentSchema = z
  .array(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        new RegExp(`^[A-Z0-9_]{1,${EQUIPMENT_CODE_MAX}}$`),
        "cada código de equipment es mayúsculas, dígitos y guión bajo",
      ),
  )
  .max(EQUIPMENT_MAX_ITEMS, `equipment no puede tener más de ${EQUIPMENT_MAX_ITEMS} ítems`)
  .refine((items) => new Set(items).size === items.length, {
    message: "equipment tiene códigos repetidos",
  });

const TEXT_BLOCK_MAX = 10_000;

// Todos los campos que el cliente escribe, agrupados como la ficha. De acá
// salen los dos schemas: POST exige los NOT NULL reales; PATCH es parcial.
const vehicleFields = {
  // Identificación
  condition: conditionSchema,
  licensePlate: nullableIdentifier(20, "licensePlate"),
  vin: nullableIdentifier(30, "vin"),
  engineNumber: nullableText(50, "engineNumber"),
  bodyType: bodyTypeSchema.nullable(),
  make: requiredText(100, "make"),
  model: requiredText(100, "model"),
  trim: nullableText(100, "trim"),
  year: z
    .number()
    .int("year debe ser un entero")
    .min(1900, "year debe ser mayor o igual a 1900")
    .max(2100, "year debe ser menor o igual a 2100"),

  // Comercial
  priceListUsd: nullableMoney("priceListUsd"),
  priceListLocal: nullableMoney("priceListLocal"),
  minAcceptablePriceUsd: nullableMoney("minAcceptablePriceUsd"),
  acquisitionCostUsd: nullableMoney("acquisitionCostUsd"),
  status: statusSchema,
  visibleInListing: z.boolean(),
  origin: originSchema.nullable(),
  stockEnteredAt: nullableDate,
  publicationCurrency: publicationCurrencySchema,
  acceptsTradeIn: z.boolean(),
  financingAvailable: z.boolean(),
  priceOnRequest: z.boolean(),

  // Consignación (solo con origin = CONSIGNMENT: lo decide el service)
  consignorName: nullableText(255, "consignorName"),
  consignorDocument: nullableText(50, "consignorDocument"),
  consignorPhone: nullableText(30, "consignorPhone"),
  consignorEmail: z
    .string()
    .trim()
    .max(255, "consignorEmail no puede superar los 255 caracteres")
    .email("consignorEmail inválido")
    .nullable(),
  consignmentAgreedPriceUsd: nullableMoney("consignmentAgreedPriceUsd"),
  consignmentCommissionPercent: z
    .number()
    .min(0, "consignmentCommissionPercent debe estar entre 0 y 100")
    .max(100, "consignmentCommissionPercent debe estar entre 0 y 100")
    .nullable(),
  consignmentAgreementExpiresAt: nullableDate,
  consignmentContractNumber: nullableText(50, "consignmentContractNumber"),

  // Características
  mileage: z
    .number()
    .int("mileage debe ser un entero")
    .min(0, "mileage debe ser mayor o igual a 0")
    .nullable(),
  transmission: transmissionSchema.nullable(),
  fuelType: fuelTypeSchema.nullable(),
  exteriorColor: nullableText(50, "exteriorColor"),
  colorFinish: colorFinishSchema.nullable(),
  cylinderCapacityLiters: z
    .number()
    .positive("cylinderCapacityLiters debe ser mayor a 0")
    .max(99.99, "cylinderCapacityLiters supera el máximo admitido")
    .nullable(),
  drivetrain: drivetrainSchema.nullable(),
  doors: nullablePositiveInt("doors"),
  upholstery: nullableText(100, "upholstery"),
  powerHp: nullablePositiveInt("powerHp"),
  seats: nullablePositiveInt("seats"),
  declaredConsumptionKmL: z
    .number()
    .positive("declaredConsumptionKmL debe ser mayor a 0")
    .max(999.99, "declaredConsumptionKmL supera el máximo admitido")
    .nullable(),
  equipment: equipmentSchema,

  // Documentación / garantía
  warranty: warrantySchema.nullable(),
  licensePlateDebtLocal: nullableMoney("licensePlateDebtLocal"),
  lastTechnicalInspectionAt: nullableDate,
  titleHolder: nullableText(255, "titleHolder"),
  singleOwner: z.boolean(),
  officialServiceUpToDate: z.boolean(),
  hasManualAndSpareKey: z.boolean(),
  titleReportRequested: z.boolean(),

  // Operativo
  branchId: z.string().uuid("branchId inválido"),
  assignedSalespersonId: z.string().uuid("assignedSalespersonId inválido").nullable(),
  physicalLocation: nullableText(255, "physicalLocation"),
  availableSince: nullableDate,

  // Multimedia
  videoUrl: nullableHttpUrl("videoUrl"),
  tour360Url: nullableHttpUrl("tour360Url"),

  // Publicación
  publishOnWebsite: z.boolean(),
  publishOnPortals: z.boolean(),
  featuredOnHomepage: z.boolean(),

  // Contenido
  publicDescription: nullableText(TEXT_BLOCK_MAX, "publicDescription"),
  internalNotes: nullableText(TEXT_BLOCK_MAX, "internalNotes"),
};

// POST: crea en modo borrador. Obligatorios solo los NOT NULL reales del
// schema (condition, make, model, year, branchId); el resto opcional, y lo
// que no viene toma el default de la base.
export const createVehicleSchema = z
  .object(vehicleFields)
  .partial()
  .required({ condition: true, make: true, model: true, year: true, branchId: true });

// PATCH: parcial, cada campo opcional, se rechaza un body vacío (mismo
// criterio que updateQrSchema). Campos desconocidos se descartan (strip).
export const updateVehicleSchema = z
  .object(vehicleFields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

// status es multi-selección: `?status=A&status=B` (Express lo entrega como
// array) o `?status=A,B`. Un solo valor llega como string.
const statusListSchema = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => (typeof item === "string" ? item.split(",") : [item]));
}, z.array(statusSchema).min(1).optional());

// "true"/"false" explícitos, NO z.coerce.boolean() (Boolean("false") es true)
// — mismo criterio que activity/source.
const queryBooleanSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

export const listVehiclesQuerySchema = z.object({
  // Mismo tope de cordura que el resto de los listados (B-21).
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  branchId: z.string().uuid("branchId inválido").optional(),
  status: statusListSchema,
  condition: conditionSchema.optional(),
  make: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  minPriceUsd: z.coerce.number().min(0).optional(),
  maxPriceUsd: z.coerce.number().min(0).optional(),
  consignmentOnly: queryBooleanSchema,
  q: z.string().trim().min(1).max(100).optional(),
  sortBy: z.enum(["createdAt", "priceListUsd", "stockEnteredAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const changeLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const createVehicleHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createVehicleSchema, req.body);
    const vehicle = await createVehicle(req.auth.organizationId, input);
    res.status(201).json(vehicle);
  },
);

export const listVehiclesHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listVehiclesQuerySchema, req.query);
    const result = await listVehicles(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

// Detalle completo, incluidos los campos internos (piso de negociación,
// costo, consignante, notas): este endpoint es autenticado y de la propia
// organización. La restricción de "nunca en una respuesta pública" del schema
// es sobre la página sin login de la Fase 3, no sobre este.
//
// Desde la Fase 2b trae `photos`: la galería en orden, cada una con una URL
// firmada de lectura de corta duración generada en este momento (nunca una
// URL guardada). Se compone acá y no en vehicle.service para que ese módulo
// no importe al de fotos, que ya lo importa a él.
export const getVehicleHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const vehicle = await getVehicleById(req.auth.organizationId, id);
  const photos = await getVehiclePhotos(req.auth.organizationId, id);
  res.status(200).json({ ...vehicle, photos });
});

export const getVehicleChangeLogHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const query = parseOrThrow(changeLogQuerySchema, req.query);
    const result = await getVehicleChangeLog(req.auth.organizationId, id, query);
    res.status(200).json(result);
  },
);

export const updateVehicleHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateVehicleSchema, req.body);
    const vehicle = await updateVehicle(req.auth.organizationId, req.auth.userId, id, input);
    res.status(200).json(vehicle);
  },
);

export const deleteVehicleHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deleteVehicle(req.auth.organizationId, id);
    res.status(204).send();
  },
);
