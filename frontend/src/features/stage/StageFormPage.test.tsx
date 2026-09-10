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

const stagesUrl = `${env.apiUrl}/api/stages`;

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
    // §13: con una probabilidad distinta de 0 el campo arranca visible, sin
    // pasar por "+ Agregar probabilidad".
    expect(screen.getByLabelText("Probabilidad (%)")).toHaveValue(62.5);
    expect(
      screen.queryByRole("button", { name: "+ Agregar probabilidad" }),
    ).not.toBeInTheDocument();
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

  // Antes de §13 el 409 de ejemplo era el de "segunda etapa ganada"; ese
  // mensaje ya no existe en el backend (la exclusividad se retiró). El caso
  // que queda es el nombre duplicado.
  it("S24 409 por nombre duplicado se muestra visible y no navega", async () => {
    server.use(
      http.post(stagesUrl, () =>
        HttpResponse.json(
          { error: { message: "Ya existe una etapa con ese nombre en este pipeline" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/stages/new");

    await user.type(screen.getByLabelText("Nombre"), "Cerrado");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ya existe una etapa con ese nombre en este pipeline",
      ),
    );
    expect(screen.queryByText("lista de etapas")).not.toBeInTheDocument();
  });

  // §13 (Parte A): "Ganada" ya no es exclusiva por pipeline. La pantalla nunca
  // lo bloqueó del lado del cliente; lo que se fija acá es que un POST con
  // isWon en un pipeline que ya tiene una etapa ganada se guarda y navega
  // como cualquier otro — sin ningún aviso ni chequeo previo.
  it("S26 una segunda etapa Ganada en el mismo pipeline se guarda sin error", async () => {
    let postedBody: unknown;
    server.use(
      http.post(stagesUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeStage({ id: "st9", name: "Entregado", isWon: true }), {
          status: 201,
        });
      }),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/stages/new");

    await user.type(screen.getByLabelText("Nombre"), "Entregado");
    await user.click(screen.getByLabelText("Ganada"));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de etapas")).toBeInTheDocument());
    expect(postedBody).toMatchObject({ isWon: true, isLost: false });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // §13 (Parte B): Probabilidad oculta por defecto.
  it("S27 creación: Probabilidad arranca oculta; '+ Agregar probabilidad' la revela con foco, el botón desaparece y el valor viaja en el POST", async () => {
    let postedBody: unknown;
    server.use(
      http.post(stagesUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeStage({ name: "Nueva" }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/stages/new");

    expect(screen.queryByLabelText("Probabilidad (%)")).not.toBeInTheDocument();
    const reveal = screen.getByRole("button", { name: "+ Agregar probabilidad" });

    await user.click(reveal);

    const probability = screen.getByLabelText("Probabilidad (%)");
    expect(probability).toHaveFocus();
    expect(probability).toHaveValue(null);
    expect(reveal).not.toBeInTheDocument();
    // step="any": las decimales que el listado muestra (37.5%) también se
    // pueden cargar acá (pendiente menor de §11, cerrado en §13).
    expect(probability).toHaveAttribute("step", "any");

    await user.type(screen.getByLabelText("Nombre"), "Nueva");
    await user.type(probability, "37.5");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de etapas")).toBeInTheDocument());
    expect(postedBody).toMatchObject({ name: "Nueva", probability: 37.5 });
  });

  it("S28 edición de una etapa con probabilidad 0 arranca con Probabilidad oculta", async () => {
    server.use(
      http.get(`${stagesUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeStage({ id: params.id as string, name: "Sin prob", probability: "0" })),
      ),
    );

    renderForm("/pipelines/pl1/stages/st1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Sin prob"));
    expect(screen.queryByLabelText("Probabilidad (%)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Agregar probabilidad" })).toBeInTheDocument();
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

  // Ítem 10 de docs/frontend-cambios-pendientes.md: el input ya era
  // `required`, pero el rótulo no tenía la marca — la señal visual no
  // coincidía con el comportamiento real.
  it("Nombre lleva la marca de obligatorio y la referencia del asterisco va una sola vez, junto a Guardar", () => {
    renderForm("/pipelines/pl1/stages/new");

    expect(screen.getByLabelText("Nombre")).toBeRequired();
    expect(screen.getByText("Nombre")).toHaveClass("ds-required");
    expect(screen.getAllByText("Los campos con asterisco (*) son obligatorios.")).toHaveLength(1);
  });
});
