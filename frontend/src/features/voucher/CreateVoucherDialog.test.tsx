import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { CreateVoucherDialog } from "./CreateVoucherDialog";
import type { Voucher } from "./types";

// "Crear cupón" a mano: el formulario, el resultado (link, QR) y "Enviar por
// WhatsApp" habilitado o no según lo que diga el backend.

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const generateQrSvgMock = vi.hoisted(() =>
  vi.fn(
    async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0"/></svg>',
  ),
);
vi.mock("../../lib/qrImage", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/qrImage")>();
  return { ...original, generateQrSvg: generateQrSvgMock };
});

afterEach(() => generateQrSvgMock.mockClear());

const api = env.apiUrl;
const VOUCHER_ID = "7c0e0a0e-1111-4111-8111-111111111111";

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: VOUCHER_ID,
    label: "15% en el taller",
    status: "ACTIVE",
    expiresAt: "2026-11-03T12:00:00.000Z",
    consumedAt: null,
    createdAt: "2026-10-04T12:00:00.000Z",
    contactId: "c-1",
    opportunityId: null,
    branchId: "b1",
    origin: "MANUAL",
    publicUrl: `https://cupones.example/v/${VOUCHER_ID}`,
    ...overrides,
  };
}

function branchesHandler() {
  return http.get(`${api}/api/branches`, () =>
    HttpResponse.json({
      data: [makeBranch({ id: "b1", name: "Casa Central" })],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    }),
  );
}

function whatsappStatus(body: { disponible: boolean; motivo: string | null }) {
  return http.get(`${api}/api/vouchers/${VOUCHER_ID}/whatsapp`, () =>
    HttpResponse.json({ ...body, conversationId: body.disponible ? "conv-1" : null }),
  );
}

function renderDialog(
  props: { contactId?: string; opportunityId?: string } = { contactId: "c-1" },
) {
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CreateVoucherDialog {...props} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

async function completarYCrear(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Descuento"), "15% en el taller");
  const dias = screen.getByLabelText("Vence a los (días)");
  await user.clear(dias);
  await user.type(dias, "30");
  await chooseSelectOption(
    user,
    await screen.findByRole("combobox", { name: "Sucursal" }),
    "Casa Central",
  );
  await user.click(screen.getByRole("button", { name: "Crear cupón" }));
}

describe("CreateVoucherDialog", () => {
  it("desde el contacto manda descuento, días, sucursal y contactId; muestra el link y el QR", async () => {
    let recibido: unknown = null;
    server.use(
      branchesHandler(),
      http.post(`${api}/api/vouchers`, async ({ request }) => {
        recibido = await request.json();
        return HttpResponse.json(makeVoucher(), { status: 201 });
      }),
      whatsappStatus({ disponible: true, motivo: null }),
    );
    const user = userEvent.setup();
    renderDialog({ contactId: "c-1" });

    expect(screen.getByRole("button", { name: "Crear cupón" })).toBeDisabled();
    await completarYCrear(user);

    await waitFor(() =>
      expect(recibido).toEqual({
        contactId: "c-1",
        label: "15% en el taller",
        expiresInDays: 30,
        branchId: "b1",
      }),
    );
    expect(await screen.findByText("Cupón creado")).toBeInTheDocument();
    expect(screen.getByDisplayValue(makeVoucher().publicUrl)).toBeInTheDocument();
    await waitFor(() => expect(generateQrSvgMock).toHaveBeenCalledWith(makeVoucher().publicUrl));
    await user.click(await screen.findByRole("button", { name: "Ver QR" }));
    expect(screen.getByTestId("voucher-qr")).toBeInTheDocument();
  });

  it("desde la oportunidad manda opportunityId, no contactId", async () => {
    let recibido: Record<string, unknown> | null = null;
    server.use(
      branchesHandler(),
      http.post(`${api}/api/vouchers`, async ({ request }) => {
        recibido = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeVoucher({ opportunityId: "o-1" }), { status: 201 });
      }),
      whatsappStatus({ disponible: true, motivo: null }),
    );
    const user = userEvent.setup();
    renderDialog({ opportunityId: "o-1" });
    await completarYCrear(user);
    await waitFor(() => expect(recibido).not.toBeNull());
    expect(recibido).toMatchObject({ opportunityId: "o-1" });
    expect(recibido).not.toHaveProperty("contactId");
  });

  it("un rechazo del backend se muestra con su motivo y el formulario sigue ahí", async () => {
    server.use(
      branchesHandler(),
      http.post(`${api}/api/vouchers`, () =>
        HttpResponse.json(
          { error: { message: "Solo un administrador o el vendedor asignado pueden crear" } },
          { status: 403 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderDialog();
    await completarYCrear(user);
    expect(
      await screen.findByText(/Solo un administrador o el vendedor asignado/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Descuento")).toBeInTheDocument();
  });

  it("con la ventana abierta, 'Enviar por WhatsApp' lo manda y avisa que quedó en la conversación", async () => {
    let enviado = false;
    server.use(
      branchesHandler(),
      http.post(`${api}/api/vouchers`, () => HttpResponse.json(makeVoucher(), { status: 201 })),
      whatsappStatus({ disponible: true, motivo: null }),
      http.post(`${api}/api/vouchers/${VOUCHER_ID}/whatsapp`, () => {
        enviado = true;
        return HttpResponse.json({
          conversationId: "conv-1",
          deliveryStatus: "SENT",
          deliveryError: null,
        });
      }),
    );
    const user = userEvent.setup();
    renderDialog();
    await completarYCrear(user);

    const boton = await screen.findByRole("button", { name: "Enviar por WhatsApp" });
    await waitFor(() => expect(boton).toBeEnabled());
    await user.click(boton);
    await waitFor(() => expect(enviado).toBe(true));
    expect(await screen.findByText(/el cupón quedó en la conversación/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviado" })).toBeDisabled();
  });

  it("fuera de la ventana el botón queda deshabilitado con la explicación", async () => {
    const motivo =
      "El cliente no le escribió a este número en las últimas 24 h: WhatsApp solo permite plantillas aprobadas, y no hay una para envíos manuales";
    server.use(
      branchesHandler(),
      http.post(`${api}/api/vouchers`, () => HttpResponse.json(makeVoucher(), { status: 201 })),
      whatsappStatus({ disponible: false, motivo }),
    );
    const user = userEvent.setup();
    renderDialog();
    await completarYCrear(user);

    expect(await screen.findByText(motivo)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar por WhatsApp" })).toBeDisabled();
  });
});
