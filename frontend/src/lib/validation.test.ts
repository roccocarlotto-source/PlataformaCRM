import { describe, expect, it } from "vitest";
import { looksLikeUrl } from "./validation";

describe("looksLikeUrl", () => {
  it("acepta http y https absolutas", () => {
    expect(looksLikeUrl("https://g.page/r/abc/review")).toBe(true);
    expect(looksLikeUrl("http://localhost:3000/x")).toBe(true);
  });

  it("rechaza vacío, relativas, sin esquema y otros esquemas", () => {
    expect(looksLikeUrl("")).toBe(false);
    expect(looksLikeUrl("/relativa")).toBe(false);
    expect(looksLikeUrl("google.com")).toBe(false);
    expect(looksLikeUrl("javascript:alert(1)")).toBe(false);
    expect(looksLikeUrl("ftp://x.y")).toBe(false);
  });
});
