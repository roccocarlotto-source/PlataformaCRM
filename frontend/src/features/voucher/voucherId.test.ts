import { describe, expect, it } from "vitest";
import { leerCodigoEscaneado } from "./voucherId";

const ID = "5b0f7a4e-2c1d-4f3a-9e8b-1a2b3c4d5e6f";
const BASE = "https://nexoraqrs.com";
const leer = (texto: string) => leerCodigoEscaneado(texto, BASE);

describe("leerCodigoEscaneado", () => {
  it("toma el id del link público del cupón", () => {
    expect(leer(`https://nexoraqrs.com/v/${ID}`)).toEqual({ tipo: "cupon", id: ID });
  });

  it("acepta el id pelado (backend sin QR_PUBLIC_BASE_URL, o tipeado a mano)", () => {
    expect(leer(`  ${ID.toUpperCase()}  `)).toEqual({ tipo: "cupon", id: ID });
  });

  it("tolera barra final, query, hash, link sin https:// y www.", () => {
    expect(leer(`https://nexoraqrs.com/v/${ID}/`)).toEqual({ tipo: "cupon", id: ID });
    expect(leer(`https://nexoraqrs.com/v/${ID}?utm=wa#x`)).toEqual({ tipo: "cupon", id: ID });
    expect(leer(`nexoraqrs.com/v/${ID}`)).toEqual({ tipo: "cupon", id: ID });
    expect(leer(`https://www.nexoraqrs.com/v/${ID}`)).toEqual({ tipo: "cupon", id: ID });
  });

  it("reconoce el QR de reseñas (/r/<uuid>) sin confundirlo con un cupón", () => {
    expect(leer(`https://nexoraqrs.com/r/${ID}`)).toEqual({ tipo: "qr-resenas" });
    expect(leer(`nexoraqrs.com/r/${ID}/`)).toEqual({ tipo: "qr-resenas" });
  });

  it("no es un cupón: otro dominio, sin UUID u otra ruta", () => {
    expect(leer(`https://otro-sitio.com/v/${ID}`)).toEqual({ tipo: "no-es-cupon" });
    expect(leer(`https://otro-sitio.com/r/${ID}`)).toEqual({ tipo: "no-es-cupon" });
    expect(leer("https://g.page/r/abc/review")).toEqual({ tipo: "no-es-cupon" });
    expect(leer(`https://nexoraqrs.com/v/${ID}/otra-cosa`)).toEqual({ tipo: "no-es-cupon" });
    expect(leer(`https://nexoraqrs.com/x/${ID}`)).toEqual({ tipo: "no-es-cupon" });
    expect(leer("hola")).toEqual({ tipo: "no-es-cupon" });
    expect(leer("")).toEqual({ tipo: "no-es-cupon" });
  });
});
