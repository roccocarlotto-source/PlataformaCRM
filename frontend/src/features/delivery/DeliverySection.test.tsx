import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeDelivery } from "../../test/deliveryFixtures";
import { DeliverySection } from "./DeliverySection";
import type { Delivery } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const deliveriesUrl = `${env.apiUrl}/api/deliveries`;

afterEach(() => {
  vi.restoreAllMocks();
});

// Backend en memoria: GET devuelve la entrega actual y cada PATCH la cambia
// con la misma regla que el service real (las dos formas excluyentes; la
// confirmación pone quién y cuándo). Cada test puede leer los bodies recibidos
// y cuántos GET hubo.
function fakeBackend(initial: Delivery | null) {
  let delivery = initial;
  const received: unknown[] = [];
  const gets = { count: 0 };

  server.use(
    http.get(deliveriesUrl, ({ request }) => {
      gets.count += 1;
      expect(new URL(request.url).searchParams.get("opportunityId")).toBe("op1");
      return HttpResponse.json({ data: delivery ? [delivery] : [] });
    }),
    http.patch(`${deliveriesUrl}/:id`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      received.push(body);
      if (!delivery) return HttpResponse.json({}, { status: 404 });
      if (body.status === "DELIVERED") {
        delivery = {
          ...delivery,
          status: "DELIVERED",
          deliveredAt: "2026-09-20T14:30:00.000Z",
          deliveredById: "u1",
          deliveredBy: { id: "u1", fullName: "Ana Pérez" },
          vehicle: delivery.vehicle ? { ...delivery.vehicle, status: "DELIVERED" } : null,
        };
      } else {
        delivery = {
          ...delivery,
          ...(body.checklist !== undefined
            ? { checklist: body.checklist as Delivery["checklist"] }
            : {}),
          ...(body.scheduledAt !== undefined
            ? {
                scheduledAt: body.scheduledAt ? `${String(body.scheduledAt)}T00:00:00.000Z` : null,
              }
            : {}),
        };
      }
      return HttpResponse.json(delivery);
    }),
  );

  return { received, gets };
}

function renderSection(status: "OPEN" | "WON" | "LOST" = "WON") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DeliverySection opportunity={{ id: "op1", status }} />
    </QueryClientProvider>,
  );
}

function deliveryCard() {
  return screen.findByRole("region", { name: "Entrega" });
}

describe("DeliverySection", () => {
  it("oportunidad abierta o perdida: no pide la entrega ni muestra nada", async () => {
    const { gets } = fakeBackend(makeDelivery());
    const { container, rerender } = renderSection("OPEN");
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DeliverySection opportunity={{ id: "op1", status: "LOST" }} />
      </QueryClientProvider>,
    );

    // Un tick para que una query habilitada por error llegara a pedir.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gets.count).toBe(0);
    expect(container).toBeEmptyDOMElement();
  });

  it("ganada sin entrega (sin unidad vinculada): la lista vacía no muestra tarjeta", async () => {
    const { gets } = fakeBackend(null);
    const { container } = renderSection();

    await waitFor(() => expect(gets.count).toBe(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("pendiente: estado, unidad, checklist default sin tildar, fecha vacía y 'Confirmar entrega' habilitado", async () => {
    fakeBackend(makeDelivery());
    renderSection();

    const card = await deliveryCard();
    expect(within(card).getByText("Pendiente de entrega")).toBeInTheDocument();
    expect(
      within(card).getByText("Unidad: Toyota Corolla XEI 2022 · STK-000006"),
    ).toBeInTheDocument();
    const checkboxes = within(card).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(5);
    checkboxes.forEach((checkbox) => expect(checkbox).not.toBeChecked());
    expect(within(card).getByLabelText("Manual del vehículo")).toBeEnabled();
    expect(within(card).getByLabelText("Fecha programada")).toHaveValue("");
    expect(within(card).getByRole("button", { name: "Confirmar entrega" })).toBeEnabled();
  });

  it("tildar un ítem manda el checklist entero con ese ítem cambiado y queda tildado", async () => {
    const user = userEvent.setup();
    const { received } = fakeBackend(makeDelivery());
    renderSection();

    const card = await deliveryCard();
    await user.click(within(card).getByLabelText("Llave de repuesto"));

    await waitFor(() => expect(within(card).getByLabelText("Llave de repuesto")).toBeChecked());
    expect(received).toEqual([
      {
        checklist: [
          { label: "Documentación de transferencia", checked: false },
          { label: "Manual del vehículo", checked: false },
          { label: "Llave de repuesto", checked: true },
          { label: "Kit de herramientas / gato", checked: false },
          { label: "Service al día", checked: false },
        ],
      },
    ]);
  });

  it("agregar un ítem propio (con Enter) y quitar uno: cada uno es un PATCH con la lista nueva", async () => {
    const user = userEvent.setup();
    const { received } = fakeBackend(
      makeDelivery({ checklist: [{ label: "Manual del vehículo", checked: true }] }),
    );
    renderSection();

    const card = await deliveryCard();
    const input = within(card).getByLabelText("Agregar ítem");
    expect(within(card).getByRole("button", { name: "Agregar" })).toBeDisabled();
    await user.type(input, "  Patente provisoria {Enter}");

    expect(await within(card).findByLabelText("Patente provisoria")).not.toBeChecked();
    expect(input).toHaveValue("");
    expect(received[0]).toEqual({
      checklist: [
        { label: "Manual del vehículo", checked: true },
        { label: "Patente provisoria", checked: false },
      ],
    });

    await user.click(within(card).getByRole("button", { name: "Quitar: Manual del vehículo" }));
    await waitFor(() =>
      expect(within(card).queryByLabelText("Manual del vehículo")).not.toBeInTheDocument(),
    );
    expect(received[1]).toEqual({
      checklist: [{ label: "Patente provisoria", checked: false }],
    });
  });

  it("la fecha programada se guarda al salir del campo, sin status; vaciarla manda null", async () => {
    const { received } = fakeBackend(makeDelivery());
    renderSection();

    const card = await deliveryCard();
    const date = within(card).getByLabelText("Fecha programada");
    fireEvent.change(date, { target: { value: "2026-09-30" } });
    expect(received).toHaveLength(0);
    fireEvent.blur(date);

    await waitFor(() => expect(received).toEqual([{ scheduledAt: "2026-09-30" }]));
    await waitFor(() => expect(date).toBeEnabled());

    fireEvent.change(date, { target: { value: "" } });
    fireEvent.blur(date);
    await waitFor(() => expect(received[1]).toEqual({ scheduledAt: null }));

    // Salir del campo sin cambiar nada no manda otro PATCH.
    await waitFor(() => expect(date).toBeEnabled());
    fireEvent.blur(date);
    expect(received).toHaveLength(2);
  });

  it("confirmar pide confirmación con los ítems sin marcar; cancelar no manda nada; aceptar deja todo en solo lectura con quién y cuándo", async () => {
    const user = userEvent.setup();
    const { received } = fakeBackend(
      makeDelivery({
        checklist: [
          { label: "Documentación de transferencia", checked: true },
          { label: "Manual del vehículo", checked: false },
        ],
      }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    renderSection();

    const card = await deliveryCard();
    const confirmButton = within(card).getByRole("button", { name: "Confirmar entrega" });
    await user.click(confirmButton);
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("Quedan 1 ítem del checklist sin marcar."),
    );
    expect(received).toHaveLength(0);

    // El checklist no bloquea: con un ítem sin marcar se confirma igual.
    confirmSpy.mockReturnValueOnce(true);
    await user.click(confirmButton);

    expect(await within(card).findByText("Entregada")).toBeInTheDocument();
    expect(received).toEqual([{ status: "DELIVERED" }]);
    expect(within(card).getByText(/Entregada el .+ por Ana Pérez/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Confirmar entrega" })).toBeDisabled();
    within(card)
      .getAllByRole("checkbox")
      .forEach((checkbox) => expect(checkbox).toBeDisabled());
    expect(within(card).getByLabelText("Fecha programada")).toBeDisabled();
    expect(within(card).queryByRole("button", { name: /Quitar/ })).not.toBeInTheDocument();
    expect(within(card).queryByLabelText("Agregar ítem")).not.toBeInTheDocument();
  });

  it("ya entregada al cargar: solo lectura desde el principio", async () => {
    fakeBackend(
      makeDelivery({
        status: "DELIVERED",
        deliveredAt: "2026-09-20T14:30:00.000Z",
        deliveredBy: { id: "u1", fullName: "Ana Pérez" },
        scheduledAt: "2026-09-20T00:00:00.000Z",
      }),
    );
    renderSection();

    const card = await deliveryCard();
    expect(within(card).getByText("Entregada")).toBeInTheDocument();
    expect(within(card).getByLabelText("Fecha programada")).toHaveValue("2026-09-20");
    expect(within(card).getByRole("button", { name: "Confirmar entrega" })).toBeDisabled();
  });

  it("un 409 al confirmar se muestra en la tarjeta y la vista se refresca con el estado real", async () => {
    const user = userEvent.setup();
    let delivery = makeDelivery();
    server.use(
      http.get(deliveriesUrl, () => HttpResponse.json({ data: [delivery] })),
      http.patch(`${deliveriesUrl}/:id`, () => {
        delivery = makeDelivery({
          status: "DELIVERED",
          deliveredAt: "2026-09-20T14:30:00.000Z",
          deliveredBy: { id: "u2", fullName: "Otro Admin" },
        });
        return HttpResponse.json(
          { error: { message: "Esta entrega ya fue confirmada" } },
          { status: 409 },
        );
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSection();

    const card = await deliveryCard();
    await user.click(within(card).getByRole("button", { name: "Confirmar entrega" }));

    expect(await within(card).findByText("Esta entrega ya fue confirmada")).toBeInTheDocument();
    expect(await within(card).findByText(/por Otro Admin/)).toBeInTheDocument();
  });

  it("un error al cargar se muestra en la tarjeta", async () => {
    server.use(
      http.get(deliveriesUrl, () =>
        HttpResponse.json({ error: { message: "Falla del servidor" } }, { status: 500 }),
      ),
    );
    renderSection();

    const card = await deliveryCard();
    expect(within(card).getByText(/No pudimos cargar la entrega/)).toBeInTheDocument();
  });
});
