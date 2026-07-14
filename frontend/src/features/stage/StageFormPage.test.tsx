import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeStage } from "../../test/stageFixtures";
import { StageFormPage } from "./StageFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const stagesUrl = `${env.apiUrl}/stages`;

function renderForm(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/pipelines/:pipelineId/stages/new" element={<StageFormPage />} />
          <Route path="/pipelines/:pipelineId/stages/:stageId/edit" element={<StageFormPage />} />
          <Route path="/pipelines/:pipelineId/stages" element={<div>lista de etapas</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StageFormPage", () => {
  it("S20 create sin order: no se envía order (el backend decide el final)", async () => {
    let postedBody: unknown;
    server.use(
      http.post(stagesUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeStage({ name: "Nueva" }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/stages/new");

    await user.type(screen.getByLabelText("Nombre"), "Nueva");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de etapas")).toBeInTheDocument());
    expect(postedBody).toEqual({
      pipelineId: "pl1",
      name: "Nueva",
      isWon: false,
      isLost: false,
    });
  });

  it("S21 create con order explícito lo envía como number", async () => {
    let postedBody: unknown;
    server.use(
      http.post(stagesUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeStage({ name: "Nueva" }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/stages/new");

    await user.type(screen.getByLabelText("Nombre"), "Nueva");
    await user.type(screen.getByLabelText("Orden"), "3");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de etapas")).toBeInTheDocument());
    expect(postedBody).toMatchObject({ order: 3 });
    expect(typeof (postedBody as { order: unknown }).order).toBe("number");
  });

  it("S22 edit mode: hidrata probability como number desde el string real de la API", async () => {
    server.use(
      http.get(`${stagesUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeStage({ id: params.id as string, name: "Original", probability: "62.5" }),
        ),
      ),
      http.patch(`${stagesUrl}/:id`, () => HttpResponse.json(makeStage({ id: "st1" }))),
    );

    renderForm("/pipelines/pl1/stages/st1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Original"));
    expect(screen.getByLabelText("Probabilidad (%)")).toHaveValue(62.5);
  });

  it("S23 marcar Ganada desmarca Perdida (cortesía visual) y viceversa", async () => {
    const user = userEvent.setup();
    renderForm("/pipelines/pl1/stages/new");

    const won = screen.getByLabelText("Ganada");
    const lost = screen.getByLabelText("Perdida");

    await user.click(lost);
    expect(lost).toBeChecked();
    expect(won).not.toBeChecked();

    await user.click(won);
    expect(won).toBeChecked();
    expect(lost).not.toBeChecked();
  });

  it("S24 409 por nombre/isWon/isLost duplicado se muestra visible y no navega", async () => {
    server.use(
      http.post(stagesUrl, () =>
        HttpResponse.json(
          { error: { message: "Ya existe una etapa marcada como ganada en este pipeline" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/stages/new");

    await user.type(screen.getByLabelText("Nombre"), "Cerrado");
    await user.click(screen.getByLabelText("Ganada"));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ya existe una etapa marcada como ganada en este pipeline",
      ),
    );
    expect(screen.queryByText("lista de etapas")).not.toBeInTheDocument();
  });

  it("S25 pipelineId no aparece como campo editable y nunca se envía en el PATCH de update", async () => {
    let patchedBody: unknown;
    server.use(
      http.get(`${stagesUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeStage({ id: params.id as string, pipelineId: "pl1" })),
      ),
      http.patch(`${stagesUrl}/:id`, async ({ request }) => {
        patchedBody = await request.json();
        return HttpResponse.json(makeStage({ id: "st1" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/stages/st1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Prospecto"));
    expect(screen.queryByLabelText(/pipeline/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de etapas")).toBeInTheDocument());
    expect(patchedBody).not.toHaveProperty("pipelineId");
  });
});
