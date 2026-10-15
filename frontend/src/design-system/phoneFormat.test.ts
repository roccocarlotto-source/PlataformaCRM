import { describe, expect, it } from "vitest";
import { formatPhoneGroups } from "./phoneFormat";

describe("formatPhoneGroups", () => {
  it("celular uruguayo como se dicta: +598 99 777 778", () => {
    expect(formatPhoneGroups("+59899777778")).toEqual(["+598", "99", "777", "778"]);
    expect(formatPhoneGroups("+59891234567")).toEqual(["+598", "91", "234", "567"]);
  });

  it("fijo uruguayo de Montevideo y del interior: +598 2400 1234, +598 4372 1234", () => {
    expect(formatPhoneGroups("+59824001234")).toEqual(["+598", "2400", "1234"]);
    expect(formatPhoneGroups("+59843721234")).toEqual(["+598", "4372", "1234"]);
  });

  it("con otro largo u otro prefijo, separa el +598 y agrupa de a 3 desde la izquierda", () => {
    expect(formatPhoneGroups("+598990000045")).toEqual(["+598", "990", "000", "045"]);
    expect(formatPhoneGroups("+59880012345")).toEqual(["+598", "800", "123", "45"]);
  });

  it("deja un último grupo de 1 dígito o completo según el total", () => {
    expect(formatPhoneGroups("+5989900000")).toEqual(["+598", "990", "000", "0"]);
    expect(formatPhoneGroups("+598990000")).toEqual(["+598", "990", "000"]);
  });

  it("devuelve null con otro código de país", () => {
    expect(formatPhoneGroups("+54991234567")).toBeNull();
    expect(formatPhoneGroups("099123456")).toBeNull();
  });

  it("devuelve null si ya tiene espacios, guiones o letras", () => {
    expect(formatPhoneGroups("+598 99 000 004")).toBeNull();
    expect(formatPhoneGroups("+598-99000004")).toBeNull();
    expect(formatPhoneGroups("+598 int. 4")).toBeNull();
  });

  it("devuelve null con +598 sin dígitos detrás", () => {
    expect(formatPhoneGroups("+598")).toBeNull();
  });

  it("devuelve null con vacío, null y undefined", () => {
    expect(formatPhoneGroups("")).toBeNull();
    expect(formatPhoneGroups(null)).toBeNull();
    expect(formatPhoneGroups(undefined)).toBeNull();
  });
});
