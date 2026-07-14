import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeCompany } from "../../test/companyFixtures";
import { makeContact } from "../../test/contactFixtures";
import { ContactFormPage } from "./ContactFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const contactsUrl = `${env.apiUrl}/contacts`;
const companiesUrl = `${env.apiUrl}/companies`;

function renderForm(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/contacts/new" element={<ContactFormPage />} />
          <Route path="/contacts/:id/edit" element={<ContactFormPage />} />
          <Route path="/contacts" element={<div>lista de contactos</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ContactFormPage", () => {
  it("create mode: no pide detail, submit usa create, navega tras el éxito", async () => {
    let getDetailCalled = false;
    let postedBody: unknown;
    server.use(
      http.get(`${contactsUrl}/:id`, () => {
        getDetailCalled = true;
        return HttpResponse.json(makeContact());
      }),
      http.post(contactsUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeContact({ firstName: "Nueva" }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/contacts/new");

    expect(getDetailCalled).toBe(false);

    await user.type(screen.getByLabelText("Nombre"), "Nueva");
    await user.type(screen.getByLabelText("Apellido"), "Persona");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    expect(getDetailCalled).toBe(false);
    expect(postedBody).toEqual({
      firstName: "Nueva",
      lastName: "Persona",
      lifecycleStage: "LEAD",
    });
  });

  it("edit mode: carga detail, hidrata companyId real, submit usa update sobre el id correcto, navega tras el éxito", async () => {
    let patchedId: string | undefined;
    let patchedBody: unknown;
    server.use(
      http.get(`${contactsUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeContact({
            id: params.id as string,
            firstName: "Original",
            companyId: "co-1",
          }),
        ),
      ),
      http.get(`${companiesUrl}/:id`, ({ params }) =>
        params.id === "co-1"
          ? HttpResponse.json(makeCompany({ id: "co-1", name: "Acme Corp" }))
          : HttpResponse.json({ error: { message: "no encontrada" } }, { status: 404 }),
      ),
      http.patch(`${contactsUrl}/:id`, async ({ request, params }) => {
        patchedId = params.id as string;
        patchedBody = await request.json();
        return HttpResponse.json(makeContact({ id: "ct1", firstName: "Editado" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/contacts/ct1/edit");

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Original"));
    // companyId real hidratado — se resuelve y muestra el nombre, no el UUID.
    await waitFor(() => expect(screen.getByText("Seleccionada: Acme Corp")).toBeInTheDocument());

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Editado");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de contactos")).toBeInTheDocument());
    expect(patchedId).toBe("ct1");
    expect(patchedBody).toMatchObject({ firstName: "Editado", companyId: "co-1" });
  });

  it("error de detail muestra error y no presenta el form como create vacío", async () => {
    server.use(
      http.get(`${contactsUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "no existe" } }, { status: 404 }),
      ),
    );

    renderForm("/contacts/ct1/edit");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no existe"));
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });

  it("409 por email duplicado se muestra visible y no navega", async () => {
    server.use(
      http.post(contactsUrl, () =>
        HttpResponse.json(
          { error: { message: "Ya existe un contacto con ese email en esta organización" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/contacts/new");

    await user.type(screen.getByLabelText("Nombre"), "Nueva");
    await user.type(screen.getByLabelText("Apellido"), "Persona");
    await user.type(screen.getByLabelText("Email"), "dup@example.com");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ya existe un contacto con ese email en esta organización",
      ),
    );
    expect(screen.queryByText("lista de contactos")).not.toBeInTheDocument();
  });

  it("error genérico de mutation se muestra visible y no navega", async () => {
    server.use(
      http.post(contactsUrl, () =>
        HttpResponse.json({ error: { message: "no se pudo crear" } }, { status: 500 }),
      ),
    );

    const user = userEvent.setup();
    renderForm("/contacts/new");

    await user.type(screen.getByLabelText("Nombre"), "Nueva");
    await user.type(screen.getByLabelText("Apellido"), "Persona");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("no se pudo crear"),
    );
    expect(screen.queryByText("lista de contactos")).not.toBeInTheDocument();
  });

  it("firstName y lastName son requeridos (validación HTML5 mínima)", async () => {
    renderForm("/contacts/new");

    const firstName = screen.getByLabelText("Nombre") as HTMLInputElement;
    const lastName = screen.getByLabelText("Apellido") as HTMLInputElement;

    expect(firstName).toBeRequired();
    expect(lastName).toBeRequired();
  });
});
