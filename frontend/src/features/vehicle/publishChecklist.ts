import type { VehicleCondition } from "./types";

// ---------------------------------------------------------------------------
// Checklist LOCAL de completitud para publicar.
//
// DUPLICACIÓN DELIBERADA: estas tres constantes espejan PUBLISH_REQUIRED_FIELDS,
// PUBLISH_REQUIRED_FIELDS_USED y PUBLISH_REQUIRED_PHOTOS de
// src/services/vehicle.service.ts — si cambian ahí, actualizar acá. Es la
// única forma de que el porcentaje se recalcule en vivo mientras la persona
// tipea, sin pegarle al backend en cada tecla.
//
// PERO NO ES EL GATE. La fuente de verdad de si el guardado anda sigue siendo
// el backend: si el POST/PATCH devuelve 422 con missingFields, la ficha
// muestra ESA lista (ApiError.details.missingFields), no esta. Esto es una
// guía visual.
// ---------------------------------------------------------------------------

export const PUBLISH_REQUIRED_FIELDS = [
  "bodyType",
  "make",
  "model",
  "year",
  "priceListUsd",
  "priceListLocal",
  "transmission",
  "fuelType",
  "exteriorColor",
  "vin",
] as const;

export const PUBLISH_REQUIRED_FIELDS_USED = ["licensePlate", "mileage", "titleHolder"] as const;

export const PUBLISH_REQUIRED_PHOTOS = "photos";

export type PublishRequiredField =
  | (typeof PUBLISH_REQUIRED_FIELDS)[number]
  | (typeof PUBLISH_REQUIRED_FIELDS_USED)[number]
  | typeof PUBLISH_REQUIRED_PHOTOS;

type PublishRequiredVehicleField = Exclude<PublishRequiredField, typeof PUBLISH_REQUIRED_PHOTOS>;

export interface PublishChecklist {
  required: PublishRequiredField[];
  missing: PublishRequiredField[];
  // 0..100, entero. 100 cuando no falta nada.
  percent: number;
}

// Mismo criterio que isPresent en el backend: null/undefined falta; un string
// falta si queda vacío tras trim. Acá los valores son los del FORMULARIO
// (strings), no los de la fila, por eso el tipo es laxo.
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function computePublishChecklist(
  values: Partial<Record<PublishRequiredVehicleField, unknown>> & { condition: VehicleCondition },
  photoCount: number,
): PublishChecklist {
  const requiredFields: PublishRequiredVehicleField[] = [...PUBLISH_REQUIRED_FIELDS];
  if (values.condition === "USED") {
    requiredFields.push(...PUBLISH_REQUIRED_FIELDS_USED);
  }
  const required: PublishRequiredField[] = [...requiredFields, PUBLISH_REQUIRED_PHOTOS];
  const missing: PublishRequiredField[] = requiredFields.filter(
    (field) => !isPresent(values[field]),
  );
  if (photoCount < 1) {
    missing.push(PUBLISH_REQUIRED_PHOTOS);
  }
  const percent = Math.round(((required.length - missing.length) / required.length) * 100);
  return { required, missing, percent };
}

// Lee la lista del servidor de un error de red. Devuelve null si el error no
// trae missingFields (cualquier otro 4xx/5xx), para que el caller muestre el
// mensaje común.
export function readServerMissingFields(error: unknown): string[] | null {
  const details = (error as { details?: Record<string, unknown> } | null)?.details;
  const missing = details?.missingFields;
  if (!Array.isArray(missing)) return null;
  return missing.filter((item): item is string => typeof item === "string");
}
