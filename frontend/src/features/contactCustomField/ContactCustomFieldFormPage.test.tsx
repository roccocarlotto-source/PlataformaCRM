import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { makeDefinicion } from "../../test/contactCustomFieldFixtures";
import { ContactCustomFieldFormPage } from "./ContactCustomFieldFormPage";
import { opcionesDesdeTexto } from "./opciones";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/contact-custom-fields`;

function renderForm(ruta: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/contact-custom-fields/new" element={<ContactCustomFieldFormPage />} />
          <Route path="/contact-custom-fields/:id/edit" element={<ContactCustomFieldFormPage />} />
          <Route path="/contact-custom-fields" element={<p>listado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// B6: alta y edición de una definición de campo personalizado.
describe("ContactCustomFieldFormPage (B6)", () => {
  it("crea una lista: etiqueta, tipo, opciones una por renglón y editable por el agente, y vuelve al listado", async () => {
    let body: unknown = null;
    const user = userEvent.setup();
    server.use(
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeDefinicion({ key: "combustible", label: "Combustible" }), {
          status: 201,
        });
      }),
    );
    renderForm("/contact-custom-fields/new");

    await user.type(screen.getByLabelText("Etiqueta"), "Combustible");
    await chooseSelectOption(user, screen.getByLabelText("Tipo"), "Lista de opciones");
    await user.type(
      screen.getByLabelText("Opciones (una por renglón)"),
      "Nafta\nDiésel\n\nNafta\nGNC",
    );
    await user.click(screen.getByLabelText("Editable por el agente de IA"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({
      label: "Combustible",
      type: "SELECT",
      agentEditable: true,
      options: ["Nafta", "Diésel", "GNC"],
    });
    expect(await screen.findByText("listado")).toBeInTheDocument();
  });

  it("una lista sin opciones no se manda; un 409 del backend se muestra tal cual", async () => {
    const user = userEvent.setup();
    let posts = 0;
    server.use(
      http.post(baseUrl, () => {
        posts += 1;
        return HttpResponse.json(
          { error: { message: "Ya existe un campo personalizado con ese nombre" } },
          { status: 409 },
        );
      }),
    );
    renderForm("/contact-custom-fields/new");

    await user.type(screen.getByLabelText("Etiqueta"), "Color");
    await chooseSelectOption(user, screen.getByLabelText("Tipo"), "Lista de opciones");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("al menos una opción");
    expect(posts).toBe(0);

    await user.type(screen.getByLabelText("Opciones (una por renglón)"), "Rojo");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe un campo personalizado con ese nombre",
    );
    expect(posts).toBe(1);
  });

  it("en edición el tipo no se puede cambiar y el PATCH no lo manda", async () => {
    let body: unknown = null;
    const user = userEvent.setup();
    const id = "11111111-1111-4111-8111-111111111111";
    server.use(
      http.get(`${baseUrl}/${id}`, () => HttpResponse.json(makeDefinicion({ id }))),
      http.patch(`${baseUrl}/${id}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeDefinicion({ id, label: "Patente del auto" }));
      }),
    );
    renderForm(`/contact-custom-fields/${id}/edit`);

    await waitFor(() => expect(screen.getByLabelText("Etiqueta")).toHaveValue("Patente"));
    expect(screen.getByLabelText("Tipo")).toBeDisabled();
    await user.clear(screen.getByLabelText("Etiqueta"));
    await user.type(screen.getByLabelText("Etiqueta"), "Patente del auto");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ label: "Patente del auto", agentEditable: true });
  });

  it("opcionesDesdeTexto: una por renglón, sin vacías ni repetidas", () => {
    expect(opcionesDesdeTexto(" Nafta \n\nDiésel\nNafta\n")).toEqual(["Nafta", "Diésel"]);
    expect(opcionesDesdeTexto("")).toEqual([]);
  });
});
