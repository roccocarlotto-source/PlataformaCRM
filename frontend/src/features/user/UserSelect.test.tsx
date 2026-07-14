import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeUser } from "../../test/userFixtures";
import { UserSelect } from "./UserSelect";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/users`;

function renderSelect(value: string | undefined, onChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <UserSelect id="opp-owner" label="Propietario" value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("UserSelect", () => {
  it("pide isActive:true, pageSize:100, sortBy:fullName, sortOrder:asc — sin búsqueda de texto", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderSelect(undefined);

    await waitFor(() => expect(captured.length).toBeGreaterThan(0));
    expect(captured[0].searchParams.get("isActive")).toBe("true");
    expect(captured[0].searchParams.get("pageSize")).toBe("100");
    expect(captured[0].searchParams.get("sortBy")).toBe("fullName");
    expect(captured[0].searchParams.get("sortOrder")).toBe("asc");
    expect(captured[0].searchParams.has("search")).toBe(false);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renderiza un <select> con los usuarios devueltos", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [
            makeUser({ id: "u1", fullName: "Ana Pérez" }),
            makeUser({ id: "u2", fullName: "Beto Gómez" }),
          ],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      ),
    );

    renderSelect(undefined);

    await waitFor(() => expect(screen.getByText("Ana Pérez")).toBeInTheDocument());
    expect(screen.getByText("Beto Gómez")).toBeInTheDocument();
  });

  it("al elegir un usuario, llama a onChange con su id", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
    const user = userEvent.setup();
    const onChange = renderSelect(undefined);

    await waitFor(() => expect(screen.getByText("Ana Pérez")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Propietario"), "u1");

    expect(onChange).toHaveBeenCalledWith("u1");
  });

  it("muestra error si falla la carga", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "no autorizado" } }, { status: 403 }),
      ),
    );

    renderSelect(undefined);

    await waitFor(() =>
      expect(screen.getByText(/No pudimos cargar los usuarios/)).toBeInTheDocument(),
    );
  });
});
