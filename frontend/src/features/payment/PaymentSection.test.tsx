import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { todayIsoDate } from "../opportunity/boardMove";
import { PaymentSection } from "./PaymentSection";
import type { Payment } from "./types";
import { chooseSelectOption } from "../../test/chooseSelectOption";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const paymentsUrl = `${env.apiUrl}/api/payments`;

const OPPORTUNITY = { id: "op1", amount: "25000.00", currency: "USD" };

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "p1",
    organizationId: "org-1",
    opportunityId: "op1",
    amount: "5000.00",
    currency: "USD",
    method: "TRANSFER",
    paidAt: "2026-09-10T00:00:00.000Z",
    createdAt: "2026-09-10T15:00:00.000Z",
    updatedAt: "2026-09-10T15:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// Backend en memoria: GET devuelve los pagos ordenados como el repository
// real (cobro más nuevo primero), y cada escritura los cambia. La moneda del
// POST la pone el "backend" con la de la oportunidad, igual que el service.
function fakeBackend(initial: Payment[]) {
  let payments = [...initial];
  let seq = 0;
  const received: { method: string; url: string; body: unknown }[] = [];

  function sorted() {
    return [...payments].sort((x, y) => y.paidAt.localeCompare(x.paidAt));
  }

  server.use(
    http.get(paymentsUrl, ({ request }) => {
      expect(new URL(request.url).searchParams.get("opportunityId")).toBe("op1");
      const data = sorted();
      return HttpResponse.json({
        data,
        pagination: { page: 1, pageSize: 100, total: data.length, totalPages: 1 },
      });
    }),
    http.post(paymentsUrl, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      received.push({ method: "POST", url: request.url, body });
      seq += 1;
      const payment = makePayment({
        id: `nuevo-${seq}`,
        amount: Number(body.amount).toFixed(2),
        method: body.method as Payment["method"],
        paidAt: `${String(body.paidAt)}T00:00:00.000Z`,
        currency: OPPORTUNITY.currency,
      });
      payments.push(payment);
      return HttpResponse.json(payment, { status: 201 });
    }),
    http.patch(`${paymentsUrl}/:id`, async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      received.push({ method: "PATCH", url: request.url, body });
      payments = payments.map((p) =>
        p.id === params.id
          ? {
              ...p,
              ...(body.amount !== undefined ? { amount: Number(body.amount).toFixed(2) } : {}),
              ...(body.method !== undefined ? { method: body.method as Payment["method"] } : {}),
              ...(body.paidAt !== undefined
                ? { paidAt: `${String(body.paidAt)}T00:00:00.000Z` }
                : {}),
            }
          : p,
      );
      return HttpResponse.json(payments.find((p) => p.id === params.id));
    }),
    http.delete(`${paymentsUrl}/:id`, ({ request, params }) => {
      received.push({ method: "DELETE", url: request.url, body: null });
      payments = payments.filter((p) => p.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );

  return { received };
}

function renderSection(opportunity = OPPORTUNITY) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentSection opportunity={opportunity} />
    </QueryClientProvider>,
  );
}

function paymentsCard() {
  return screen.findByRole("region", { name: "Pagos" });
}

describe("PaymentSection", () => {
  it("sin pagos: se muestra igual, con el total en cero y el saldo completo", async () => {
    fakeBackend([]);
    renderSection();
    const card = await paymentsCard();
    expect(await within(card).findByText("Todavía no se registraron pagos.")).toBeInTheDocument();
    expect(within(card).getByText(/^Pagado:/)).toHaveTextContent(
      "Pagado: 0,00 USD de 25.000,00 USD · Saldo: 25.000,00 USD",
    );
  });

  it("lista los pagos más nuevo primero, con fecha, monto en su moneda y método", async () => {
    fakeBackend([
      makePayment({ id: "viejo", paidAt: "2026-08-01T00:00:00.000Z", method: "CASH" }),
      makePayment({ id: "nuevo", paidAt: "2026-09-15T00:00:00.000Z", amount: "1500.50" }),
    ]);
    renderSection();
    const list = await screen.findByRole("list", { name: "Pagos registrados" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("1.500,50 USD");
    expect(items[0]).toHaveTextContent("Transferencia");
    expect(items[1]).toHaveTextContent("5.000,00 USD");
    expect(items[1]).toHaveTextContent("Efectivo");
  });

  it("Pagado y Saldo suman los pagos en la moneda de la oportunidad", async () => {
    fakeBackend([
      makePayment({ id: "a", amount: "5000.00" }),
      makePayment({ id: "b", amount: "2500.25", paidAt: "2026-09-11T00:00:00.000Z" }),
    ]);
    renderSection();
    const card = await paymentsCard();
    await within(card).findByRole("list", { name: "Pagos registrados" });
    expect(within(card).getByText(/^Pagado:/)).toHaveTextContent(
      "Pagado: 7.500,25 USD de 25.000,00 USD · Saldo: 17.499,75 USD",
    );
    expect(within(card).queryByText(/en otra moneda/)).not.toBeInTheDocument();
  });

  it("un pago en otra moneda se lista con la suya pero queda fuera del total, con la nota visible", async () => {
    fakeBackend([
      makePayment({ id: "usd", amount: "5000.00" }),
      makePayment({
        id: "uyu",
        amount: "200000.00",
        currency: "UYU",
        paidAt: "2026-09-12T00:00:00.000Z",
      }),
    ]);
    renderSection();
    const card = await paymentsCard();
    const list = await within(card).findByRole("list", { name: "Pagos registrados" });
    expect(within(list).getByText(/200\.000,00 UYU/)).toBeInTheDocument();
    expect(within(card).getByText(/^Pagado:/)).toHaveTextContent(
      "Pagado: 5.000,00 USD de 25.000,00 USD · Saldo: 20.000,00 USD",
    );
    expect(
      within(card).getByText("1 pago en otra moneda no incluido en el total."),
    ).toBeInTheDocument();
  });

  it("alta: el formulario arranca con la fecha de hoy, manda monto, método y fecha (sin moneda) y actualiza el total", async () => {
    const user = userEvent.setup();
    const { received } = fakeBackend([]);
    renderSection();
    const card = await paymentsCard();
    await within(card).findByText("Todavía no se registraron pagos.");

    await user.click(within(card).getByRole("button", { name: "Agregar pago" }));
    const form = within(card).getByRole("form", { name: "Pago" });
    expect(within(form).getByLabelText("Fecha")).toHaveValue(todayIsoDate());

    await user.type(within(form).getByLabelText("Monto"), "3000");
    await chooseSelectOption(user, within(form).getByLabelText("Método"), "Tarjeta");
    await user.clear(within(form).getByLabelText("Fecha"));
    await user.type(within(form).getByLabelText("Fecha"), "2026-09-14");
    await user.click(within(form).getByRole("button", { name: "Agregar" }));

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].method).toBe("POST");
    expect(received[0].body).toEqual({
      opportunityId: "op1",
      amount: 3000,
      method: "CARD",
      paidAt: "2026-09-14",
    });

    const list = await within(card).findByRole("list", { name: "Pagos registrados" });
    expect(within(list).getByText(/3\.000,00 USD · Tarjeta/)).toBeInTheDocument();
    expect(within(card).queryByRole("form", { name: "Pago" })).not.toBeInTheDocument();
    expect(within(card).getByText(/^Pagado:/)).toHaveTextContent(
      "Pagado: 3.000,00 USD de 25.000,00 USD · Saldo: 22.000,00 USD",
    );
  });

  it("alta sin monto: no llama al backend y explica qué falta", async () => {
    const user = userEvent.setup();
    const { received } = fakeBackend([]);
    renderSection();
    const card = await paymentsCard();
    await within(card).findByText("Todavía no se registraron pagos.");

    await user.click(within(card).getByRole("button", { name: "Agregar pago" }));
    await user.click(within(card).getByRole("button", { name: "Agregar" }));
    expect(await within(card).findByText("Ingresá un monto mayor a 0")).toBeInTheDocument();
    expect(received).toHaveLength(0);
  });

  it("edición: el formulario inline arranca con los valores del pago y el PATCH no manda opportunityId", async () => {
    const user = userEvent.setup();
    const { received } = fakeBackend([makePayment({ id: "p1" })]);
    renderSection();
    const card = await paymentsCard();

    await user.click(
      await within(card).findByRole("button", { name: /^Editar el pago de 5\.000,00 USD/ }),
    );
    const form = within(card).getByRole("form", { name: "Pago" });
    expect(within(form).getByLabelText("Monto")).toHaveValue("5.000,00");
    expect(within(form).getByLabelText("Método")).toHaveValue("Transferencia");
    expect(within(form).getByLabelText("Fecha")).toHaveValue("2026-09-10");

    await user.clear(within(form).getByLabelText("Monto"));
    await user.type(within(form).getByLabelText("Monto"), "4500");
    await user.click(within(form).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].method).toBe("PATCH");
    expect(received[0].url).toMatch(/\/api\/payments\/p1$/);
    expect(received[0].body).toEqual({ amount: 4500, method: "TRANSFER", paidAt: "2026-09-10" });

    expect(await within(card).findByText(/4\.500,00 USD · Transferencia/)).toBeInTheDocument();
    expect(within(card).getByText(/^Pagado:/)).toHaveTextContent("Pagado: 4.500,00 USD");
  });

  it("borrado: pide confirmación con el monto; cancelar no borra, aceptar manda el DELETE y saca el pago del total", async () => {
    const user = userEvent.setup();
    const { received } = fakeBackend([
      makePayment({ id: "p1", amount: "5000.00" }),
      makePayment({ id: "p2", amount: "1000.00", paidAt: "2026-09-12T00:00:00.000Z" }),
    ]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    renderSection();
    const card = await paymentsCard();

    const borrar = await within(card).findByRole("button", {
      name: /^Borrar el pago de 5\.000,00 USD/,
    });
    await user.click(borrar);
    expect(confirm).toHaveBeenCalledWith("¿Borrar este pago de 5.000,00 USD?");
    expect(received).toHaveLength(0);

    confirm.mockReturnValueOnce(true);
    await user.click(borrar);
    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].method).toBe("DELETE");
    expect(received[0].url).toMatch(/\/api\/payments\/p1$/);

    await waitFor(() => expect(within(card).getAllByRole("listitem")).toHaveLength(1));
    expect(within(card).getByText(/^Pagado:/)).toHaveTextContent(
      "Pagado: 1.000,00 USD de 25.000,00 USD · Saldo: 24.000,00 USD",
    );
  });

  it("un error al cargar se muestra en la tarjeta", async () => {
    server.use(http.get(paymentsUrl, () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    renderSection();
    const card = await paymentsCard();
    expect(await within(card).findByText(/No pudimos cargar los pagos/)).toBeInTheDocument();
  });
});
