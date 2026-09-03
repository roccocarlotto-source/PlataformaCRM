import { describe, expect, it } from "vitest";
import { env } from "../config/env";
import { buildPublicResolutionUrl } from "./publicUrl";

const QR_ID = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";

describe("buildPublicResolutionUrl", () => {
  it("arma la URL sobre env.apiUrl, con /qr/resolve y SIN /api", () => {
    expect(buildPublicResolutionUrl(QR_ID)).toBe(`${env.apiUrl}/qr/resolve/${QR_ID}`);
    expect(buildPublicResolutionUrl(QR_ID)).not.toContain("/api/");
    // Nunca el path del original ni un dominio de Supabase.
    expect(buildPublicResolutionUrl(QR_ID)).not.toContain("/r/");
    expect(buildPublicResolutionUrl(QR_ID)).not.toContain("supabase");
  });

  it("rechaza un id que no es uuid", () => {
    expect(() => buildPublicResolutionUrl("no-es-uuid")).toThrow(/UUID/);
    expect(() => buildPublicResolutionUrl("")).toThrow(/UUID/);
  });
});
