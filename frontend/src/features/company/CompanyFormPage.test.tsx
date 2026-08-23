import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeCompany } from "../../test/companyFixtures";
import { CompanyFormPage } from "./CompanyFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/companies`;

function renderForm(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/companies/new" element={<CompanyFormPage />} />
          <Route path="/companies/:id/edit" element={<CompanyFormPage />} />
          <Route path="/companies" element={<div>lista de empresas</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CompanyFormPage", () => {
  it("D.15 create mode: no pide detail, submit usa create, navega tras el éxito", async () => {
    let getDetailCalled = false;
    let postedBody: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, () => {
        getDetailCalled = true;
        return HttpResponse.json(makeCompany());
      }),
      http.post(baseUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeCompany({ name: "Acme Nueva" }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/companies/new");

    expect(getDetailCalled).toBe(false);

    await user.type(screen.getByLabelText("Nombre"), "Acme Nueva");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(getDetailCalled).toBe(false);
    expect(postedBody).toEqual({ name: "Acme Nueva" });
  });

  it("D.16 edit mode: carga detail, hidrata el form, submit usa update sobre el id correcto, navega tras el éxito", async () => {
    // No usar expect() dentro del resolver de MSW: si falla, se propaga como
    // una excepción no manejada dentro de la resolución del fetch (visible
    // en la UI como "Unhandled Exception"), no como un fallo de test legible.
    // Se captura lo necesario y se asegura después, en el cuerpo del test.
    let patchedId: string | undefined;
    let patchedBody: unknown;
    server.use(
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeCompany({ id: params.id as string, name: "Acme Original", industry: "tech" }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request, params }) => {
        patchedId = params.id as string;
        patchedBody = await request.json();
        return HttpResponse.json(makeCompany({ id: "c1", name: "Acme Editada" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/companies/c1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Acme Original"));
    expect(screen.getByLabelText("Industria")).toHaveValue("tech");

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Acme Editada");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    expect(patchedId).toBe("c1");
    // El formulario envía el estado completo vigente, no un diff — industry
    // sigue en "tech" (nunca se tocó), así que viaja igual que name. Este es
    // el comportamiento real de toInput(), no algo que este test invente.
    expect(patchedBody).toEqual({ name: "Acme Editada", industry: "tech" });
  });

  it("D.17 error de detail muestra error y no presenta el form como create vacío", async () => {
    server.use(
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "no existe" } }, { status: 404 }),
      ),
    );

    renderForm("/companies/c1/edit");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no existe"));
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });

  it("D.18 error de create no navega y muestra el error", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json({ error: { message: "no se pudo crear" } }, { status: 500 }),
      ),
    );

    const user = userEvent.setup();
    renderForm("/companies/new");

    await user.type(screen.getByLabelText("Nombre"), "Acme");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("no se pudo crear"),
    );
    expect(screen.queryByText("lista de empresas")).not.toBeInTheDocument();
  });

  it("D.19 campos opcionales vacíos se envían como undefined, no como cadena vacía", async () => {
    let postedBody: unknown;
    server.use(
      http.post(baseUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeCompany({ name: "Acme" }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/companies/new");

    await user.type(screen.getByLabelText("Nombre"), "Acme");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de empresas")).toBeInTheDocument());
    // Si domain/industria/etc. viajaran como "" en vez de ausentes, este
    // toEqual fallaría — protege la semántica que toInput() ya implementaba
    // de un cambio incidental.
    expect(postedBody).toEqual({ name: "Acme" });
  });
});
