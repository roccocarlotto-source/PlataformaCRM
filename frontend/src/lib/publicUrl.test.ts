import { describe, expect, it } from "vitest";
import { env } from "../config/env";
import { buildPublicResolutionUrl } from "./publicUrl";

const QR_ID = "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11";

describe("buildPublicResolutionUrl", () => {
  it("arma la URL sobre env.qrPublicBaseUrl (el Worker), con /r y SIN /api ni /qr/resolve", () => {
    expect(buildPublicResolutionUrl(QR_ID)).toBe(`${env.qrPublicBaseUrl}/r/${QR_ID}`);
    expect(buildPublicResolutionUrl(QR_ID)).not.toContain("/api/");
    // Ya NO pega directo contra el backend: ese camino esquivaba el Worker
    // (gap de Fase 4, docs/qr-integration.md) y el backend lo rechaza sin el
    // header del secreto compartido.
    expect(buildPublicResolutionUrl(QR_ID)).not.toContain("/qr/resolve/");
    expect(buildPublicResolutionUrl(QR_ID)).not.toContain(env.apiUrl);
    expect(buildPublicResolutionUrl(QR_ID)).not.toContain("supabase");
  });

  it("rechaza un id que no es uuid", () => {
    expect(() => buildPublicResolutionUrl("no-es-uuid")).toThrow(/UUID/);
    expect(() => buildPublicResolutionUrl("")).toThrow(/UUID/);
  });
});
