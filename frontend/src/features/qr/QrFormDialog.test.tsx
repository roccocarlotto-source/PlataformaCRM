import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { makeQrCode } from "../../test/qrFixtures";
import { QrFormDialog } from "./QrFormDialog";
import type { QrCode } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const qrUrl = `${env.apiUrl}/api/qr`;
const branchesUrl = `${env.apiUrl}/api/branches`;

function branchesHandler() {
  return http.get(branchesUrl, () =>
    HttpResponse.json({
      data: [makeBranch({ id: "b1", name: "Casa Central" })],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    }),
  );
}

function renderDialog(qr?: QrCode) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <QrFormDialog qr={qr} onClose={onClose} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return { onClose, onSaved, dialog: within(screen.getByRole("dialog")) };
}

describe("QrFormDialog — crear", () => {
  it("valida en el cliente antes de pegarle al backend: sucursal, nombre y URL", async () => {
    let posted = false;
    server.use(
      branchesHandler(),
      http.post(`${qrUrl}/digital`, () => {
        posted = true;
        return HttpResponse.json(makeQrCode(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    await waitFor(() => expect(dialog.getByText("Casa Central")).toBeInTheDocument());

    await user.click(dialog.getByRole("button", { name: "Crear QR" }));
    expect(dialog.getByRole("alert")).toHaveTextContent(/Elegí la sucursal/);

    await user.selectOptions(dialog.getByLabelText("Sucursal"), "b1");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));
    expect(dialog.getByRole("alert")).toHaveTextContent(/nombre del QR es obligatorio/);

    await user.type(dialog.getByLabelText("Nombre"), "Caja");
    await user.type(dialog.getByLabelText("Enlace de destino"), "google.com");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));
    expect(dialog.getByRole("alert")).toHaveTextContent(/URL de destino válida/);

    expect(posted).toBe(false);
  });

  it("POST /api/qr/digital con qrType REUSABLE por defecto, message null si vacío, y llama a onSaved con la respuesta", async () => {
    let body: unknown;
    const creado = makeQrCode({ displayNumber: 9, name: "Caja" });
    server.use(
      branchesHandler(),
      http.post(`${qrUrl}/digital`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(creado, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { dialog, onSaved } = renderDialog();
    await waitFor(() => expect(dialog.getByText("Casa Central")).toBeInTheDocument());

    await user.selectOptions(dialog.getByLabelText("Sucursal"), "b1");
    await user.type(dialog.getByLabelText("Nombre"), "  Caja  ");
    await user.type(dialog.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(creado));
    expect(body).toEqual({
      branchId: "b1",
      name: "Caja",
      destinationUrl: "https://g.page/r/x/review",
      message: null,
      qrType: "REUSABLE",
    });
  });

  it("con 'Un solo uso' marcado manda qrType SINGLE_USE y el mensaje recortado", async () => {
    let body: unknown;
    server.use(
      branchesHandler(),
      http.post(`${qrUrl}/digital`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeQrCode({ qrType: "SINGLE_USE" }), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    await waitFor(() => expect(dialog.getByText("Casa Central")).toBeInTheDocument());

    await user.selectOptions(dialog.getByLabelText("Sucursal"), "b1");
    await user.type(dialog.getByLabelText("Nombre"), "Evento");
    await user.type(dialog.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.type(dialog.getByLabelText("Mensaje (opcional)"), " ¡Gracias! ");
    await user.click(dialog.getByRole("radio", { name: "Un solo uso" }));
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ qrType: "SINGLE_USE", message: "¡Gracias!" });
  });

  it("muestra el 400 del backend si igual llega inválido", async () => {
    server.use(
      branchesHandler(),
      http.post(`${qrUrl}/digital`, () =>
        HttpResponse.json(
          { error: { message: "La sucursal indicada no existe o no pertenece a tu organización" } },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { dialog, onSaved } = renderDialog();
    await waitFor(() => expect(dialog.getByText("Casa Central")).toBeInTheDocument());

    await user.selectOptions(dialog.getByLabelText("Sucursal"), "b1");
    await user.type(dialog.getByLabelText("Nombre"), "Caja");
    await user.type(dialog.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(/no pertenece a tu organización/);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Cancelar llama a onClose sin pegarle al backend", async () => {
    server.use(branchesHandler());
    const user = userEvent.setup();
    const { dialog, onClose } = renderDialog();

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("QrFormDialog — editar", () => {
  it("hidrata desde la fila (sin fetch de detalle), no muestra sucursal ni tipo, y el PATCH no lleva branchId ni qrType", async () => {
    let body: unknown;
    let patchedId: string | undefined;
    let branchesFetched = false;
    server.use(
      http.get(branchesUrl, () => {
        branchesFetched = true;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
      http.patch(`${qrUrl}/:id`, async ({ request, params }) => {
        patchedId = params.id as string;
        body = await request.json();
        return HttpResponse.json(makeQrCode({ name: "Caja" }));
      }),
    );
    const user = userEvent.setup();
    const qr = makeQrCode({ message: "Hola" });
    const { dialog, onSaved } = renderDialog(qr);

    expect(dialog.getByLabelText("Nombre")).toHaveValue("Mostrador");
    expect(dialog.getByLabelText("Enlace de destino")).toHaveValue("https://g.page/r/abc/review");
    expect(dialog.getByLabelText("Mensaje (opcional)")).toHaveValue("Hola");
    expect(dialog.queryByLabelText("Sucursal")).not.toBeInTheDocument();
    expect(dialog.queryByRole("radiogroup")).not.toBeInTheDocument();

    await user.clear(dialog.getByLabelText("Nombre"));
    await user.type(dialog.getByLabelText("Nombre"), "Caja");
    await user.clear(dialog.getByLabelText("Mensaje (opcional)"));
    await user.click(dialog.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patchedId).toBe(qr.id);
    // message vacío viaja como null: es la forma explícita de vaciarlo en el PATCH.
    expect(body).toEqual({
      name: "Caja",
      destinationUrl: "https://g.page/r/abc/review",
      message: null,
    });
    expect(body).not.toHaveProperty("branchId");
    expect(body).not.toHaveProperty("qrType");
    expect(branchesFetched).toBe(false);
  });
});
