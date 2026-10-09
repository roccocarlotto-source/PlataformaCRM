import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { NewOrganizationPage } from "./NewOrganizationPage";
import type { CreateOrganizationResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const url = `${env.apiUrl}/api/admin/organizations`;
const editionsUrl = `${env.apiUrl}/api/admin/organizations/editions`;
const industriesUrl = `${env.apiUrl}/api/admin/organizations/industries`;

// Lo de hoy: el backend ofrece solo COMPLETA (ESENCIAL_HABILITADA en false).
// Cada test que necesite otra cosa lo pisa con server.use.
beforeEach(() => {
  server.use(
    http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA"] })),
    // Ídem rubros: solo AUTOMOTORA (CLINICA_HABILITADA en false).
    http.get(industriesUrl, () => HttpResponse.json({ industries: ["AUTOMOTORA"] })),
  );
});

const CREATED: CreateOrganizationResponse = {
  organization: {
    id: "org-nueva",
    name: "Automotora Pérez",
    slug: "automotora-perez",
    edition: "COMPLETA",
    industry: "AUTOMOTORA",
  },
  admin: {
    id: "u-nuevo",
    email: "juan@perez.test",
    fullName: "Juan Pérez",
    role: "ADMIN",
  },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/organizations/new"]}>
        <NewOrganizationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function completarYEnviar(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre de la organización"), "Automotora Pérez");
  await user.type(screen.getByLabelText("Nombre completo"), "Juan Pérez");
  await user.type(screen.getByLabelText("Email"), "juan@perez.test");
  await user.click(screen.getByRole("button", { name: /crear organización/i }));
}

describe("NewOrganizationPage", () => {
  it("submit: POST /api/admin/organizations con los tres campos, y al confirmar muestra nombre, slug y a quién se invitó — sin redirect", async () => {
    let postedBody: unknown;
    let authHeader: string | null = null;
    server.use(
      http.post(url, async ({ request }) => {
        postedBody = await request.json();
        authHeader = request.headers.get("authorization");
        return HttpResponse.json(CREATED, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await completarYEnviar(user);

    await waitFor(() => expect(screen.getByText("Organización creada")).toBeInTheDocument());
    expect(postedBody).toEqual({
      organizationName: "Automotora Pérez",
      adminFullName: "Juan Pérez",
      adminEmail: "juan@perez.test",
    });
    expect(authHeader).toBe("Bearer test-token");

    expect(screen.getByText("Automotora Pérez")).toBeInTheDocument();
    expect(screen.getByText("automotora-perez")).toBeInTheDocument();
    expect(screen.getByText("juan@perez.test")).toBeInTheDocument();
    expect(screen.getByText(/se envió una invitación a/i)).toBeInTheDocument();
    // El formulario desapareció: no hay redirect, pero tampoco un form a medio
    // completar debajo del resultado.
    expect(screen.queryByLabelText("Nombre de la organización")).not.toBeInTheDocument();
  });

  it("'Dar de alta otra organización' vuelve al formulario vacío", async () => {
    server.use(http.post(url, () => HttpResponse.json(CREATED, { status: 201 })));

    const user = userEvent.setup();
    renderPage();
    await completarYEnviar(user);
    await waitFor(() => expect(screen.getByText("Organización creada")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /dar de alta otra organización/i }));

    expect(screen.getByLabelText("Nombre de la organización")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.queryByText("Organización creada")).not.toBeInTheDocument();
  });

  it("error de conflicto (409) del backend se muestra tal cual y el formulario sigue ahí con lo tipeado", async () => {
    server.use(
      http.post(url, () =>
        HttpResponse.json(
          { error: { message: "Ya existe una organización con ese nombre" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await completarYEnviar(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ya existe una organización con ese nombre",
      ),
    );
    expect(screen.getByLabelText("Nombre de la organización")).toHaveValue("Automotora Pérez");
    expect(screen.queryByText("Organización creada")).not.toBeInTheDocument();
  });

  it("403 (no es platform admin) se muestra como error, no se muestra nada como creado", async () => {
    server.use(
      http.post(url, () =>
        HttpResponse.json(
          { error: { message: "No tenés permisos para realizar esta acción" } },
          { status: 403 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await completarYEnviar(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No tenés permisos para realizar esta acción",
      ),
    );
    expect(screen.queryByText("Organización creada")).not.toBeInTheDocument();
  });

  // docs/ediciones.md §10, PR 4: la llave ESENCIAL_HABILITADA vive en el
  // backend; la pantalla solo mira cuántas ediciones le ofrece.
  it("con una sola edición disponible (hoy): no hay selector y el alta no manda edition", async () => {
    let postedBody: unknown;
    server.use(
      http.post(url, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(CREATED, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await completarYEnviar(user);

    await waitFor(() => expect(screen.getByText("Organización creada")).toBeInTheDocument());
    expect(screen.queryByLabelText("Edición")).not.toBeInTheDocument();
    expect(postedBody).not.toHaveProperty("edition");
  });

  it("con dos ediciones disponibles (PR 5): selector obligatorio sin preselección, y manda la elegida", async () => {
    let postedBody: unknown;
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.post(url, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(
          { ...CREATED, organization: { ...CREATED.organization, edition: "ESENCIAL" } },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderPage();

    const selector = await screen.findByLabelText("Edición");
    expect(selector).toBeRequired();
    expect(selector).toHaveValue("");
    expect(screen.getByRole("option", { name: "Completa" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Esencial" })).toBeInTheDocument();

    await user.selectOptions(selector, "ESENCIAL");
    await completarYEnviar(user);

    await waitFor(() => expect(screen.getByText("Organización creada")).toBeInTheDocument());
    expect(postedBody).toEqual({
      organizationName: "Automotora Pérez",
      adminFullName: "Juan Pérez",
      adminEmail: "juan@perez.test",
      edition: "ESENCIAL",
    });
  });

  // docs/rubros.md §15, R3: la llave CLINICA_HABILITADA vive en el backend;
  // la pantalla solo mira cuántos rubros le ofrece, igual que con la edición.
  it("con un solo rubro disponible (hoy): no hay selector y el alta no manda industry", async () => {
    let postedBody: unknown;
    server.use(
      http.post(url, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(CREATED, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await completarYEnviar(user);

    await waitFor(() => expect(screen.getByText("Organización creada")).toBeInTheDocument());
    expect(screen.queryByLabelText("Rubro")).not.toBeInTheDocument();
    expect(postedBody).not.toHaveProperty("industry");
  });

  it("con dos rubros disponibles: selector obligatorio sin preselección, junto al de edición, y manda el elegido", async () => {
    let postedBody: unknown;
    server.use(
      http.get(editionsUrl, () => HttpResponse.json({ editions: ["COMPLETA", "ESENCIAL"] })),
      http.get(industriesUrl, () => HttpResponse.json({ industries: ["AUTOMOTORA", "CLINICA"] })),
      http.post(url, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(
          { ...CREATED, organization: { ...CREATED.organization, industry: "CLINICA" } },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderPage();

    const rubro = await screen.findByLabelText("Rubro");
    expect(rubro).toBeRequired();
    expect(rubro).toHaveValue("");
    expect(screen.getByRole("option", { name: "Automotora" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Clínica" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Edición")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Edición"), "COMPLETA");
    await user.selectOptions(rubro, "CLINICA");
    await completarYEnviar(user);

    await waitFor(() => expect(screen.getByText("Organización creada")).toBeInTheDocument());
    expect(postedBody).toEqual({
      organizationName: "Automotora Pérez",
      adminFullName: "Juan Pérez",
      adminEmail: "juan@perez.test",
      edition: "COMPLETA",
      industry: "CLINICA",
    });
  });
});
