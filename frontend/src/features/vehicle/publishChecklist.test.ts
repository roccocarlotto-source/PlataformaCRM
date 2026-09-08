import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import {
  PUBLISH_REQUIRED_FIELDS,
  PUBLISH_REQUIRED_FIELDS_USED,
  computePublishChecklist,
  readServerMissingFields,
} from "./publishChecklist";

// Espejo de computeMissingFieldsForPublish (vehicle.service.ts) sobre los
// valores del formulario (strings).

const COMPLETE_NEW = {
  condition: "NEW" as const,
  bodyType: "SEDAN",
  make: "Toyota",
  model: "Corolla",
  year: "2024",
  priceListUsd: "25000",
  priceListLocal: "1000000",
  transmission: "CVT",
  fuelType: "HYBRID",
  exteriorColor: "Blanco",
  vin: "JTDBR32E720000000",
};

describe("computePublishChecklist", () => {
  it("un 0 km completo con una foto está al 100% y no le falta nada", () => {
    const result = computePublishChecklist(COMPLETE_NEW, 1);
    expect(result.missing).toEqual([]);
    expect(result.percent).toBe(100);
    // Los 10 campos base + la foto.
    expect(result.required).toHaveLength(PUBLISH_REQUIRED_FIELDS.length + 1);
  });

  it("sin fotos, 'photos' aparece al final de los faltantes", () => {
    const result = computePublishChecklist(COMPLETE_NEW, 0);
    expect(result.missing).toEqual(["photos"]);
    expect(result.percent).toBeLessThan(100);
  });

  it("un usado exige además patente, kilometraje y titular", () => {
    const result = computePublishChecklist({ ...COMPLETE_NEW, condition: "USED" }, 1);
    expect(result.missing).toEqual([...PUBLISH_REQUIRED_FIELDS_USED]);
    expect(result.required).toHaveLength(
      PUBLISH_REQUIRED_FIELDS.length + PUBLISH_REQUIRED_FIELDS_USED.length + 1,
    );
  });

  it("un string de espacios cuenta como vacío, igual que en el backend", () => {
    const result = computePublishChecklist({ ...COMPLETE_NEW, vin: "   " }, 1);
    expect(result.missing).toEqual(["vin"]);
  });

  it("el porcentaje es entero y baja con cada faltante", () => {
    const result = computePublishChecklist({ ...COMPLETE_NEW, vin: "", make: "" }, 0);
    // 11 requeridos, 3 faltan -> 8/11 = 72.7 -> 73.
    expect(result.percent).toBe(73);
    expect(Number.isInteger(result.percent)).toBe(true);
  });
});

describe("readServerMissingFields", () => {
  it("lee missingFields de un ApiError con details", () => {
    const error = new ApiError(422, "La unidad no está completa para publicar", {
      missingFields: ["vin", "photos"],
    });
    expect(readServerMissingFields(error)).toEqual(["vin", "photos"]);
  });

  it("devuelve null para un error sin details, un details sin la lista, o algo que no es error", () => {
    expect(readServerMissingFields(new ApiError(500, "boom"))).toBeNull();
    expect(readServerMissingFields(new ApiError(400, "x", { otra: 1 }))).toBeNull();
    expect(readServerMissingFields(new Error("red"))).toBeNull();
    expect(readServerMissingFields(null)).toBeNull();
  });
});
