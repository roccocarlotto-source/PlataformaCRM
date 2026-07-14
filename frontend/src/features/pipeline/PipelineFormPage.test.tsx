import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makePipeline } from "../../test/pipelineFixtures";
import { PipelineFormPage } from "./PipelineFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/pipelines`;

function renderForm(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/pipelines/new" element={<PipelineFormPage />} />
          <Route path="/pipelines/:id/edit" element={<PipelineFormPage />} />
          <Route path="/pipelines" element={<div>lista de pipelines</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PipelineFormPage", () => {
  it("P19 create mode: no pide detail, submit usa create con isDefault, navega tras el éxito", async () => {
    let getDetailCalled = false;
    let postedBody: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, () => {
        getDetailCalled = true;
        return HttpResponse.json(makePipeline());
      }),
      http.post(baseUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makePipeline({ name: "Ventas Nueva" }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/new");

    expect(getDetailCalled).toBe(false);

    await user.type(screen.getByLabelText("Nombre"), "Ventas Nueva");
    await user.click(screen.getByLabelText("Default"));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de pipelines")).toBeInTheDocument());
    expect(getDetailCalled).toBe(false);
    expect(postedBody).toEqual({ name: "Ventas Nueva", isDefault: true });
  });

  it("P20 edit mode: carga detail, hidrata isDefault, submit usa update sobre el id correcto, navega tras el éxito", async () => {
    let patchedId: string | undefined;
    let patchedBody: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makePipeline({ id: params.id as string, name: "Ventas Original", isDefault: true }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request, params }) => {
        patchedId = params.id as string;
        patchedBody = await request.json();
        return HttpResponse.json(makePipeline({ id: "pl1", name: "Ventas Editada" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/pl1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Ventas Original"));
    expect(screen.getByLabelText("Default")).toBeChecked();

    // Decisión A: el checkbox del default actual se puede desmarcar
    // libremente, sin restricción de UX.
    await user.click(screen.getByLabelText("Default"));
    expect(screen.getByLabelText("Default")).not.toBeChecked();

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Ventas Editada");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de pipelines")).toBeInTheDocument());
    expect(patchedId).toBe("pl1");
    expect(patchedBody).toEqual({ name: "Ventas Editada", isDefault: false });
  });

  it("P21 error de detail muestra error y no presenta el form como create vacío", async () => {
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "no existe" } }, { status: 404 }),
      ),
    );

    renderForm("/pipelines/pl1/edit");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no existe"));
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });

  it("P22 error de mutation (409 nombre duplicado) se muestra visible y no navega", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json(
          { error: { message: "Ya existe un pipeline con ese nombre en esta organización" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/pipelines/new");

    await user.type(screen.getByLabelText("Nombre"), "Ventas");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ya existe un pipeline con ese nombre en esta organización",
      ),
    );
    expect(screen.queryByText("lista de pipelines")).not.toBeInTheDocument();
  });
});
