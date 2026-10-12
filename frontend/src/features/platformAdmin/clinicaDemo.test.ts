import { describe, expect, it } from "vitest";
import { esClinicaDemo } from "./clinicaDemo";

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
