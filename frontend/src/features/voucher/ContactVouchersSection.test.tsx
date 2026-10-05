import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { ContactVouchersSection } from "./ContactVouchersSection";
import type { Voucher } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

function voucher(id: string, overrides: Partial<Voucher>): Voucher {
  return {
    id,
    label: `Cupón ${id}`,
    status: "ACTIVE",
    expiresAt: "2026-11-03T12:00:00.000Z",
    consumedAt: null,
    createdAt: "2026-10-04T12:00:00.000Z",
    contactId: "c-1",
    opportunityId: null,
    branchId: "b1",
    origin: "MANUAL",
    publicUrl: `https://cupones.example/v/${id}`,
    ...overrides,
  };
}

function renderSection(data: Voucher[]) {
  server.use(
    http.get(`${env.apiUrl}/api/contacts/c-1/vouchers`, () => HttpResponse.json({ data })),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ContactVouchersSection contactId="c-1" />
    </QueryClientProvider>,
  );
}

describe("ContactVouchersSection", () => {
  it("lista los cupones con su estado: vigente, canjeado o vencido", async () => {
    renderSection([
      voucher("a", {}),
      voucher("b", { status: "CONSUMED", consumedAt: "2026-10-05T12:00:00.000Z" }),
      voucher("c", { status: "EXPIRED", origin: "AUTOMATION" }),
    ]);
    const lista = await screen.findByRole("list", { name: "Cupones del contacto" });
    const filas = within(lista).getAllByRole("listitem");
    expect(filas).toHaveLength(3);
    expect(within(filas[0]!).getByText("Vigente")).toBeInTheDocument();
    expect(within(filas[1]!).getByText("Canjeado")).toBeInTheDocument();
    expect(within(filas[1]!).getByText(/canjeado el/)).toBeInTheDocument();
    expect(within(filas[2]!).getByText("Vencido")).toBeInTheDocument();
    expect(within(filas[2]!).getByText(/por regla/)).toBeInTheDocument();
  });

  it("sin cupones lo dice", async () => {
    renderSection([]);
    expect(await screen.findByText("Este contacto todavía no tiene cupones.")).toBeInTheDocument();
  });
});
