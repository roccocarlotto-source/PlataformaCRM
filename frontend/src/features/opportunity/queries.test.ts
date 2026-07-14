import { describe, expect, it } from "vitest";
import { opportunityKeys } from "./queries";

describe("opportunityKeys — key factory", () => {
  it("list(query) produce la misma key para el mismo filtro y una distinta para otro", () => {
    const a = opportunityKeys.list({ page: 1, pageSize: 20 });
    const b = opportunityKeys.list({ page: 2, pageSize: 20 });
    const c = opportunityKeys.list({ page: 1, pageSize: 20 });

    expect(a).toEqual(c);
    expect(a).not.toEqual(b);
  });

  it("detail(id) queda bajo un prefijo propio, aislado de lists()", () => {
    expect(opportunityKeys.lists()).toEqual(["opportunities", "list"]);
    expect(opportunityKeys.detail("op1")).toEqual(["opportunities", "detail", "op1"]);
  });
});
