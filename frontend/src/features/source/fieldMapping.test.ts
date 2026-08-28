import { describe, expect, it } from "vitest";
import {
  agregarFilasSugeridas,
  mapToRows,
  rowsToMapping,
  sugerirDestino,
  type FieldMappingRow,
} from "./fieldMapping";
import { MAX_COLUMNAS_MAPEADAS } from "./types";

// Las reglas del mapeo viven acá y no en el componente justamente para poder
// probarlas sin montar nada. Cada caso corresponde a un error que, sin esta
// validación, el usuario vería recién como un 400 del backend.

describe("mapToRows", () => {
  it("convierte el mapa persistido en filas del formulario", () => {
    expect(mapToRows({ Nombre: "firstName", Mail: "email" })).toEqual([
      { encabezado: "Nombre", destino: "firstName" },
      { encabezado: "Mail", destino: "email" },
    ]);
  });

  it("null y undefined dan una lista vacía, no una fila vacía", () => {
    expect(mapToRows(null)).toEqual([]);
    expect(mapToRows(undefined)).toEqual([]);
  });

  it("descarta destinos que no son campos reconocidos en vez de romper el formulario", () => {
    // field_mapping es JSONB: una escritura directa a la base puede dejar ahí
    // algo que el endpoint jamás habría aceptado. La pantalla tiene que seguir
    // siendo usable para corregirlo.
    const conBasura = { Nombre: "firstName", Raro: "columnaInventada" } as Record<string, string>;
    expect(mapToRows(conBasura as never)).toEqual([{ encabezado: "Nombre", destino: "firstName" }]);
  });
});

describe("rowsToMapping", () => {
  it("convierte las filas en el mapa plano que espera el backend", () => {
    const filas: FieldMappingRow[] = [
      { encabezado: "Nombre", destino: "firstName" },
      { encabezado: "Apellido", destino: "lastName" },
    ];
    expect(rowsToMapping(filas)).toEqual({
      ok: true,
      mapping: { Nombre: "firstName", Apellido: "lastName" },
    });
  });

  it("recorta los espacios del encabezado", () => {
    const filas: FieldMappingRow[] = [{ encabezado: "  Nombre  ", destino: "firstName" }];
    expect(rowsToMapping(filas)).toEqual({ ok: true, mapping: { Nombre: "firstName" } });
  });

  it("sin filas devuelve mapping null — nunca un objeto vacío", () => {
    // El backend rechaza {} explícitamente: "para no mapear nada, omitilo o
    // mandá null". Devolver null acá es lo que permite que el formulario mande
    // lo correcto en cada verbo.
    expect(rowsToMapping([])).toEqual({ ok: true, mapping: null });
  });

  it("las filas completamente vacías se descartan en silencio", () => {
    const filas: FieldMappingRow[] = [
      { encabezado: "Nombre", destino: "firstName" },
      { encabezado: "", destino: "" },
    ];
    expect(rowsToMapping(filas)).toEqual({ ok: true, mapping: { Nombre: "firstName" } });
  });

  it("solo filas vacías equivale a no tener mapeo", () => {
    const filas: FieldMappingRow[] = [
      { encabezado: "", destino: "" },
      { encabezado: "   ", destino: "" },
    ];
    expect(rowsToMapping(filas)).toEqual({ ok: true, mapping: null });
  });

  it("rechaza dos columnas al MISMO destino, con el nombre visible del campo", () => {
    const filas: FieldMappingRow[] = [
      { encabezado: "Nombre", destino: "firstName" },
      { encabezado: "Nombre de pila", destino: "firstName" },
    ];
    const resultado = rowsToMapping(filas);
    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.error).toContain("Nombre");
    expect(resultado.ok === false && resultado.error).toMatch(/mismo campo/);
  });

  it("rechaza encabezados repetidos: uno de los dos se perdería al armar el objeto", () => {
    const filas: FieldMappingRow[] = [
      { encabezado: "Nombre", destino: "firstName" },
      { encabezado: "Nombre", destino: "lastName" },
    ];
    const resultado = rowsToMapping(filas);
    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.error).toMatch(/repetidas/);
  });

  it("rechaza una fila con encabezado pero sin destino elegido", () => {
    const filas: FieldMappingRow[] = [{ encabezado: "Nombre", destino: "" }];
    const resultado = rowsToMapping(filas);
    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.error).toContain("Nombre");
  });

  it("rechaza una fila con destino pero sin encabezado", () => {
    const filas: FieldMappingRow[] = [{ encabezado: "   ", destino: "email" }];
    const resultado = rowsToMapping(filas);
    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.error).toMatch(/nombre de la columna/);
  });

  it(`rechaza más de ${MAX_COLUMNAS_MAPEADAS} columnas`, () => {
    // Destinos repetidos a propósito: se está probando el tope, y el chequeo de
    // tope corre antes que el de duplicados.
    const filas: FieldMappingRow[] = Array.from(
      { length: MAX_COLUMNAS_MAPEADAS + 1 },
      (_, i) => ({ encabezado: `Columna ${i}`, destino: "firstName" }) as FieldMappingRow,
    );
    const resultado = rowsToMapping(filas);
    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.error).toContain(String(MAX_COLUMNAS_MAPEADAS));
  });

  it("ida y vuelta: mapToRows(rowsToMapping(x)) conserva el mapeo", () => {
    const original = { Nombre: "firstName", Mail: "email" } as const;
    const resultado = rowsToMapping(mapToRows(original));
    expect(resultado).toEqual({ ok: true, mapping: original });
  });
});

describe("sugerirDestino", () => {
  it("EL EJEMPLO DE ROCCO: Nombre, Mail, Teléfono sugieren; Observación no", () => {
    // El caso que motivó la tarea. "Observación" no tiene campo de destino
    // razonable entre los cinco que la ingesta escribe, y forzarla a uno sería
    // peor que dejarla vacía para que la persona decida.
    expect(sugerirDestino("Nombre")).toBe("firstName");
    expect(sugerirDestino("Mail")).toBe("email");
    expect(sugerirDestino("Teléfono")).toBe("phone");
    expect(sugerirDestino("Observación")).toBe("");
  });

  it("normaliza tildes, mayúsculas y espacios", () => {
    expect(sugerirDestino("  TELÉFONO  ")).toBe("phone");
    expect(sugerirDestino("Correo Electrónico")).toBe("email");
    expect(sugerirDestino("APELLIDOS")).toBe("lastName");
  });

  it("reconoce los nombres canónicos, que es lo que exporta el propio sistema", () => {
    expect(sugerirDestino("firstName")).toBe("firstName");
    expect(sugerirDestino("lastName")).toBe("lastName");
    expect(sugerirDestino("jobTitle")).toBe("jobTitle");
  });

  it("cubre los cinco campos", () => {
    expect(sugerirDestino("Nombres")).toBe("firstName");
    expect(sugerirDestino("Apellido")).toBe("lastName");
    expect(sugerirDestino("correo")).toBe("email");
    expect(sugerirDestino("Celular")).toBe("phone");
    expect(sugerirDestino("Puesto")).toBe("jobTitle");
    expect(sugerirDestino("Cargo")).toBe("jobTitle");
  });

  it("sin coincidencia devuelve cadena vacía, nunca un destino aproximado", () => {
    // Sin fuzzy matching a propósito: un acierto parcial equivocado mapea una
    // columna al campo incorrecto en silencio.
    expect(sugerirDestino("Nombre de la empresa")).toBe("");
    expect(sugerirDestino("Fecha de alta")).toBe("");
    expect(sugerirDestino("")).toBe("");
    expect(sugerirDestino("   ")).toBe("");
  });
});

describe("agregarFilasSugeridas", () => {
  it("agrega una fila por encabezado nuevo, con su sugerencia", () => {
    const resultado = agregarFilasSugeridas([], ["Nombre", "Mail", "Observación"]);
    expect(resultado).toEqual([
      { encabezado: "Nombre", destino: "firstName" },
      { encabezado: "Mail", destino: "email" },
      { encabezado: "Observación", destino: "" },
    ]);
  });

  it("ES UN MERGE: no pisa una fila que la persona ya completó a mano", () => {
    const existentes: FieldMappingRow[] = [{ encabezado: "Mail", destino: "lastName" }];
    const resultado = agregarFilasSugeridas(existentes, ["Nombre", "Mail"]);

    // "Mail" ya estaba: se conserva TAL CUAL, con el destino raro que alguien
    // eligió a propósito, sin corregirlo con la sugerencia.
    expect(resultado).toEqual([
      { encabezado: "Mail", destino: "lastName" },
      { encabezado: "Nombre", destino: "firstName" },
    ]);
  });

  it("la comparación es EXACTA, no normalizada", () => {
    // El mapeo real compara la clave del JSON contra el encabezado del archivo
    // carácter por carácter (traducirConMapeo), así que "Mail" y "mail" son dos
    // columnas distintas y las dos tienen que poder existir.
    const resultado = agregarFilasSugeridas([{ encabezado: "Mail", destino: "email" }], ["mail"]);
    expect(resultado).toHaveLength(2);
    expect(resultado[1]).toEqual({ encabezado: "mail", destino: "email" });
  });

  it("sin encabezados nuevos devuelve la misma lista", () => {
    const existentes: FieldMappingRow[] = [{ encabezado: "Nombre", destino: "firstName" }];
    expect(agregarFilasSugeridas(existentes, ["Nombre"])).toEqual(existentes);
  });
});
