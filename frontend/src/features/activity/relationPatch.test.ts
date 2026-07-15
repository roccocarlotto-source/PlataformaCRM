import { describe, expect, it } from "vitest";
import {
  buildCreateRelationFields,
  buildRelationPatch,
  hasAtLeastOneRelation,
  type RelationState,
} from "./relationPatch";

describe("hasAtLeastOneRelation", () => {
  it("true si al menos una relación tiene valor", () => {
    expect(hasAtLeastOneRelation({ companyId: "A", contactId: null, opportunityId: null })).toBe(
      true,
    );
    expect(hasAtLeastOneRelation({ companyId: null, contactId: "B", opportunityId: null })).toBe(
      true,
    );
    expect(hasAtLeastOneRelation({ companyId: null, contactId: null, opportunityId: "O" })).toBe(
      true,
    );
  });

  it("Company + Contact simultáneas es válido (no hay exclusividad)", () => {
    expect(hasAtLeastOneRelation({ companyId: "A", contactId: "B", opportunityId: null })).toBe(
      true,
    );
  });

  it("Company + Opportunity simultáneas es válido", () => {
    expect(hasAtLeastOneRelation({ companyId: "A", contactId: null, opportunityId: "O" })).toBe(
      true,
    );
  });

  it("Contact + Opportunity simultáneas es válido", () => {
    expect(hasAtLeastOneRelation({ companyId: null, contactId: "B", opportunityId: "O" })).toBe(
      true,
    );
  });

  it("las tres simultáneas es válido", () => {
    expect(hasAtLeastOneRelation({ companyId: "A", contactId: "B", opportunityId: "O" })).toBe(
      true,
    );
  });

  it("false si las tres están vacías", () => {
    expect(hasAtLeastOneRelation({ companyId: null, contactId: null, opportunityId: null })).toBe(
      false,
    );
  });
});

describe("buildRelationPatch", () => {
  it("caso 1 del informe: agrega Contact sin tocar Company — patch = { contactId }", () => {
    const original: RelationState = { companyId: "A", contactId: null, opportunityId: null };
    const current: RelationState = { companyId: "A", contactId: "B", opportunityId: null };

    expect(buildRelationPatch(original, current)).toEqual({ contactId: "B" });
  });

  it("caso 2 del informe: limpia Company y agrega Contact — patch = { companyId: null, contactId }", () => {
    const original: RelationState = { companyId: "A", contactId: null, opportunityId: null };
    const current: RelationState = { companyId: null, contactId: "B", opportunityId: null };

    expect(buildRelationPatch(original, current)).toEqual({ companyId: null, contactId: "B" });
  });

  it("caso 3 del informe: limpia Company manteniendo Contact — patch = { companyId: null } solamente", () => {
    const original: RelationState = { companyId: "A", contactId: "B", opportunityId: null };
    const current: RelationState = { companyId: null, contactId: "B", opportunityId: null };

    expect(buildRelationPatch(original, current)).toEqual({ companyId: null });
  });

  it("sin cambios: patch vacío, ninguna clave viaja", () => {
    const original: RelationState = { companyId: "A", contactId: "B", opportunityId: null };
    const current: RelationState = { companyId: "A", contactId: "B", opportunityId: null };

    expect(buildRelationPatch(original, current)).toEqual({});
  });

  it("cambiar Contact → Opportunity sin tocar Company: solo contactId y opportunityId viajan", () => {
    const original: RelationState = { companyId: "A", contactId: "B", opportunityId: null };
    const current: RelationState = { companyId: "A", contactId: null, opportunityId: "O" };

    expect(buildRelationPatch(original, current)).toEqual({
      contactId: null,
      opportunityId: "O",
    });
  });

  it("agregar una tercera relación sin tocar las otras dos: solo la nueva viaja", () => {
    const original: RelationState = { companyId: "A", contactId: "B", opportunityId: null };
    const current: RelationState = { companyId: "A", contactId: "B", opportunityId: "O" };

    expect(buildRelationPatch(original, current)).toEqual({ opportunityId: "O" });
  });

  it("revertir un campo a su valor original produce el mismo resultado que nunca tocarlo (omitido)", () => {
    const original: RelationState = { companyId: "A", contactId: null, opportunityId: null };
    const current: RelationState = { companyId: "A", contactId: null, opportunityId: null };

    expect(buildRelationPatch(original, current)).toEqual({});
  });
});

describe("buildCreateRelationFields", () => {
  it("incluye solo las relaciones con valor, nunca null", () => {
    const state: RelationState = { companyId: "A", contactId: null, opportunityId: null };
    expect(buildCreateRelationFields(state)).toEqual({ companyId: "A" });
  });

  it("múltiples relaciones con valor viajan todas", () => {
    const state: RelationState = { companyId: "A", contactId: "B", opportunityId: "O" };
    expect(buildCreateRelationFields(state)).toEqual({
      companyId: "A",
      contactId: "B",
      opportunityId: "O",
    });
  });

  it("estado vacío produce un objeto vacío (sin claves null)", () => {
    const state: RelationState = { companyId: null, contactId: null, opportunityId: null };
    const result = buildCreateRelationFields(state);
    expect(result).toEqual({});
    expect(Object.keys(result)).toHaveLength(0);
  });
});
