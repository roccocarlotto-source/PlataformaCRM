import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { MetaConnectionSection } from "./MetaConnectionSection";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// ---------------------------------------------------------------------------
// La sección "Facebook e Instagram" de Configuración → Organización, SOLO
// INFORMATIVA desde el 02/10/2026: conectar y desconectar lo hace el platform
// admin (features/platformAdmin/OrganizationMetaConnectionCard.test.tsx). La
// sección no depende del rol, así que "sin botones" vale para todos; la
// página completa lo fija también con ADMIN (OrganizationSettingsPage.test).
// ---------------------------------------------------------------------------

const baseUrl = `${env.apiUrl}/api/integrations/meta`;

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MetaConnectionSection />
    </QueryClientProvider>,
  );
}

function conexion(overrides: Record<string, unknown> = {}) {
  return {
    id: "mc1",
    organizationId: "org-1",
    pageId: "104857600000001",
    instagramBusinessAccountId: "17841400000000001",
    status: "ACTIVE",
    lastErrorAt: null,
    lastErrorMessage: null,
    connectedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("MetaConnectionSection (solo lectura)", () => {
  it("conectada: muestra la página y el Instagram, sin ningún botón", async () => {
    server.use(http.get(baseUrl, () => HttpResponse.json(conexion())));
    renderSection();

    expect(await screen.findByText("Conectada")).toBeInTheDocument();
    expect(screen.getByText("104857600000001")).toBeInTheDocument();
    expect(screen.getByText("17841400000000001")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("conectada sin Instagram vinculado lo dice", async () => {
    server.use(
      http.get(baseUrl, () => HttpResponse.json(conexion({ instagramBusinessAccountId: null }))),
    );
    renderSection();

    expect(await screen.findByText(/sin cuenta vinculada/)).toBeInTheDocument();
  });

  it.each([
    [
      "nunca se conectó (404)",
      () => HttpResponse.json({ error: { message: "x" } }, { status: 404 }),
    ],
    ["se desconectó (REVOKED)", () => HttpResponse.json(conexion({ status: "REVOKED" }))],
  ])(
    "%s: dice que la configura la plataforma, sin botón para conectar",
    async (_caso, respuesta) => {
      server.use(http.get(baseUrl, respuesta));
      renderSection();

      expect(await screen.findByText("Sin conectar")).toBeInTheDocument();
      expect(
        screen.getByText(
          /La conexión con Facebook e Instagram la configura el equipo de la plataforma/,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it("una conexión en ERROR dice por qué y que avise a la plataforma, sin botón", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json(
          conexion({ status: "ERROR", lastErrorMessage: "El token de la página venció" }),
        ),
      ),
    );
    renderSection();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La conexión con Facebook dejó de funcionar: El token de la página venció",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/equipo de la plataforma/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
