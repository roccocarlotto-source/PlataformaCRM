import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { stageKeys } from "./queries";

// S-KEY1: verifica empíricamente (no asumido) el comportamiento real de
// invalidación parcial de TanStack Query contra la key factory jerárquica
// de Stage — mismo criterio que ya se usó en M3 para la independencia de
// list/detail cache de Company (no aceptar una afirmación técnica sobre
// TanStack Query sin un test que la ejercite contra un QueryClient real).
describe("stageKeys — invalidación por pipeline (key factory)", () => {
  it("invalidar byPipeline(pipelineId) marca stale TODAS las variantes de listado de ESE pipeline, y ninguna de otro", async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(
      stageKeys.list("pipeA", { pipelineId: "pipeA", page: 1, pageSize: 20, sortBy: "order", sortOrder: "asc" }),
      { data: ["A-p1"] },
    );
    queryClient.setQueryData(
      stageKeys.list("pipeA", { pipelineId: "pipeA", page: 2, pageSize: 20, sortBy: "name", sortOrder: "desc" }),
      { data: ["A-p2"] },
    );
    queryClient.setQueryData(
      stageKeys.list("pipeB", { pipelineId: "pipeB", page: 1, pageSize: 20, sortBy: "order", sortOrder: "asc" }),
      { data: ["B-p1"] },
    );

    await queryClient.invalidateQueries({ queryKey: stageKeys.byPipeline("pipeA") });

    const staleByKey = new Map(
      queryClient.getQueryCache().getAll().map((q) => [JSON.stringify(q.queryKey), q.isStale()]),
    );

    expect(
      staleByKey.get(
        JSON.stringify(
          stageKeys.list("pipeA", { pipelineId: "pipeA", page: 1, pageSize: 20, sortBy: "order", sortOrder: "asc" }),
        ),
      ),
    ).toBe(true);
    expect(
      staleByKey.get(
        JSON.stringify(
          stageKeys.list("pipeA", { pipelineId: "pipeA", page: 2, pageSize: 20, sortBy: "name", sortOrder: "desc" }),
        ),
      ),
    ).toBe(true);
    expect(
      staleByKey.get(
        JSON.stringify(
          stageKeys.list("pipeB", { pipelineId: "pipeB", page: 1, pageSize: 20, sortBy: "order", sortOrder: "asc" }),
        ),
      ),
    ).toBe(false);
  });

  it("invalidar byPipeline(pipelineId) también alcanza stageKeys.detail(pipelineId, id) de ese pipeline", async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(stageKeys.detail("pipeA", "st1"), { id: "st1" });
    queryClient.setQueryData(stageKeys.detail("pipeB", "st2"), { id: "st2" });

    await queryClient.invalidateQueries({ queryKey: stageKeys.byPipeline("pipeA") });

    const staleByKey = new Map(
      queryClient.getQueryCache().getAll().map((q) => [JSON.stringify(q.queryKey), q.isStale()]),
    );
    expect(staleByKey.get(JSON.stringify(stageKeys.detail("pipeA", "st1")))).toBe(true);
    expect(staleByKey.get(JSON.stringify(stageKeys.detail("pipeB", "st2")))).toBe(false);
  });
});
