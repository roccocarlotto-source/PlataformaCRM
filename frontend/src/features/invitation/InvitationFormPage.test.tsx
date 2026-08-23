import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeInvitation } from "../../test/invitationFixtures";
import { InvitationFormPage } from "./InvitationFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const invitationsUrl = `${env.apiUrl}/api/invitations`;

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/invitations/new"]}>
        <Routes>
          <Route path="/invitations/new" element={<InvitationFormPage />} />
          <Route path="/invitations" element={<div>lista de invitaciones</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("InvitationFormPage", () => {
  it("envía email + role, payload exacto, sin organizationId ni roleId, navega tras éxito", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      http.post(invitationsUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeInvitation(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Email"), "nuevo@example.com");
    await user.selectOptions(screen.getByLabelText("Rol"), "ADMIN");
    await user.click(screen.getByRole("button", { name: /enviar invitación/i }));

    await waitFor(() => expect(screen.getByText("lista de invitaciones")).toBeInTheDocument());
    expect(postedBody).toEqual({ email: "nuevo@example.com", role: "ADMIN" });
  });

  it("rol default es USER si no se cambia", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      http.post(invitationsUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeInvitation(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Email"), "nuevo@example.com");
    await user.click(screen.getByRole("button", { name: /enviar invitación/i }));

    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody?.role).toBe("USER");
  });

  it("validación: email requerido (HTML5, sin submit)", async () => {
    let postRequested = false;
    server.use(
      http.post(invitationsUrl, () => {
        postRequested = true;
        return HttpResponse.json(makeInvitation(), { status: 201 });
      }),
    );
    renderForm();

    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    expect(emailInput.required).toBe(true);
    expect(postRequested).toBe(false);
  });

  it("error real del backend (409 duplicado) se muestra tal cual", async () => {
    server.use(
      http.post(invitationsUrl, () =>
        HttpResponse.json(
          { error: { message: "Ya existe una invitación pendiente para ese email" } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Email"), "dup@example.com");
    await user.click(screen.getByRole("button", { name: /enviar invitación/i }));

    await waitFor(() =>
      expect(
        screen.getByText("Ya existe una invitación pendiente para ese email"),
      ).toBeInTheDocument(),
    );
  });

  it("error real del backend (409 email ya usuario) se muestra tal cual", async () => {
    server.use(
      http.post(invitationsUrl, () =>
        HttpResponse.json(
          { error: { message: "Ese email ya pertenece a un usuario existente" } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("Email"), "existente@example.com");
    await user.click(screen.getByRole("button", { name: /enviar invitación/i }));

    await waitFor(() =>
      expect(screen.getByText("Ese email ya pertenece a un usuario existente")).toBeInTheDocument(),
    );
  });
});
