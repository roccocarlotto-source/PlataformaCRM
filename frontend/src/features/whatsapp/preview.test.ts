import { describe, expect, it } from "vitest";
import { insertarToken, previewDePlantilla } from "./preview";

describe("previewDePlantilla", () => {
  it("reemplaza {nombre} y {link} por los mismos ejemplos que el backend manda a Meta", () => {
    expect(previewDePlantilla("  Hola {nombre}, tu opinión: {link} ¡Gracias! ")).toBe(
      "Hola Ana, tu opinión: https://g.page/r/ejemplo/review ¡Gracias!",
    );
  });

  it("deja tal cual un token mal escrito: el backend es quien lo rechaza, con su mensaje", () => {
    expect(previewDePlantilla("Hola {Nombre}")).toBe("Hola {Nombre}");
  });
});

describe("insertarToken", () => {
  it("inserta en el cursor y deja el cursor después del token", () => {
    expect(insertarToken("Hola , gracias", "{nombre}", { inicio: 5, fin: 5 })).toEqual({
      texto: "Hola {nombre}, gracias",
      cursor: 13,
    });
  });

  it("reemplaza la selección", () => {
    expect(insertarToken("Tu link: ACA fin", "{link}", { inicio: 9, fin: 12 })).toEqual({
      texto: "Tu link: {link} fin",
      cursor: 15,
    });
  });
});
