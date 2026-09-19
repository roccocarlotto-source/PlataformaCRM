import { describe, expect, it, vi } from "vitest";
import { deleteInBulk } from "./bulkDelete";

describe("deleteInBulk", () => {
  it("borra todos y los devuelve como borrados", async () => {
    const deleteOne = vi.fn(async (id: string) => id);

    const { deleted, failed } = await deleteInBulk(["a", "b", "c"], deleteOne);

    expect(deleteOne.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c"]);
    expect(deleted).toEqual(["a", "b", "c"]);
    expect(failed).toEqual([]);
  });

  it("uno que falla NO aborta los demás, y vuelve separado", async () => {
    const intentados: string[] = [];
    const deleteOne = vi.fn(async (id: string) => {
      intentados.push(id);
      if (id === "b") throw new Error("404");
      return undefined;
    });

    const { deleted, failed } = await deleteInBulk(["a", "b", "c"], deleteOne);

    // La clave del ítem: "c" se intentó igual aunque "b" haya explotado.
    expect(intentados).toEqual(["a", "b", "c"]);
    expect(deleted).toEqual(["a", "c"]);
    expect(failed).toEqual(["b"]);
  });

  it("todos fallando no rechaza la promesa", async () => {
    const { deleted, failed } = await deleteInBulk(["a", "b"], async () => {
      throw new Error("500");
    });

    expect(deleted).toEqual([]);
    expect(failed).toEqual(["a", "b"]);
  });

  it("sin ids no llama a nada", async () => {
    const deleteOne = vi.fn(async (id: string) => id);

    const { deleted, failed } = await deleteInBulk([], deleteOne);

    expect(deleteOne).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
    expect(failed).toEqual([]);
  });
});
