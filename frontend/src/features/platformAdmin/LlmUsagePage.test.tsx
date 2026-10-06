import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { LlmUsagePage } from "./LlmUsagePage";
import { formatoDeCosto } from "./llmUsageFormat";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/llm-usage"]}>
        <LlmUsagePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// B4: el gasto en el modelo por organización, de GET /api/admin/llm-usage.
describe("LlmUsagePage (B4)", () => {
  it("lista el gasto de cada organización de los últimos 30 días, con «—» cuando no hay costo informado", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/admin/llm-usage`, () =>
        HttpResponse.json({
          dias: 30,
          organizaciones: [
            {
              organizationId: "11111111-1111-4111-8111-111111111111",
              organizationName: "Automotora Feliz",
              turnos: 1234,
              promptTokens: 2500000,
              completionTokens: 180000,
              costUsd: 12.3456,
            },
            {
              organizationId: "22222222-2222-4222-8222-222222222222",
              organizationName: "Taller Norte",
              turnos: 0,
              promptTokens: 0,
              completionTokens: 0,
              costUsd: null,
            },
          ],
        }),
      ),
    );

    renderPage();

    expect(await screen.findByText("Automotora Feliz")).toBeInTheDocument();
    const fila = screen.getByText("Automotora Feliz").closest("tr");
    expect(fila).toHaveTextContent("1.234");
    expect(fila).toHaveTextContent("2.500.000");
    expect(fila).toHaveTextContent("180.000");
    expect(fila).toHaveTextContent("$12.3456");
    expect(screen.getByText("Taller Norte").closest("tr")).toHaveTextContent("—");
    expect(screen.getByText(/Últimos 30 días/)).toBeInTheDocument();
  });

  it("si la API falla, lo dice", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/admin/llm-usage`, () =>
        HttpResponse.json({ error: { message: "Forbidden" } }, { status: 403 }),
      ),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar el uso de IA");
  });

  it("formatoDeCosto: null es «—», un costo va en dólares con hasta cuatro decimales", () => {
    expect(formatoDeCosto(null)).toBe("—");
    expect(formatoDeCosto(0.0003)).toBe("$0.0003");
    expect(formatoDeCosto(12)).toBe("$12.00");
  });
});
