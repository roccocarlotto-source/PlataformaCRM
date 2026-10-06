import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { openActionsMenu } from "../../test/openActionsMenu";
import { makeDefinicion } from "../../test/contactCustomFieldFixtures";
import { ContactCustomFieldListPage } from "./ContactCustomFieldListPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/contact-custom-fields`;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/contact-custom-fields"]}>
        <ContactCustomFieldListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// B6: la pantalla ADMIN de campos personalizados de contactos.
describe("ContactCustomFieldListPage (B6)", () => {
  it("lista los campos con tipo, opciones y si el agente puede editarlos; ofrece crear", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json([
          makeDefinicion(),
          makeDefinicion({
            id: "22222222-2222-4222-8222-222222222222",
            key: "combustible",
            label: "Combustible",
            type: "SELECT",
            options: ["Nafta", "Diésel"],
            agentEditable: false,
          }),
        ]),
      ),
    );
    renderPage();

    expect(await screen.findByText("Patente")).toBeInTheDocument();
    const fila = screen.getByText("Combustible").closest("tr");
    expect(fila).toHaveTextContent("Lista de opciones");
    expect(fila).toHaveTextContent("Nafta, Diésel");
    expect(fila).toHaveTextContent("Solo lee");
    expect(screen.getByText("Patente").closest("tr")).toHaveTextContent("Puede editar");
    expect(screen.getByRole("link", { name: /Nuevo campo/ })).toHaveAttribute(
      "href",
      "/contact-custom-fields/new",
    );
    expect(screen.getByText(/2 en uso/)).toBeInTheDocument();
  });

  it("Eliminar pregunta antes y manda el DELETE", async () => {
    let deletes = 0;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    server.use(
      http.get(baseUrl, () => HttpResponse.json(deletes === 0 ? [makeDefinicion()] : [])),
      http.delete(`${baseUrl}/:id`, ({ params }) => {
        deletes += 1;
        expect(params.id).toBe("11111111-1111-4111-8111-111111111111");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPage();

    expect(await screen.findByText("Patente")).toBeInTheDocument();
    await openActionsMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Eliminar" }));

    await waitFor(() => expect(deletes).toBe(1));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Todavía no hay campos personalizados")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});
