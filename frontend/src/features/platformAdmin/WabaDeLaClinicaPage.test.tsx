import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { env } from "../../config/env";
import { WabaDeLaClinicaPage } from "./WabaDeLaClinicaPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// ---------------------------------------------------------------------------
// La cuenta de WhatsApp (WABA) propia de una clínica
// (docs/whatsapp-alta-clinica.md): elegir la clínica, ver si está conectada,
// conectar con el id del WABA, y el error del backend tal cual.
// ---------------------------------------------------------------------------

const CLINICA = "22222222-2222-4222-8222-222222222222";
const url = `${env.apiUrl}/api/admin/organizations/:organizationId/whatsapp-business`;

function renderPage() {
  server.use(
    http.get(`${env.apiUrl}/api/admin/organizations`, () =>
      HttpResponse.json([{ id: CLINICA, name: "Clínica Ejemplo", slug: "clinica-ejemplo" }]),
    ),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/organizations/whatsapp-business"]}>
        <WabaDeLaClinicaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function elegirClinica(user: ReturnType<typeof userEvent.setup>) {
  await chooseSelectOption(user, await screen.findByLabelText(/Organización/), "Clínica Ejemplo");
}

describe("WabaDeLaClinicaPage", () => {
  it("sin conectar: conecta con el WABA recortado y muestra cuántas plantillas mandó de nuevo", async () => {
    let body: unknown = null;
    let conectada = false;
    server.use(
      http.get(url, () =>
        HttpResponse.json({
          conexion: conectada
            ? {
                wabaId: "111111111111111",
                status: "ACTIVE",
                createdAt: "2026-10-12T00:00:00.000Z",
                updatedAt: "2026-10-12T00:00:00.000Z",
              }
            : null,
        }),
      ),
      http.put(url, async ({ request }) => {
        body = await request.json();
        conectada = true;
        return HttpResponse.json({
          conexion: {
            wabaId: "111111111111111",
            status: "ACTIVE",
            createdAt: "2026-10-12T00:00:00.000Z",
            updatedAt: "2026-10-12T00:00:00.000Z",
          },
          reglasSincronizadas: 2,
          erroresDeSincronizacion: [],
        });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await elegirClinica(user);

    expect(await screen.findByText("Sin conectar")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/ID de la cuenta de WhatsApp/), " 111111111111111 ");
    await user.click(screen.getByRole("button", { name: "Conectar" }));

    expect(await screen.findByText(/mandadas de nuevo a aprobación: 2/)).toBeInTheDocument();
    expect(body).toEqual({ wabaId: "111111111111111" });
    expect(await screen.findByText("Conectada")).toBeInTheDocument();
  });

  it("muestra el error del backend (una automotora no conecta)", async () => {
    server.use(
      http.get(url, () => HttpResponse.json({ conexion: null })),
      http.put(url, () =>
        HttpResponse.json(
          { error: { message: "Solo una clínica conecta su propio número de WhatsApp." } },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await elegirClinica(user);
    await user.type(await screen.findByLabelText(/ID de la cuenta de WhatsApp/), "111111111111111");
    await user.click(screen.getByRole("button", { name: "Conectar" }));
    expect(await screen.findByText(/Solo una clínica conecta/)).toBeInTheDocument();
  });
});
