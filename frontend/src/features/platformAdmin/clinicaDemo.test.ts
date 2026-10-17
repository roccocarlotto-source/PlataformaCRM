import { describe, expect, it } from "vitest";
import { esClinicaDemo, esDemo } from "./clinicaDemo";

// La misma regla que esSlugDeClinicaDemo del backend, más el rubro.
describe("esClinicaDemo", () => {
  it("una clínica con slug clinica-demo o clinica-demo-<sufijo>", () => {
    expect(esClinicaDemo({ slug: "clinica-demo", industry: "CLINICA" })).toBe(true);
    expect(esClinicaDemo({ slug: "clinica-demo-norte", industry: "CLINICA" })).toBe(true);
  });

  it("nada más: otro slug o una automotora", () => {
    expect(esClinicaDemo({ slug: "clinica-demonio", industry: "CLINICA" })).toBe(false);
    expect(esClinicaDemo({ slug: "mi-clinica-demo", industry: "CLINICA" })).toBe(false);
    expect(esClinicaDemo({ slug: "clinica-centro", industry: "CLINICA" })).toBe(false);
    expect(esClinicaDemo({ slug: "clinica-demo-norte", industry: "AUTOMOTORA" })).toBe(false);
  });
});

// El botón de reinicio (docs/taller-demo.md §4): toda organización en modo
// demo, y una Clínica Demo por su slug aunque el backend no mande isDemo.
describe("esDemo", () => {
  it("con isDemo, cualquier rubro; sin isDemo, solo la Clínica Demo por su slug", () => {
    expect(esDemo({ slug: "taller-demo", industry: "AUTOMOTORA", isDemo: true })).toBe(true);
    expect(esDemo({ slug: "clinica-demo-norte", industry: "CLINICA" })).toBe(true);
    expect(esDemo({ slug: "taller-demo", industry: "AUTOMOTORA", isDemo: false })).toBe(false);
    expect(esDemo({ slug: "taller-demo", industry: "AUTOMOTORA" })).toBe(false);
  });
});
