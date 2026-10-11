import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { openActionsMenu } from "../../test/openActionsMenu";
import { makeDefinicion } from "../../test/contactCustomFieldFixtures";
import type { AuthContextValue } from "../../auth/AuthContext";
import { automotoraDeMe, clinicaDeMe } from "../../test/rubroFixtures";
import { ContactCustomFieldListPage } from "./ContactCustomFieldListPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(rubro: ReturnType<typeof automotoraDeMe>): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@x.com",
      fullName: "A",
      organizationId: "org-1",
      role: "ADMIN",
      isPlatformAdmin: false,
      canUseInternalAgent: false,
      ...rubro,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

beforeEach(() => {
  useAuthMock.mockReturnValue(mockAuth(automotoraDeMe("COMPLETA")));
});

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

// docs/rubros.md §8.2: en una clínica, la pantalla avisa que no se carguen
// datos de salud. Una automotora la ve como siempre.
describe("ContactCustomFieldListPage por rubro", () => {
  it("una clínica ve el aviso de no cargar datos de salud y el título con su término", async () => {
    useAuthMock.mockReturnValue(mockAuth(clinicaDeMe("COMPLETA")));
    server.use(http.get(baseUrl, () => HttpResponse.json([])));
    renderPage();

    expect(await screen.findByRole("heading", { name: "Campos de paciente" })).toBeInTheDocument();
    expect(screen.getByText("No cargues datos de salud en estos campos.")).toBeInTheDocument();
    expect(screen.getByText(/no para la historia clínica/)).toBeInTheDocument();
  });

  it("automotora sin cambios: sin el aviso y con el título de siempre", async () => {
    server.use(http.get(baseUrl, () => HttpResponse.json([])));
    renderPage();

    expect(await screen.findByRole("heading", { name: "Campos de contacto" })).toBeInTheDocument();
    expect(screen.queryByText(/datos de salud/)).not.toBeInTheDocument();
  });
});
