import { describe, expect, it } from "vitest";
import {
  MAX_OPCIONES,
  MENSAJE_DEMASIADAS_OPCIONES,
  MENSAJE_LISTA_SIN_OPCIONES,
  cambiosDeOpciones,
  claveDeOpcion,
  filasDesdeOpciones,
  cambiosEnUso,
  mensajeDeOpcionRepetida,
  nuevaFila,
  opcionesAgregadas,
  partirTextoPegado,
  tieneSeparadores,
  validarFilas,
  type FilaDeOpcion,
} from "./opciones";

// La lógica pura del editor de opciones de un campo de lista. El recorrido con
// el formulario montado está en ContactCustomFieldFormPage.test.tsx.

function filas(...textos: string[]): FilaDeOpcion[] {
  return textos.map((texto, index) => ({ id: `f${index}`, texto }));
}

describe("opciones de un campo de lista", () => {
  it("partirTextoPegado: comas y saltos de línea separan; sin vacías, recortadas", () => {
    expect(partirTextoPegado("Contado, financiado, permuta")).toEqual([
      "Contado",
      "financiado",
      "permuta",
    ]);
    expect(partirTextoPegado("Nafta\r\nDiésel\n\n GNC ,")).toEqual(["Nafta", "Diésel", "GNC"]);
    expect(partirTextoPegado("Una sola")).toEqual(["Una sola"]);
    expect(partirTextoPegado(" , \n")).toEqual([]);
    expect(tieneSeparadores("Una sola")).toBe(false);
    expect(tieneSeparadores("a,b")).toBe(true);
    expect(tieneSeparadores("a\nb")).toBe(true);
  });

  it("claveDeOpcion: la misma regla que el backend — sin mayúsculas, acentos ni espacios de más", () => {
    expect(claveDeOpcion("  Diésel  ")).toBe("diesel");
    expect(claveDeOpcion("CONTADO")).toBe(claveDeOpcion("contado"));
    expect(claveDeOpcion("Permuta   más  efectivo")).toBe("permuta mas efectivo");
  });

  it("validarFilas: las vacías no cuentan; lo que queda va recortado y en orden", () => {
    expect(validarFilas(filas(" Nafta ", "", "Diésel", "   "))).toEqual({
      ok: true,
      opciones: ["Nafta", "Diésel"],
    });
  });

  it("validarFilas: sin ninguna opción, repetidas y de más — con el mensaje del backend y las filas a corregir", () => {
    expect(validarFilas(filas("", " "))).toEqual({
      ok: false,
      mensaje: MENSAJE_LISTA_SIN_OPCIONES,
      filas: ["f0", "f1"],
    });
    expect(validarFilas([])).toMatchObject({ ok: false, mensaje: MENSAJE_LISTA_SIN_OPCIONES });

    expect(validarFilas(filas("Contado", "Financiado", "contado"))).toEqual({
      ok: false,
      mensaje: mensajeDeOpcionRepetida("contado"),
      filas: ["f0", "f2"],
    });
    expect(validarFilas(filas("Diésel", "diesel"))).toMatchObject({ ok: false });

    const muchas = filas(...Array.from({ length: MAX_OPCIONES + 2 }, (_, i) => `Opción ${i}`));
    expect(validarFilas(muchas)).toEqual({
      ok: false,
      mensaje: MENSAJE_DEMASIADAS_OPCIONES,
      filas: [`f${MAX_OPCIONES}`, `f${MAX_OPCIONES + 1}`],
    });
    expect(validarFilas(muchas.slice(0, MAX_OPCIONES)).ok).toBe(true);
  });

  it("cambiosDeOpciones: una fila guardada que cambia de texto es un renombre; una que desaparece, una eliminada", () => {
    const guardadas = ["Contado", "Financiado", "Permuta"];
    const [contado, financiado] = filasDesdeOpciones(guardadas);

    // Renombra Contado, borra Permuta, agrega Leasing, y cambia el orden.
    expect(
      cambiosDeOpciones(guardadas, [
        financiado,
        { ...contado, texto: " Contado efectivo " },
        nuevaFila("Leasing"),
      ]),
    ).toEqual({
      renombradas: [{ from: "Contado", to: "Contado efectivo" }],
      eliminadas: ["Permuta"],
    });

    // Sin tocar nada (ni reordenando) no hay cambios que confirmar.
    expect(cambiosDeOpciones(guardadas, [...filasDesdeOpciones(guardadas)].reverse())).toEqual({
      renombradas: [],
      eliminadas: [],
    });
  });

  it("cambiosDeOpciones: vaciar una fila guardada la elimina; reescribirla en una fila nueva la conserva", () => {
    const guardadas = ["Contado", "Financiado"];
    const [contado, financiado] = filasDesdeOpciones(guardadas);

    expect(cambiosDeOpciones(guardadas, [{ ...contado, texto: "  " }, financiado])).toEqual({
      renombradas: [],
      eliminadas: ["Contado"],
    });

    // Se borró la fila y se volvió a escribir igual: la opción sigue existiendo.
    expect(cambiosDeOpciones(guardadas, [financiado, nuevaFila("Contado")])).toEqual({
      renombradas: [],
      eliminadas: [],
    });

    // La fila de Contado pasó a decir Efectivo, pero "Contado" se volvió a
    // escribir en una fila nueva: sus contactos no se mueven.
    expect(
      cambiosDeOpciones(guardadas, [
        { ...contado, texto: "Efectivo" },
        financiado,
        nuevaFila("Contado"),
      ]),
    ).toEqual({ renombradas: [], eliminadas: [] });

    // Un intercambio son dos renombres.
    expect(
      cambiosDeOpciones(guardadas, [
        { ...contado, texto: "Financiado" },
        { ...financiado, texto: "Contado" },
      ]),
    ).toEqual({
      renombradas: [
        { from: "Contado", to: "Financiado" },
        { from: "Financiado", to: "Contado" },
      ],
      eliminadas: [],
    });
  });

  it("cambiosEnUso: solo los cambios que algún contacto tiene, con cuántos", () => {
    const cambios = {
      renombradas: [
        { from: "Contado", to: "Efectivo" },
        { from: "Cheque", to: "Cheque diferido" },
      ],
      eliminadas: ["Permuta", "Leasing"],
    };
    expect(cambiosEnUso(cambios, {})).toEqual({ renombradas: [], eliminadas: [] });
    expect(cambiosEnUso(cambios, { Contado: 1, Permuta: 3, Financiado: 9 })).toEqual({
      renombradas: [{ from: "Contado", to: "Efectivo", contactos: 1 }],
      eliminadas: [{ opcion: "Permuta", contactos: 3 }],
    });
  });

  it("partir no es renombrar: la fila guardada desaparece y las partes son nuevas; opcionesAgregadas las lista", () => {
    const guardadas = ["Contado, financiado, permuta", "Leasing"];
    const [, leasing] = filasDesdeOpciones(guardadas);
    // Lo que deja el editor al pegar con comas: tres filas nuevas en lugar de la guardada.
    const filas = [nuevaFila("Contado"), nuevaFila("financiado"), nuevaFila("permuta"), leasing];
    expect(cambiosDeOpciones(guardadas, filas)).toEqual({
      renombradas: [],
      eliminadas: ["Contado, financiado, permuta"],
    });
    expect(opcionesAgregadas(filas)).toEqual(["Contado", "financiado", "permuta"]);
    expect(opcionesAgregadas([...filasDesdeOpciones(guardadas), nuevaFila(" ")])).toEqual([]);
  });

  it("la identidad no depende de la posición: reordenar y editar es un renombre; borrar y agregar en el mismo lugar no", () => {
    const guardadas = ["Contado", "Financiado", "Permuta"];
    const [contado, financiado, permuta] = filasDesdeOpciones(guardadas);
    // Contado bajó al segundo lugar y ahí se editó.
    expect(
      cambiosDeOpciones(guardadas, [
        financiado,
        { ...contado, texto: "Contado efectivo" },
        permuta,
      ]),
    ).toEqual({ renombradas: [{ from: "Contado", to: "Contado efectivo" }], eliminadas: [] });
    // Se borró Financiado y se escribió "Cheque" en su lugar: no es un renombre.
    expect(cambiosDeOpciones(guardadas, [contado, nuevaFila("Cheque"), permuta])).toEqual({
      renombradas: [],
      eliminadas: ["Financiado"],
    });
  });
});
