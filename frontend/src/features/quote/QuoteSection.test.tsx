import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeQuote, makeQuoteList } from "../../test/quoteFixtures";
import { QuoteSection } from "./QuoteSection";
import type { Quote } from "./types";
import { chooseSelectOption } from "../../test/chooseSelectOption";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const quotesUrl = `${env.apiUrl}/api/quotes`;

const OPPORTUNITY = {
  id: "op1",
  title: "Corolla para Ana",
  amount: "18500.00",
  currency: "USD",
};

afterEach(() => {
  vi.restoreAllMocks();
});

// Backend en memoria: GET devuelve el estado actual y cada escritura lo
// cambia con la misma regla que el service real (la nueva supera a la activa
// en DRAFT/SENT; la activa es la más nueva no SUPERSEDED). Así el refetch que
// dispara la invalidación muestra lo que mostraría la app real, y cada test
// puede leer el último body recibido.
function fakeBackend(initial: Quote[]) {
  let quotes = [...initial];
  const received: { method: string; url: string; body: unknown }[] = [];

  function activeId() {
    return quotes.find((quote) => quote.status !== "SUPERSEDED")?.id ?? null;
  }

  server.use(
    http.get(quotesUrl, ({ request }) => {
      expect(new URL(request.url).searchParams.get("opportunityId")).toBe(OPPORTUNITY.id);
      return HttpResponse.json(makeQuoteList(quotes, activeId()));
    }),
    http.post(quotesUrl, async ({ request }) => {
      const body = (await request.json()) as {
        amount: number;
        currency: string;
        lines: { description: string; amount: number }[];
        validUntil: string | null;
      };
      received.push({ method: "POST", url: request.url, body });
      quotes = quotes.map((quote) =>
        quote.status === "DRAFT" || quote.status === "SENT"
          ? { ...quote, status: "SUPERSEDED" }
          : quote,
      );
      const created = makeQuote({
        id: `q${quotes.length + 1}`,
        amount: body.amount.toFixed(2),
        currency: body.currency,
        lines: body.lines.map((line) => ({ ...line, amount: line.amount.toFixed(2) })),
        validUntil: body.validUntil ? `${body.validUntil}T00:00:00.000Z` : null,
        createdAt: `2026-09-1${quotes.length + 1}T15:00:00.000Z`,
      });
      quotes = [created, ...quotes];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch(`${quotesUrl}/:id`, async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      received.push({ method: "PATCH", url: request.url, body });
      quotes = quotes.map((quote) =>
        quote.id === params.id
          ? typeof body.status === "string"
            ? { ...quote, status: body.status as Quote["status"] }
            : { ...quote, amount: Number(body.amount).toFixed(2) }
          : quote,
      );
      return HttpResponse.json(quotes.find((quote) => quote.id === params.id));
    }),
  );

  return { received };
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuoteSection opportunity={OPPORTUNITY} />
    </QueryClientProvider>,
  );
}

function quoteCard() {
  return screen.getByRole("region", { name: "Cotización" });
}

function historyCard() {
  return screen.getByRole("region", { name: "Historial de cotizaciones" });
}

describe("QuoteSection", () => {
  it("sin cotizaciones: estado vacío, historial vacío y solo 'Nueva cotización'", async () => {
    fakeBackend([]);
    renderSection();

    expect(
      await screen.findByText("Todavía no hay cotizaciones para esta oportunidad."),
    ).toBeInTheDocument();
    expect(within(historyCard()).getByText("No hay cotizaciones anteriores.")).toBeInTheDocument();
    expect(within(quoteCard()).getByRole("button", { name: "Nueva cotización" })).toBeEnabled();
    expect(within(quoteCard()).queryByRole("button", { name: "Imprimir" })).not.toBeInTheDocument();
  });

  it("crear la primera: el panel arranca con el monto de la oportunidad, manda líneas con descuento negativo y la muestra como activa", async () => {
    const user = userEvent.setup();
    const { received } = fakeBackend([]);
    renderSection();

    await user.click(await screen.findByRole("button", { name: "Nueva cotización" }));
    const panel = screen.getByRole("dialog", { name: "Nueva cotización" });
    expect(within(panel).getByLabelText(/Precio ofertado/)).toHaveValue("18.500");
    // Sin activa no hay nada que reemplazar: sin aviso.
    expect(within(panel).queryByText(/pasa al historial/)).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Agregar línea" }));
    await user.type(within(panel).getByLabelText("Descripción"), "Descuento contado");
    await chooseSelectOption(user, within(panel).getByLabelText("Tipo"), "Descuento");
    await user.type(within(panel).getByLabelText("Importe"), "500");
    await user.click(within(panel).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].body).toEqual({
      opportunityId: "op1",
      amount: 18500,
      currency: "USD",
      lines: [{ description: "Descuento contado", amount: -500 }],
      validUntil: null,
    });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Nueva cotización" })).not.toBeInTheDocument(),
    );
    const card = quoteCard();
    expect(await within(card).findByText("Borrador")).toBeInTheDocument();
    expect(within(card).getByText("Descuento contado")).toBeInTheDocument();
    expect(within(card).getByText("−500 USD")).toBeInTheDocument();
    // Total: 18.500 − 500.
    expect(within(card).getByText("18.000 USD")).toBeInTheDocument();
  });

  it("el formulario no deja guardar una línea sin descripción y no manda nada", async () => {
    const user = userEvent.setup();
    const { received } = fakeBackend([]);
    renderSection();

    await user.click(await screen.findByRole("button", { name: "Nueva cotización" }));
    const panel = screen.getByRole("dialog", { name: "Nueva cotización" });
    await user.click(within(panel).getByRole("button", { name: "Agregar línea" }));
    await user.click(within(panel).getByRole("button", { name: "Guardar" }));

    expect(
      await within(panel).findByText("La línea 1 necesita una descripción."),
    ).toBeInTheDocument();
    expect(received).toHaveLength(0);
  });

  it("activa en borrador: Enviar, Editar, Nueva cotización e Imprimir — sin aceptar ni rechazar; Enviar manda solo el status", async () => {
    const user = userEvent.setup();
    const { received } = fakeBackend([makeQuote({ id: "q1", status: "DRAFT" })]);
    renderSection();

    const card = quoteCard();
    const enviar = await within(card).findByRole("button", { name: "Enviar" });
    expect(within(card).getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Nueva cotización" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "Imprimir" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Marcar aceptada" })).not.toBeInTheDocument();
    expect(
      within(card).queryByRole("button", { name: "Marcar rechazada" }),
    ).not.toBeInTheDocument();

    await user.click(enviar);
    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ method: "PATCH", body: { status: "SENT" } });
    expect(received[0].url).toMatch(/\/api\/quotes\/q1$/);
    expect(await within(card).findByText("Enviada")).toBeInTheDocument();
  });

  it("editar el borrador: el panel trae lo guardado y el PATCH manda contenido, nunca status", async () => {
    const user = userEvent.setup();
    const { received } = fakeBackend([
      makeQuote({ id: "q1", status: "DRAFT", validUntil: "2026-09-30T00:00:00.000Z" }),
    ]);
    renderSection();

    await user.click(await within(quoteCard()).findByRole("button", { name: "Editar" }));
    const panel = screen.getByRole("dialog", { name: "Editar cotización" });
    expect(within(panel).getByLabelText("Válida hasta")).toHaveValue("2026-09-30");

    const precio = within(panel).getByLabelText(/Precio ofertado/);
    await user.clear(precio);
    await user.type(precio, "24000");
    await user.click(within(panel).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].body).toEqual({
      amount: 24000,
      currency: "USD",
      lines: [],
      validUntil: "2026-09-30",
    });
    expect(received[0].body).not.toHaveProperty("status");
  });

  it("activa enviada: aceptar pide confirmación; cancelar no manda nada, confirmar manda ACCEPTED y bloquea crear otra", async () => {
    const user = userEvent.setup();
    const { received } = fakeBackend([makeQuote({ id: "q1", status: "SENT" })]);
    renderSection();

    const card = quoteCard();
    const aceptar = await within(card).findByRole("button", { name: "Marcar aceptada" });
    expect(within(card).getByRole("button", { name: "Marcar rechazada" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Enviar" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await user.click(aceptar);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(0);

    confirmSpy.mockReturnValueOnce(true);
    await user.click(aceptar);
    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].body).toEqual({ status: "ACCEPTED" });

    expect(await within(card).findByText("Aceptada")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Nueva cotización" })).toBeDisabled();
    expect(
      within(card).getByText(/no se pueden crear cotizaciones nuevas para esta oportunidad/),
    ).toBeInTheDocument();
  });

  it("activa rechazada o vencida: solo Nueva cotización e Imprimir", async () => {
    fakeBackend([makeQuote({ id: "q1", status: "EXPIRED" })]);
    renderSection();

    const card = quoteCard();
    expect(await within(card).findByText("Vencida")).toBeInTheDocument();
    const botones = within(card)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(botones).toEqual(["Nueva cotización", "Imprimir"]);
    expect(within(card).getByRole("button", { name: "Nueva cotización" })).toBeEnabled();
  });

  it("nueva cotización sobre una enviada: avisa que la vigente pasa al historial, arranca de ella, y al guardar la anterior aparece en el historial", async () => {
    const user = userEvent.setup();
    fakeBackend([
      makeQuote({
        id: "q1",
        status: "SENT",
        amount: "25000.00",
        lines: [{ description: "Polarizado", amount: "350.00" }],
      }),
    ]);
    renderSection();

    await user.click(await within(quoteCard()).findByRole("button", { name: "Nueva cotización" }));
    const panel = screen.getByRole("dialog", { name: "Nueva cotización" });
    expect(within(panel).getByText(/pasa al historial como reemplazada/)).toBeInTheDocument();
    expect(within(panel).getByLabelText("Descripción")).toHaveValue("Polarizado");

    const precio = within(panel).getByLabelText(/Precio ofertado/);
    expect(precio).toHaveValue("25.000");
    await user.clear(precio);
    await user.type(precio, "24000");
    await user.click(within(panel).getByRole("button", { name: "Guardar" }));

    const entradas = await within(historyCard()).findAllByRole("listitem");
    expect(entradas).toHaveLength(1);
    expect(entradas[0]).toHaveTextContent("25.350 USD · Reemplazada");
    expect(await within(quoteCard()).findByText("Borrador")).toBeInTheDocument();
    expect(within(quoteCard()).getByText("24.350 USD")).toBeInTheDocument();
  });

  it("historial: todas menos la activa, más nueva primero, en solo lectura (sin acciones)", async () => {
    fakeBackend([
      makeQuote({ id: "q3", status: "DRAFT", createdAt: "2026-09-12T15:00:00.000Z" }),
      makeQuote({
        id: "q2",
        status: "REJECTED",
        amount: "24000.00",
        createdAt: "2026-09-11T15:00:00.000Z",
      }),
      makeQuote({
        id: "q1",
        status: "SUPERSEDED",
        amount: "25000.00",
        createdAt: "2026-09-10T15:00:00.000Z",
      }),
    ]);
    renderSection();

    const history = await screen.findByRole("region", { name: "Historial de cotizaciones" });
    const entradas = await within(history).findAllByRole("listitem");
    expect(entradas).toHaveLength(2);
    expect(entradas[0]).toHaveTextContent("24.000 USD · Rechazada");
    expect(entradas[1]).toHaveTextContent("25.000 USD · Reemplazada");
    expect(within(history).queryByRole("button")).not.toBeInTheDocument();
  });

  it("un 409 del backend se muestra en la tarjeta y la vista se refresca con el estado real", async () => {
    const user = userEvent.setup();
    let status: Quote["status"] = "SENT";
    server.use(
      http.get(quotesUrl, () =>
        HttpResponse.json(makeQuoteList([makeQuote({ id: "q1", status })], "q1")),
      ),
      http.patch(`${quotesUrl}/:id`, () => {
        status = "EXPIRED";
        return HttpResponse.json({ error: { message: "Esta cotización venció" } }, { status: 409 });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSection();

    const card = quoteCard();
    await user.click(await within(card).findByRole("button", { name: "Marcar rechazada" }));

    expect(await within(card).findByText("Esta cotización venció")).toBeInTheDocument();
    expect(await within(card).findByText("Vencida")).toBeInTheDocument();
  });

  it("Imprimir llama a window.print", async () => {
    const user = userEvent.setup();
    fakeBackend([makeQuote({ id: "q1", status: "ACCEPTED" })]);
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderSection();

    await user.click(await within(quoteCard()).findByRole("button", { name: "Imprimir" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});
