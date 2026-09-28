import { describe, expect, it } from "vitest";
import { extractVoucherId } from "./voucherId";

const ID = "5b0f7a4e-2c1d-4f3a-9e8b-1a2b3c4d5e6f";

describe("extractVoucherId", () => {
  it("toma el UUID del final del link público del cupón", () => {
    expect(extractVoucherId(`https://nexoraqrs.com/v/${ID}`)).toBe(ID);
  });

  it("acepta el id pelado (backend sin QR_PUBLIC_BASE_URL, o tipeado a mano)", () => {
    expect(extractVoucherId(`  ${ID.toUpperCase()}  `)).toBe(ID);
  });

  it("tolera barra final, query y hash", () => {
    expect(extractVoucherId(`https://nexoraqrs.com/v/${ID}/`)).toBe(ID);
    expect(extractVoucherId(`https://nexoraqrs.com/v/${ID}?utm=wa#x`)).toBe(ID);
  });

  it("null si no hay UUID al final: no es un cupón", () => {
    expect(extractVoucherId("https://g.page/r/abc/review")).toBeNull();
    expect(extractVoucherId(`https://nexoraqrs.com/v/${ID}/otra-cosa`)).toBeNull();
    expect(extractVoucherId("")).toBeNull();
  });
});
