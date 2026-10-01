import { describe, expect, it } from "vitest";
import { WIDGET_STYLES } from "./styles";

describe("WIDGET_STYLES", () => {
  it("el acento por defecto es el de la marca (--color-accent de tokens.css)", () => {
    expect(WIDGET_STYLES).toContain("--widget-accent: #3d47ad;");
  });

  it("el textarea tiene al menos 16px, para que Safari de iPhone no haga zoom al enfocarlo", () => {
    expect(WIDGET_STYLES).toMatch(/\.pcw-input \{[^}]*font-size: max\(16px, 1rem\);/);
  });

  it("el alto del panel usa dvh, con vh como respaldo", () => {
    expect(WIDGET_STYLES).toContain("max-height: calc(100dvh - 110px);");
    expect(WIDGET_STYLES).toContain("height: calc(100dvh - 100px);");
  });

  it("no trae tema oscuro automático (D-5)", () => {
    expect(WIDGET_STYLES).not.toContain("prefers-color-scheme");
  });
});
