import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeActivity } from "../../test/activityFixtures";
import { makeCompany } from "../../test/companyFixtures";
import { makeContact } from "../../test/contactFixtures";
import { makeUser } from "../../test/userFixtures";
import { ActivityFormPage } from "./ActivityFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// Ver datetimeLocal.test.ts: sin @types/node en este paquete, se accede a
// process vía globalThis con un cast puntual en vez de agregar una
// dependencia nueva.
const nodeProcess = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process;

const activitiesUrl = `${env.apiUrl}/api/activities`;
const companiesUrl = `${env.apiUrl}/api/companies`;
const contactsUrl = `${env.apiUrl}/api/contacts`;
const usersUrl = `${env.apiUrl}/api/users`;

// UserSelect (assignee) se monta siempre en este form, sin `enabled`
// gating por texto — todo test necesita este handler como mínimo.
function baseHandlers() {
  return [
    http.get(usersUrl, () =>
      HttpResponse.json({
        data: [makeUser({ id: "u2", fullName: "Beto Gómez" })],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    ),
  ];
}

function renderForm(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/activities/new" element={<ActivityFormPage />} />
          <Route path="/activities/:id/edit" element={<ActivityFormPage />} />
          <Route path="/activities" element={<div>lista de actividades</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function selectCompany(user: ReturnType<typeof userEvent.setup>, name: string, id: string) {
  server.use(
    http.get(companiesUrl, () =>
      HttpResponse.json({
        data: [makeCompany({ id, name })],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    ),
  );
  await user.type(screen.getByPlaceholderText("Buscar empresa por nombre…"), name);
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
  await user.click(screen.getByText(name));
}

async function selectContact(
  user: ReturnType<typeof userEvent.setup>,
  id: string,
  firstName: string,
  lastName: string,
) {
  const fullName = `${firstName} ${lastName}`;
  server.use(
    http.get(contactsUrl, () =>
      HttpResponse.json({
        data: [makeContact({ id, firstName, lastName })],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    ),
  );
  await user.type(screen.getByPlaceholderText("Buscar contacto por nombre o email…"), firstName);
  await waitFor(() => expect(screen.getByText(fullName)).toBeInTheDocument());
  await user.click(screen.getByText(fullName));
}

describe("ActivityFormPage — create", () => {
  it("32. Tipo ofrece los 5 ActivityType reales con labels humanos", async () => {
    server.use(...baseHandlers());
    renderForm("/activities/new");

    const select = (await screen.findByLabelText("Tipo")) as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((o) => o.textContent);
    expect(optionTexts).toEqual(["Llamada", "Reunión", "Email", "Tarea", "Nota"]);
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["CALL", "MEETING", "EMAIL", "TASK", "NOTE"]);
  });

  it("41. create con una relación (Company): payload correcto, navega tras éxito", async () => {
    server.use(...baseHandlers());
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      http.post(activitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeActivity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/activities/new");

    await user.type(screen.getByLabelText("Asunto"), "Llamar a cliente");
    await selectCompany(user, "Acme Corp", "co1");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de actividades")).toBeInTheDocument());
    expect(postedBody).toMatchObject({
      type: "CALL",
      subject: "Llamar a cliente",
      companyId: "co1",
    });
    expect(postedBody).not.toHaveProperty("contactId");
    expect(postedBody).not.toHaveProperty("opportunityId");
  });

  it("42. create con múltiples relaciones (Company + Contact): ambas viajan, sin exclusividad", async () => {
    server.use(...baseHandlers());
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      http.post(activitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeActivity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/activities/new");

    await user.type(screen.getByLabelText("Asunto"), "Reunión de seguimiento");
    await selectCompany(user, "Acme Corp", "co1");
    await selectContact(user, "ct1", "Ana", "Pérez");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de actividades")).toBeInTheDocument());
    expect(postedBody).toMatchObject({ companyId: "co1", contactId: "ct1" });
  });

  it("43. create sin relaciones: submit bloqueado client-side, sin request", async () => {
    server.use(...baseHandlers());
    let postRequested = false;
    server.use(
      http.post(activitiesUrl, () => {
        postRequested = true;
        return HttpResponse.json(makeActivity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/activities/new");

    await user.type(screen.getByLabelText("Asunto"), "Sin relación");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(
        screen.getByText("Debe indicar Empresa, Contacto, Oportunidad, o una combinación de estos"),
      ).toBeInTheDocument(),
    );
    expect(postRequested).toBe(false);
  });

  it("dejar body/dueDate/completedAt/assigneeId vacíos en creación los omite del payload", async () => {
    server.use(...baseHandlers());
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      http.post(activitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeActivity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/activities/new");

    await user.type(screen.getByLabelText("Asunto"), "Nota rápida");
    await selectCompany(user, "Acme Corp", "co1");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de actividades")).toBeInTheDocument());
    expect(postedBody).not.toHaveProperty("body");
    expect(postedBody).not.toHaveProperty("dueDate");
    expect(postedBody).not.toHaveProperty("completedAt");
    expect(postedBody).not.toHaveProperty("assigneeId");
  });

  it("organizationId y authorId nunca viajan en el payload de create", async () => {
    server.use(...baseHandlers());
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      http.post(activitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeActivity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/activities/new");

    await user.type(screen.getByLabelText("Asunto"), "Nueva");
    await selectCompany(user, "Acme Corp", "co1");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody).not.toHaveProperty("organizationId");
    expect(postedBody).not.toHaveProperty("authorId");
  });

  it("datetime-local -> ISO: dueDate se serializa como instante UTC correcto", async () => {
    server.use(...baseHandlers());
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      http.post(activitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeActivity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/activities/new");

    await user.type(screen.getByLabelText("Asunto"), "Con vencimiento");
    await selectCompany(user, "Acme Corp", "co1");
    fireEvent.change(screen.getByLabelText("Vencimiento"), {
      target: { value: "2026-03-01T14:30" },
    });
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody?.dueDate).toBe(new Date("2026-03-01T14:30").toISOString());
  });

  it("error backend real (400) se muestra tal cual, sin traducir", async () => {
    server.use(...baseHandlers());
    server.use(
      http.post(activitiesUrl, () =>
        HttpResponse.json({ error: { message: "subject es requerido" } }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    renderForm("/activities/new");

    // subject vacío se bloquea por `required` del input en un navegador
    // real, pero jsdom no impide el submit programático — se fuerza el
    // envío para ejercitar el manejo de error real del backend.
    await selectCompany(user, "Acme Corp", "co1");
    const form = screen
      .getByRole("button", { name: /guardar/i })
      .closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByText("subject es requerido")).toBeInTheDocument());
  });
});

describe("ActivityFormPage — edit", () => {
  it("31. hidrata type/subject/body/companyId desde GET /activities/:id", async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${activitiesUrl}/act1`, () =>
        HttpResponse.json(
          makeActivity({
            id: "act1",
            type: "MEETING",
            subject: "Reunión de cierre",
            body: "Notas previas",
            companyId: "co1",
          }),
        ),
      ),
      http.get(`${companiesUrl}/co1`, () =>
        HttpResponse.json(makeCompany({ id: "co1", name: "Acme Corp" })),
      ),
    );
    renderForm("/activities/act1/edit");

    await waitFor(() => expect(screen.getByLabelText("Asunto")).toHaveValue("Reunión de cierre"));
    expect(screen.getByLabelText("Tipo")).toHaveValue("MEETING");
    expect(screen.getByLabelText("Notas")).toHaveValue("Notas previas");
    await waitFor(() => expect(screen.getByText(/Seleccionada:.*Acme Corp/)).toBeInTheDocument());
  });

  it("33. datetime-local hydration: dueDate/completedAt ISO se muestran en hora local, no en UTC crudo", async () => {
    const originalTz = nodeProcess.env.TZ;
    nodeProcess.env.TZ = "America/Argentina/Buenos_Aires";
    try {
      server.use(
        ...baseHandlers(),
        http.get(`${activitiesUrl}/act1`, () =>
          HttpResponse.json(
            makeActivity({
              id: "act1",
              companyId: "co1",
              dueDate: "2026-03-01T15:30:00.000Z",
              completedAt: "2026-03-02T18:00:00.000Z",
            }),
          ),
        ),
        http.get(`${companiesUrl}/co1`, () =>
          HttpResponse.json(makeCompany({ id: "co1", name: "Acme Corp" })),
        ),
      );
      renderForm("/activities/act1/edit");

      // 15:30 UTC - 3h = 12:30 local (Argentina) — nunca "15:30" (slice
      // directo del ISO UTC).
      await waitFor(() =>
        expect(screen.getByLabelText("Vencimiento")).toHaveValue("2026-03-01T12:30"),
      );
      expect(screen.getByLabelText("Completada")).toHaveValue("2026-03-02T15:00");
    } finally {
      nodeProcess.env.TZ = originalTz;
    }
  });

  it("35. timezone no UTC: round-trip completo (hidratar y volver a enviar) conserva el instante", async () => {
    const originalTz = nodeProcess.env.TZ;
    nodeProcess.env.TZ = "America/Argentina/Buenos_Aires";
    try {
      let patchedBody: Record<string, unknown> | undefined;
      server.use(
        ...baseHandlers(),
        http.get(`${activitiesUrl}/act1`, () =>
          HttpResponse.json(
            makeActivity({ id: "act1", companyId: "co1", dueDate: "2026-03-01T15:30:00.000Z" }),
          ),
        ),
        http.get(`${companiesUrl}/co1`, () =>
          HttpResponse.json(makeCompany({ id: "co1", name: "Acme Corp" })),
        ),
        http.patch(`${activitiesUrl}/act1`, async ({ request }) => {
          patchedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(makeActivity());
        }),
      );
      const user = userEvent.setup();
      renderForm("/activities/act1/edit");

      await waitFor(() =>
        expect(screen.getByLabelText("Vencimiento")).toHaveValue("2026-03-01T12:30"),
      );
      await user.click(screen.getByRole("button", { name: /guardar/i }));

      await waitFor(() => expect(patchedBody).toBeDefined());
      expect(patchedBody?.dueDate).toBe("2026-03-01T15:30:00.000Z");
    } finally {
      nodeProcess.env.TZ = originalTz;
    }
  });

  it("36/37/38/39. limpiar body/dueDate/completedAt/assigneeId envía null explícito", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${activitiesUrl}/act1`, () =>
        HttpResponse.json(
          makeActivity({
            id: "act1",
            companyId: "co1",
            body: "Notas previas",
            dueDate: "2026-03-01T15:30:00.000Z",
            completedAt: "2026-03-02T15:30:00.000Z",
            assigneeId: "u2",
          }),
        ),
      ),
      http.get(`${companiesUrl}/co1`, () =>
        HttpResponse.json(makeCompany({ id: "co1", name: "Acme Corp" })),
      ),
      http.patch(`${activitiesUrl}/act1`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeActivity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/activities/act1/edit");

    await waitFor(() => expect(screen.getByLabelText("Notas")).toHaveValue("Notas previas"));
    await user.clear(screen.getByLabelText("Notas"));
    await user.clear(screen.getByLabelText("Vencimiento"));
    await user.clear(screen.getByLabelText("Completada"));
    await user.selectOptions(screen.getByLabelText("Asignado a"), "");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody?.body).toBeNull();
    expect(patchedBody?.dueDate).toBeNull();
    expect(patchedBody?.completedAt).toBeNull();
    expect(patchedBody?.assigneeId).toBeNull();
  });

  it("44. update sin tocar relaciones: companyId/contactId/opportunityId no viajan en el PATCH", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${activitiesUrl}/act1`, () =>
        HttpResponse.json(makeActivity({ id: "act1", companyId: "co1", subject: "Original" })),
      ),
      http.get(`${companiesUrl}/co1`, () =>
        HttpResponse.json(makeCompany({ id: "co1", name: "Acme Corp" })),
      ),
      http.patch(`${activitiesUrl}/act1`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeActivity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/activities/act1/edit");

    await waitFor(() => expect(screen.getByLabelText("Asunto")).toHaveValue("Original"));
    await user.clear(screen.getByLabelText("Asunto"));
    await user.type(screen.getByLabelText("Asunto"), "Editado");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody).not.toHaveProperty("companyId");
    expect(patchedBody).not.toHaveProperty("contactId");
    expect(patchedBody).not.toHaveProperty("opportunityId");
    expect(patchedBody?.subject).toBe("Editado");
  });

  it("45. agregar Contact sin tocar Company ya seleccionada: patch = { contactId }, sin companyId", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${activitiesUrl}/act1`, () =>
        HttpResponse.json(makeActivity({ id: "act1", companyId: "co1" })),
      ),
      http.get(`${companiesUrl}/co1`, () =>
        HttpResponse.json(makeCompany({ id: "co1", name: "Acme Corp" })),
      ),
      http.patch(`${activitiesUrl}/act1`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeActivity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/activities/act1/edit");

    await waitFor(() => expect(screen.getByText(/Seleccionada:.*Acme Corp/)).toBeInTheDocument());
    await selectContact(user, "ct1", "Ana", "Pérez");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody).toEqual(expect.objectContaining({ contactId: "ct1" }));
    expect(patchedBody).not.toHaveProperty("companyId");
  });

  it("46. limpiar Company manteniendo Contact: patch = { companyId: null } solamente", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${activitiesUrl}/act1`, () =>
        HttpResponse.json(makeActivity({ id: "act1", companyId: "co1", contactId: "ct1" })),
      ),
      http.get(`${companiesUrl}/co1`, () =>
        HttpResponse.json(makeCompany({ id: "co1", name: "Acme Corp" })),
      ),
      http.get(`${contactsUrl}/ct1`, () => HttpResponse.json(makeContact({ id: "ct1" }))),
      http.patch(`${activitiesUrl}/act1`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeActivity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/activities/act1/edit");

    await waitFor(() => expect(screen.getByText("Quitar empresa")).toBeInTheDocument());
    await user.click(screen.getByText("Quitar empresa"));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody).not.toHaveProperty("contactId");
    expect(patchedBody?.companyId).toBeNull();
  });

  it("47. limpiar Company y establecer Contact en el mismo PATCH", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${activitiesUrl}/act1`, () =>
        HttpResponse.json(makeActivity({ id: "act1", companyId: "co1" })),
      ),
      http.get(`${companiesUrl}/co1`, () =>
        HttpResponse.json(makeCompany({ id: "co1", name: "Acme Corp" })),
      ),
      http.patch(`${activitiesUrl}/act1`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeActivity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/activities/act1/edit");

    await waitFor(() => expect(screen.getByText("Quitar empresa")).toBeInTheDocument());
    await user.click(screen.getByText("Quitar empresa"));
    await selectContact(user, "ct1", "Ana", "Pérez");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody).toEqual(expect.objectContaining({ companyId: null, contactId: "ct1" }));
  });

  it("48. intentar limpiar la última relación restante: submit bloqueado, sin PATCH", async () => {
    let patchRequested = false;
    server.use(
      ...baseHandlers(),
      http.get(`${activitiesUrl}/act1`, () =>
        HttpResponse.json(makeActivity({ id: "act1", companyId: "co1" })),
      ),
      http.get(`${companiesUrl}/co1`, () =>
        HttpResponse.json(makeCompany({ id: "co1", name: "Acme Corp" })),
      ),
      http.patch(`${activitiesUrl}/act1`, () => {
        patchRequested = true;
        return HttpResponse.json(makeActivity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/activities/act1/edit");

    await waitFor(() => expect(screen.getByText("Quitar empresa")).toBeInTheDocument());
    await user.click(screen.getByText("Quitar empresa"));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(
        screen.getByText("Debe indicar Empresa, Contacto, Oportunidad, o una combinación de estos"),
      ).toBeInTheDocument(),
    );
    expect(patchRequested).toBe(false);
  });

  it("49. 400 real de activities_related_entity_check (carrera T-1) se muestra tal cual", async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${activitiesUrl}/act1`, () =>
        HttpResponse.json(makeActivity({ id: "act1", companyId: "co1" })),
      ),
      http.get(`${companiesUrl}/co1`, () =>
        HttpResponse.json(makeCompany({ id: "co1", name: "Acme Corp" })),
      ),
      http.patch(`${activitiesUrl}/act1`, () =>
        HttpResponse.json(
          {
            error: {
              message:
                "La actividad debe estar relacionada a una Company, un Contact, o una Opportunity",
            },
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm("/activities/act1/edit");

    await waitFor(() => expect(screen.getByText(/Seleccionada:.*Acme Corp/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "La actividad debe estar relacionada a una Company, un Contact, o una Opportunity",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("60. CompanySelect/ContactSelect reutilizados sin modificación funcionan dentro de ActivityFormPage", async () => {
    server.use(...baseHandlers());
    const user = userEvent.setup();
    renderForm("/activities/new");

    await user.type(screen.getByLabelText("Asunto"), "Integración");
    await selectCompany(user, "Acme Corp", "co1");
    await selectContact(user, "ct1", "Ana", "Pérez");

    expect(screen.getByText(/Seleccionada:.*Acme Corp/)).toBeInTheDocument();
    expect(screen.getByText(/Seleccionado:.*Ana Pérez/)).toBeInTheDocument();
  });

  it("emptyOptionLabel de UserSelect en Activity es 'Sin asignar', no el texto de Opportunity", async () => {
    server.use(...baseHandlers());
    renderForm("/activities/new");

    await screen.findByText("Sin asignar");
    expect(screen.queryByText("Asignado a quien crea (por defecto)")).not.toBeInTheDocument();
  });
});
