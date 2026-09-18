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
import { chooseSelectOption } from "../../test/chooseSelectOption";

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

// §54 — el GET que prellena el campo "N°" al elegir la sucursal. Por default
// sugiere 4 (un número que NO es el del fixture ni 1, para que cuando un test
// lo vea sepa que vino de acá y no de un default escondido).
function suggestedHandler(suggestedDisplayNumber = 4) {
  return http.get(`${qrUrl}/next-display-number`, ({ request }) => {
    const branchId = new URL(request.url).searchParams.get("branchId") ?? "";
    return HttpResponse.json({ branchId, suggestedDisplayNumber });
  });
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
      suggestedHandler(),
      http.post(`${qrUrl}/digital`, () => {
        posted = true;
        return HttpResponse.json(makeQrCode(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    await dialog.findByRole("combobox", { name: "Sucursal" });

    await user.click(dialog.getByRole("button", { name: "Crear QR" }));
    expect(dialog.getByRole("alert")).toHaveTextContent(/Elegí la sucursal/);

    await chooseSelectOption(user, dialog.getByLabelText("Sucursal"), "Casa Central");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));
    expect(dialog.getByRole("alert")).toHaveTextContent(/nombre del QR es obligatorio/);

    await user.type(dialog.getByLabelText("Nombre"), "Caja");
    await user.type(dialog.getByLabelText("Enlace de destino"), "google.com");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));
    expect(dialog.getByRole("alert")).toHaveTextContent(/URL de destino válida/);

    expect(posted).toBe(false);
  });

  it("POST /api/qr/digital con message null si vacío, sin qrType, y llama a onSaved con la respuesta", async () => {
    let body: unknown;
    const creado = makeQrCode({ displayNumber: 9, name: "Caja" });
    server.use(
      branchesHandler(),
      suggestedHandler(),
      http.post(`${qrUrl}/digital`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(creado, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { dialog, onSaved } = renderDialog();
    await dialog.findByRole("combobox", { name: "Sucursal" });

    await chooseSelectOption(user, dialog.getByLabelText("Sucursal"), "Casa Central");
    await user.type(dialog.getByLabelText("Nombre"), "  Caja  ");
    await user.type(dialog.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(creado));
    // Sin qrType: la migración 20260904120000 sacó la columna y
    // createDigitalQrSchema dejó de declararla (ítem 53). Al no ser un Zod
    // .strict(), el backend la venía descartando en silencio — mandarla no
    // fallaba, simplemente no hacía nada.
    expect(body).toEqual({
      branchId: "b1",
      name: "Caja",
      destinationUrl: "https://g.page/r/x/review",
      message: null,
      // §54: el N° que viaja es el SUGERIDO que devolvió el GET al elegir la
      // sucursal, sin que nadie lo tipeara.
      displayNumber: 4,
    });
    expect(body).not.toHaveProperty("qrType");
  });

  // Hasta el ítem 53 este caso además marcaba el radio "Un solo uso" y
  // afirmaba que el body llevaba qrType SINGLE_USE. Los radios se sacaron: la
  // columna no existe desde 20260904120000 y el backend descartaba el campo en
  // silencio, así que elegir esa opción creaba un QR reusable igual. Queda lo
  // que sí sigue vivo —el mensaje se recorta antes de viajar— y se afirma de
  // paso que el alta ya no ofrece ningún radiogroup.
  it("el mensaje viaja recortado y el alta ya no ofrece elegir tipo de QR", async () => {
    let body: unknown;
    server.use(
      branchesHandler(),
      suggestedHandler(),
      http.post(`${qrUrl}/digital`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeQrCode(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    await dialog.findByRole("combobox", { name: "Sucursal" });

    expect(dialog.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(dialog.queryByText("Tipo de QR")).not.toBeInTheDocument();

    await chooseSelectOption(user, dialog.getByLabelText("Sucursal"), "Casa Central");
    await user.type(dialog.getByLabelText("Nombre"), "Evento");
    await user.type(dialog.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.type(dialog.getByLabelText("Mensaje (opcional)"), " ¡Gracias! ");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ message: "¡Gracias!" });
    expect(body).not.toHaveProperty("qrType");
  });

  it("muestra el 400 del backend si igual llega inválido", async () => {
    server.use(
      branchesHandler(),
      suggestedHandler(),
      http.post(`${qrUrl}/digital`, () =>
        HttpResponse.json(
          { error: { message: "La sucursal indicada no existe o no pertenece a tu organización" } },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { dialog, onSaved } = renderDialog();
    await dialog.findByRole("combobox", { name: "Sucursal" });

    await chooseSelectOption(user, dialog.getByLabelText("Sucursal"), "Casa Central");
    await user.type(dialog.getByLabelText("Nombre"), "Caja");
    await user.type(dialog.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(/no pertenece a tu organización/);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Cancelar llama a onClose sin pegarle al backend", async () => {
    server.use(branchesHandler(), suggestedHandler());
    const user = userEvent.setup();
    const { dialog, onClose } = renderDialog();

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("QrFormDialog — editar", () => {
  it("hidrata desde la fila (sin fetch de detalle), no muestra sucursal, y el PATCH no lleva branchId", async () => {
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
      // §54: el N° viaja siempre en el PATCH, con el valor que quedó en el
      // campo (acá el que traía la fila, sin tocarlo).
      displayNumber: 1,
    });
    expect(body).not.toHaveProperty("branchId");
    expect(branchesFetched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §54 — el campo "N°": sugerido por sucursal, editable a mano.
// ---------------------------------------------------------------------------

describe("QrFormDialog — N° sugerido (§54)", () => {
  it("al elegir la sucursal pide el sugerido de ESA sucursal y prellena el campo", async () => {
    let branchIdConsultado: string | null = null;
    server.use(
      branchesHandler(),
      http.get(`${qrUrl}/next-display-number`, ({ request }) => {
        branchIdConsultado = new URL(request.url).searchParams.get("branchId");
        return HttpResponse.json({ branchId: branchIdConsultado, suggestedDisplayNumber: 4 });
      }),
    );
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    await dialog.findByRole("combobox", { name: "Sucursal" });

    // Sin sucursal elegida no hay serie que consultar: la query ni se dispara.
    expect(dialog.getByLabelText("N°")).toHaveValue(null);
    expect(branchIdConsultado).toBeNull();

    await chooseSelectOption(user, dialog.getByLabelText("Sucursal"), "Casa Central");

    await waitFor(() => expect(dialog.getByLabelText("N°")).toHaveValue(4));
    expect(branchIdConsultado).toBe("b1");
    expect(dialog.getByText(/Sugerido: el siguiente libre en esta sucursal/)).toBeInTheDocument();
  });

  it("no pisa lo que la persona ya escribió cuando la sugerencia llega después", async () => {
    let responder: (() => void) | undefined;
    const llegoLaSugerencia = new Promise<void>((resolve) => {
      responder = resolve;
    });
    let body: unknown;
    server.use(
      branchesHandler(),
      http.get(`${qrUrl}/next-display-number`, async () => {
        // Se retiene hasta que el test lo suelte: la sugerencia llega DESPUÉS
        // de que la persona escribió su propio número.
        await llegoLaSugerencia;
        return HttpResponse.json({ branchId: "b1", suggestedDisplayNumber: 4 });
      }),
      http.post(`${qrUrl}/digital`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeQrCode(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    await dialog.findByRole("combobox", { name: "Sucursal" });

    await chooseSelectOption(user, dialog.getByLabelText("Sucursal"), "Casa Central");
    await user.type(dialog.getByLabelText("N°"), "12");
    responder?.();

    // La sugerencia ya llegó y NO se metió encima. El tipeo del nombre de
    // acá abajo es lo que le da a la query el margen para resolver y
    // re-renderizar antes de la aserción; verificado quitando el flag
    // numeroTocado del componente, con lo que este caso falla con 4 en vez
    // de 12.
    await user.type(dialog.getByLabelText("Nombre"), "Caja");
    await waitFor(() => expect(dialog.getByLabelText("Nombre")).toHaveValue("Caja"));
    expect(dialog.getByLabelText("N°")).toHaveValue(12);

    await user.type(dialog.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ displayNumber: 12 });
  });

  it("cambiar de sucursal sin haber tocado el N° trae el sugerido de la nueva", async () => {
    const sugeridos: Record<string, number> = { b1: 4, b2: 9 };
    server.use(
      http.get(branchesUrl, () =>
        HttpResponse.json({
          data: [
            makeBranch({ id: "b1", name: "Casa Central" }),
            makeBranch({ id: "b2", name: "Sucursal Norte" }),
          ],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      ),
      http.get(`${qrUrl}/next-display-number`, ({ request }) => {
        const branchId = new URL(request.url).searchParams.get("branchId") ?? "";
        return HttpResponse.json({ branchId, suggestedDisplayNumber: sugeridos[branchId] });
      }),
    );
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    await dialog.findByRole("combobox", { name: "Sucursal" });

    await chooseSelectOption(user, dialog.getByLabelText("Sucursal"), "Casa Central");
    await waitFor(() => expect(dialog.getByLabelText("N°")).toHaveValue(4));

    await chooseSelectOption(user, dialog.getByLabelText("Sucursal"), "Sucursal Norte");
    await waitFor(() => expect(dialog.getByLabelText("N°")).toHaveValue(9));
  });

  it("guardar antes de que llegue la sugerencia manda el POST sin displayNumber (lo asigna el backend)", async () => {
    let body: unknown;
    server.use(
      branchesHandler(),
      // La sugerencia nunca llega dentro del test: el campo queda vacío.
      http.get(`${qrUrl}/next-display-number`, () => new Promise(() => undefined)),
      http.post(`${qrUrl}/digital`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeQrCode(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    await dialog.findByRole("combobox", { name: "Sucursal" });

    await chooseSelectOption(user, dialog.getByLabelText("Sucursal"), "Casa Central");
    await user.type(dialog.getByLabelText("Nombre"), "Caja");
    await user.type(dialog.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).not.toHaveProperty("displayNumber");
  });

  it("un N° que no es un entero positivo se frena en el cliente, sin pegarle al backend", async () => {
    let posted = false;
    server.use(
      branchesHandler(),
      suggestedHandler(),
      http.post(`${qrUrl}/digital`, () => {
        posted = true;
        return HttpResponse.json(makeQrCode(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    await dialog.findByRole("combobox", { name: "Sucursal" });

    await chooseSelectOption(user, dialog.getByLabelText("Sucursal"), "Casa Central");
    await waitFor(() => expect(dialog.getByLabelText("N°")).toHaveValue(4));
    await user.clear(dialog.getByLabelText("N°"));
    await user.type(dialog.getByLabelText("N°"), "0");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));

    expect(dialog.getByRole("alert")).toHaveTextContent(/número entero mayor que 0/);
    expect(posted).toBe(false);
  });

  // La otra decisión de Rocco: un número repetido dentro de la sucursal se
  // RECHAZA. El diálogo no necesita ningún manejo especial para eso — el
  // mensaje del backend sale por el mismo catch que cualquier otro error—, y
  // esto lo fija para que no se "mejore" con una traducción propia que quede
  // desactualizada.
  it("el 409 de número repetido del backend se muestra tal cual", async () => {
    server.use(
      branchesHandler(),
      suggestedHandler(),
      http.post(`${qrUrl}/digital`, () =>
        HttpResponse.json(
          { error: { message: "Ya existe un QR activo con ese número en esta sucursal" } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { dialog, onSaved } = renderDialog();
    await dialog.findByRole("combobox", { name: "Sucursal" });

    await chooseSelectOption(user, dialog.getByLabelText("Sucursal"), "Casa Central");
    await user.type(dialog.getByLabelText("Nombre"), "Caja");
    await user.type(dialog.getByLabelText("Enlace de destino"), "https://g.page/r/x/review");
    await user.click(dialog.getByRole("button", { name: "Crear QR" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Ya existe un QR activo con ese número en esta sucursal",
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("QrFormDialog — N° al editar (§54)", () => {
  it("se hidrata con el N° de la fila, viaja editado en el PATCH, y no se consulta ningún sugerido", async () => {
    let body: unknown;
    let sugeridoConsultado = false;
    server.use(
      http.get(branchesUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      ),
      http.get(`${qrUrl}/next-display-number`, () => {
        sugeridoConsultado = true;
        return HttpResponse.json({ branchId: "b1", suggestedDisplayNumber: 4 });
      }),
      http.patch(`${qrUrl}/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeQrCode({ displayNumber: 8 }));
      }),
    );
    const user = userEvent.setup();
    const { dialog, onSaved } = renderDialog(makeQrCode({ displayNumber: 3 }));

    expect(dialog.getByLabelText("N°")).toHaveValue(3);

    await user.clear(dialog.getByLabelText("N°"));
    await user.type(dialog.getByLabelText("N°"), "8");
    await user.click(dialog.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body).toMatchObject({ displayNumber: 8 });
    // Al editar, el número que corresponde es el que el QR ya tiene: pedir el
    // "próximo libre" no significaría nada acá.
    expect(sugeridoConsultado).toBe(false);
  });

  it("vaciar el N° al editar se frena en el cliente: el PATCH no lo dejaría en blanco, lo ignoraría", async () => {
    let patched = false;
    server.use(
      http.get(branchesUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      ),
      http.patch(`${qrUrl}/:id`, () => {
        patched = true;
        return HttpResponse.json(makeQrCode());
      }),
    );
    const user = userEvent.setup();
    const { dialog } = renderDialog(makeQrCode({ displayNumber: 3 }));

    await user.clear(dialog.getByLabelText("N°"));
    await user.click(dialog.getByRole("button", { name: "Guardar" }));

    expect(dialog.getByRole("alert")).toHaveTextContent(/N° del QR no puede quedar vacío/);
    expect(patched).toBe(false);
  });

  it("al editar, el N° lleva la marca de obligatorio; al crear no, porque vacío significa 'usá el sugerido'", async () => {
    server.use(
      http.get(branchesUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
      ),
    );
    const { dialog } = renderDialog(makeQrCode());
    expect(dialog.getByLabelText("N°")).toBeRequired();
    expect(dialog.getByText("N°")).toHaveClass("ds-required");
  });
});

// Ítem 10 de docs/frontend-cambios-pendientes.md: los tres campos que
// validar() exige llevan la marca (.ds-required + required); lo que bloquea
// el guardado sigue siendo validar() (el test "valida en el cliente" de
// arriba), porque el <form> es noValidate.
describe("QrFormDialog — campos obligatorios", () => {
  it("Sucursal, Nombre y Enlace de destino llevan la marca; Mensaje no; la referencia del asterisco va una sola vez", async () => {
    server.use(branchesHandler(), suggestedHandler());
    const { dialog } = renderDialog();
    await dialog.findByRole("combobox", { name: "Sucursal" });

    for (const label of ["Sucursal", "Nombre", "Enlace de destino"]) {
      expect(dialog.getByLabelText(label)).toBeRequired();
      expect(dialog.getByText(label)).toHaveClass("ds-required");
    }
    // §54: el N° tampoco lleva la marca AL CREAR — vacío ahí significa "usá
    // el sugerido", no "falta un dato". Al editar sí la lleva (ver el
    // describe del N°).
    for (const label of ["N°", "Mensaje (opcional)"]) {
      expect(dialog.getByLabelText(label)).not.toBeRequired();
      expect(dialog.getByText(label)).not.toHaveClass("ds-required");
    }
    expect(dialog.getAllByText("Los campos con asterisco (*) son obligatorios.")).toHaveLength(1);
  });
});
