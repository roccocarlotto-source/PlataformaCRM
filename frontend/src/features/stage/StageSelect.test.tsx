import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeStage } from "../../test/stageFixtures";
import { StageSelect } from "./StageSelect";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/stages`;

function renderSelect(pipelineId: string | undefined, value: string | undefined, onChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <StageSelect
        id="opp-stage"
        label="Etapa"
        pipelineId={pipelineId}
        value={value}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  return { onChange, ...utils };
}

describe("StageSelect", () => {
  it("sin pipelineId: queda deshabilitado y NO dispara ningún request", async () => {
    let requestCount = 0;
    server.use(
      http.get(baseUrl, () => {
        requestCount += 1;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
    );

    renderSelect(undefined, undefined);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requestCount).toBe(0);
    expect(screen.getByLabelText("Etapa")).toBeDisabled();
  });

  it("con pipelineId: pide pageSize:100, sortBy:order, sortOrder:asc, scoped a ese pipeline", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makeStage({ id: "st1", pipelineId: "pl1", name: "Prospecto" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderSelect("pl1", undefined);

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].searchParams.get("pipelineId")).toBe("pl1");
    expect(captured[0].searchParams.get("pageSize")).toBe("100");
    expect(captured[0].searchParams.get("sortBy")).toBe("order");
    expect(captured[0].searchParams.get("sortOrder")).toBe("asc");
  });

  it("renderiza las etapas del pipeline y dispara onChange al elegir", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [
            makeStage({ id: "st1", pipelineId: "pl1", name: "Prospecto" }),
            makeStage({ id: "st2", pipelineId: "pl1", name: "Negociación" }),
          ],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      ),
    );
    const user = userEvent.setup();
    const { onChange } = renderSelect("pl1", undefined);

    await waitFor(() => expect(screen.getByText("Negociación")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Etapa"), "st2");

    expect(onChange).toHaveBeenCalledWith("st2");
  });

  it("cambiar pipelineId dispara un nuevo request scoped al pipeline nuevo", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <StageSelect id="opp-stage" label="Etapa" pipelineId="pl1" value={undefined} onChange={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(captured.length).toBe(1));
    expect(captured[0].searchParams.get("pipelineId")).toBe("pl1");

    rerender(
      <QueryClientProvider client={queryClient}>
        <StageSelect id="opp-stage" label="Etapa" pipelineId="pl2" value={undefined} onChange={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(captured.length).toBe(2));
    expect(captured[1].searchParams.get("pipelineId")).toBe("pl2");
  });

  it("muestra error si falla la carga", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "error de red" } }, { status: 500 }),
      ),
    );

    renderSelect("pl1", undefined);

    await waitFor(() =>
      expect(screen.getByText(/No pudimos cargar las etapas/)).toBeInTheDocument(),
    );
  });
});
