import { describe, expect, it } from "vitest";
import { validarArchivo } from "./fileValidation";
import { IMPORT_MAX_FILE_BYTES } from "./types";

// La validación es una función pura y se prueba directo. En la pantalla el
// input declara accept=".csv,.xlsx", así que el diálogo del browser ya filtra
// casi todo — pero accept es una sugerencia (un drag & drop lo saltea), y el
// tamaño no lo filtra nadie del lado del cliente. Estos son los casos que la
// función tiene que cubrir por su cuenta.

function archivo(nombre: string, bytes = 10): File {
  return new File(["x".repeat(bytes)], nombre, { type: "text/csv" });
}

describe("validarArchivo", () => {
  it("acepta .csv y .xlsx", () => {
    expect(validarArchivo(archivo("leads.csv"))).toBeNull();
    expect(validarArchivo(archivo("feria.xlsx"))).toBeNull();
  });

  it("la extensión se mira sin importar mayúsculas", () => {
    expect(validarArchivo(archivo("LEADS.CSV"))).toBeNull();
    expect(validarArchivo(archivo("Feria.XLSX"))).toBeNull();
  });

  it("rechaza cualquier otra extensión, con el mensaje de los formatos válidos", () => {
    const error = validarArchivo(archivo("notas.txt"));
    expect(error).toMatch(/Formato no soportado/);
    expect(error).toContain(".csv");
    expect(error).toContain(".xlsx");

    expect(validarArchivo(archivo("planilla.xls"))).toMatch(/Formato no soportado/);
    expect(validarArchivo(archivo("sin-extension"))).toMatch(/Formato no soportado/);
  });

  it("rechaza un archivo por encima del tope y dice el máximo en MB", () => {
    const error = validarArchivo(archivo("grande.csv", IMPORT_MAX_FILE_BYTES + 1));
    expect(error).toMatch(/supera el máximo/);
    expect(error).toContain("10 MB");
  });

  it("el tope exacto se acepta: el rechazo es estrictamente mayor", () => {
    expect(validarArchivo(archivo("justo.csv", IMPORT_MAX_FILE_BYTES))).toBeNull();
  });

  it("la extensión se chequea ANTES que el tamaño", () => {
    // Un .txt enorme reporta el problema de formato, que es el que la persona
    // puede resolver sin recortar nada.
    const error = validarArchivo(archivo("enorme.txt", IMPORT_MAX_FILE_BYTES + 1));
    expect(error).toMatch(/Formato no soportado/);
  });
});
