import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeBranch } from "../../test/branchFixtures";
import { makeUser } from "../../test/userFixtures";
import {
  makeChangeLogEntry,
  makeVehicle,
  makeVehicleDetail,
  makeVehiclePhoto,
} from "../../test/vehicleFixtures";
import { VehicleFormPage } from "./VehicleFormPage";
import type { VehiclePhoto } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/vehicles`;
const usersUrl = `${env.apiUrl}/api/users`;
const branchesUrl = `${env.apiUrl}/api/branches`;

// BranchSelect y UserSelect se montan SIEMPRE en esta ficha, así que todo test
// necesita los dos handlers (mismo criterio que CompanyFormPage.test.tsx).
function baseHandlers() {
  return [
    http.get(branchesUrl, () =>
      HttpResponse.json({
        data: [makeBranch({ id: "b1", name: "Casa Central" })],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    ),
    http.get(usersUrl, () =>
      HttpResponse.json({
        data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    ),
  ];
}

function renderForm(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/vehicles/new" element={<VehicleFormPage />} />
          <Route path="/vehicles/:id/edit" element={<VehicleFormPage />} />
          <Route path="/vehicles" element={<div>listado de stock</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Los tres obligatorios más la sucursal, en modo creación.
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Marca"), "Toyota");
  await user.type(screen.getByLabelText("Modelo"), "Corolla");
  await user.type(screen.getByLabelText("Año"), "2020");
  await waitFor(() => expect(screen.getByLabelText("Sucursal")).toBeInTheDocument());
  await user.selectOptions(screen.getByLabelText("Sucursal"), "b1");
}

const localMissing = () => screen.getByRole("list", { name: "Campos que faltan para publicar" });

describe("VehicleFormPage — crear y editar", () => {
  it("create: no pide detail, manda el POST convertido al contrato y navega al listado", async () => {
    let getDetailCalled = false;
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${baseUrl}/:id`, () => {
        getDetailCalled = true;
        return HttpResponse.json(makeVehicleDetail());
      }),
      http.post(baseUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeVehicle(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/vehicles/new");

    await fillRequired(user);
    await user.type(screen.getByLabelText("Precio de lista (USD)"), "25000.5");
    await user.type(screen.getByLabelText("Kilometraje"), "45000");
    await user.type(screen.getByLabelText("Ingreso al stock"), "2026-03-01");
    await user.type(screen.getByLabelText("Equipamiento"), "abs, airbag_lateral");
    await user.click(screen.getByLabelText("Acepta permuta"));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("listado de stock")).toBeInTheDocument());
    expect(getDetailCalled).toBe(false);
    // Números como number (z.number(), no coerce), fecha como YYYY-MM-DD,
    // vacíos como null, equipamiento como array en mayúsculas.
    expect(postedBody).toMatchObject({
      condition: "USED",
      make: "Toyota",
      model: "Corolla",
      year: 2020,
      branchId: "b1",
      priceListUsd: 25000.5,
      priceListLocal: null,
      mileage: 45000,
      stockEnteredAt: "2026-03-01",
      equipment: ["ABS", "AIRBAG_LATERAL"],
      acceptsTradeIn: true,
      status: "AVAILABLE",
      publicationCurrency: "BOTH",
      visibleInListing: true,
      publishOnWebsite: false,
      assignedSalespersonId: null,
      vin: null,
    });
    expect(postedBody?.year).toBeTypeOf("number");
  });

  // Ítem 10 de docs/frontend-cambios-pendientes.md: Sucursal lleva la marca
  // de obligatorio y `required` (BranchSelect), así que el click en Guardar
  // lo frena el navegador (y jsdom) sin llegar a handleSubmit; si el submit
  // igual llega —p. ej. mientras la lista de sucursales todavía carga no hay
  // <select> que validar—, el chequeo propio de handleSubmit sigue cortando
  // con su mensaje. En ningún caso hay POST.
  it("create sin sucursal no manda nada: required nativo en el click, y el chequeo propio avisa si el submit igual llega", async () => {
    let posted = false;
    server.use(
      ...baseHandlers(),
      http.post(baseUrl, () => {
        posted = true;
        return HttpResponse.json(makeVehicle(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/vehicles/new");

    await user.type(screen.getByLabelText("Marca"), "Toyota");
    await user.type(screen.getByLabelText("Modelo"), "Corolla");
    await user.type(screen.getByLabelText("Año"), "2020");
    const branch = await screen.findByLabelText("Sucursal");
    expect(branch).toBeRequired();
    expect(screen.getByText("Sucursal")).toHaveClass("ds-required");
    expect(screen.getAllByText("Los campos con asterisco (*) son obligatorios.")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /guardar/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(posted).toBe(false);

    fireEvent.submit(branch.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Elegí una sucursal antes de guardar."),
    );
    expect(posted).toBe(false);
    expect(screen.queryByText("listado de stock")).not.toBeInTheDocument();
  });

  it("create: 'Publicar en el sitio web' está deshabilitado y hay una nota; la galería no existe", async () => {
    server.use(...baseHandlers());

    renderForm("/vehicles/new");

    expect(screen.getByLabelText("Publicar en el sitio web")).toBeDisabled();
    expect(
      screen.getByText("Vas a poder publicarla después de guardar y subirle fotos."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Las fotos se suben después de guardar la unidad."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Subir foto")).not.toBeInTheDocument();
    expect(screen.queryByText("Ver historial de cambios")).not.toBeInTheDocument();
  });

  it("edit: carga detail, hidrata, manda PATCH al id correcto con el estado completo y navega", async () => {
    let patchedId: string | undefined;
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeVehicleDetail({
            id: params.id as string,
            make: "Toyota",
            priceListUsd: "25000.00",
            stockEnteredAt: "2026-03-01T00:00:00.000Z",
            transmission: "CVT",
            equipment: ["ABS"],
            assignedSalespersonId: "u1",
          }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, async ({ request, params }) => {
        patchedId = params.id as string;
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeVehicle({ id: "v1" }));
      }),
    );

    const user = userEvent.setup();
    renderForm("/vehicles/v1/edit");

    await waitFor(() => expect(screen.getByLabelText("Marca")).toHaveValue("Toyota"));
    expect(screen.getByLabelText("Precio de lista (USD)")).toHaveValue(25000);
    expect(screen.getByLabelText("Ingreso al stock")).toHaveValue("2026-03-01");
    expect(screen.getByLabelText("Transmisión")).toHaveValue("CVT");
    expect(screen.getByLabelText("Equipamiento")).toHaveValue("ABS");
    expect(screen.getByLabelText("Publicar en el sitio web")).toBeEnabled();
    await waitFor(() => expect(screen.getByLabelText("Vendedor asignado")).toHaveValue("u1"));
    // Registro: solo lectura.
    expect(screen.getByText("STK-000001")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Marca"));
    await user.type(screen.getByLabelText("Marca"), "Toyota Editada");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("listado de stock")).toBeInTheDocument());
    expect(patchedId).toBe("v1");
    expect(patchedBody).toMatchObject({
      make: "Toyota Editada",
      priceListUsd: 25000,
      stockEnteredAt: "2026-03-01",
      transmission: "CVT",
      equipment: ["ABS"],
      assignedSalespersonId: "u1",
      branchId: "b1",
    });
  });

  it("error de detail muestra error y no presenta el form vacío", async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${baseUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "Vehículo no encontrado" } }, { status: 404 }),
      ),
    );

    renderForm("/vehicles/v1/edit");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Vehículo no encontrado"),
    );
    expect(screen.queryByLabelText("Marca")).not.toBeInTheDocument();
  });

  it("error de create no navega y muestra el mensaje del servidor", async () => {
    server.use(
      ...baseHandlers(),
      http.post(baseUrl, () =>
        HttpResponse.json(
          { error: { message: "Ya existe otra unidad con ese VIN en esta organización" } },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/vehicles/new");

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/ese VIN/));
    expect(screen.queryByText("listado de stock")).not.toBeInTheDocument();
    // Un 409 no trae missingFields: no aparece la lista del servidor.
    expect(
      screen.queryByRole("list", { name: "Campos que faltan según el servidor" }),
    ).not.toBeInTheDocument();
  });
});

describe("VehicleFormPage — completitud para publicar", () => {
  it("el checklist local se recalcula al tipear", async () => {
    server.use(...baseHandlers());
    const user = userEvent.setup();
    renderForm("/vehicles/new");

    // Usado vacío: 10 base + 3 de usado + foto = 14 requeridos, 0 presentes.
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(within(localMissing()).getByText("VIN")).toBeInTheDocument();
    expect(within(localMissing()).getByText("Patente")).toBeInTheDocument();
    expect(within(localMissing()).getByText("Al menos una foto")).toBeInTheDocument();

    await user.type(screen.getByLabelText("VIN"), "JTDBR32E720000000");

    // 1/14 = 7%: sube en vivo, sin pegarle al backend (no hay handler de
    // vehicles registrado y onUnhandledRequest es "error").
    expect(screen.getByText("7%")).toBeInTheDocument();
    expect(within(localMissing()).queryByText("VIN")).not.toBeInTheDocument();

    // Pasar a 0 km saca los tres de usado de la lista.
    await user.selectOptions(screen.getByLabelText("Condición"), "NEW");
    expect(within(localMissing()).queryByText("Patente")).not.toBeInTheDocument();
    expect(within(localMissing()).queryByText("Kilometraje")).not.toBeInTheDocument();
    // 1/11 = 9%.
    expect(screen.getByText("9%")).toBeInTheDocument();
  });

  it("un 422 con missingFields muestra la lista del SERVIDOR, no la local", async () => {
    server.use(
      ...baseHandlers(),
      // Una ficha completa según el checklist local, publicada y sin fotos: el
      // backend es quien la rechaza.
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeVehicleDetail({
            id: params.id as string,
            condition: "NEW",
            bodyType: "SEDAN",
            vin: "JTDBR32E720000000",
            priceListUsd: "25000",
            priceListLocal: "1000000",
            transmission: "CVT",
            fuelType: "HYBRID",
            exteriorColor: "Blanco",
          }),
        ),
      ),
      http.patch(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          {
            error: {
              message: "La unidad no está completa para publicar: faltan photos",
              missingFields: ["photos"],
            },
          },
          { status: 422 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderForm("/vehicles/v1/edit");

    await waitFor(() => expect(screen.getByLabelText("Marca")).toHaveValue("Toyota"));
    // Local: solo falta la foto (93%).
    expect(within(localMissing()).getByText("Al menos una foto")).toBeInTheDocument();
    expect(within(localMissing()).getAllByRole("listitem")).toHaveLength(1);

    await user.click(screen.getByLabelText("Publicar en el sitio web"));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/faltan photos/));
    const serverList = screen.getByRole("list", { name: "Campos que faltan según el servidor" });
    expect(within(serverList).getAllByRole("listitem")).toHaveLength(1);
    expect(within(serverList).getByText("Al menos una foto")).toBeInTheDocument();
    expect(screen.getByText("El servidor rechazó la publicación. Falta completar:")).toBeVisible();
    expect(screen.queryByText("listado de stock")).not.toBeInTheDocument();
  });
});

describe("VehicleFormPage — consignación", () => {
  it("la sección aparece solo con origen Consignación, avisa si se cambia con datos, y el POST manda null", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.post(baseUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeVehicle(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/vehicles/new");

    expect(screen.queryByText("Consignación", { selector: "h2" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Consignante")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Origen"), "CONSIGNMENT");
    expect(screen.getByText("Consignación", { selector: "h2" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Consignante"), "Juan Pérez");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Origen"), "TRADE_IN");
    expect(screen.queryByLabelText("Consignante")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Los datos de consignación cargados se van a perder al guardar",
    );

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("listado de stock")).toBeInTheDocument());
    // applyConsignmentRule devolvería 400 si viajara "Juan Pérez" con TRADE_IN.
    expect(postedBody).toMatchObject({ origin: "TRADE_IN", consignorName: null });
  });

  it("con origen Consignación los datos del consignante sí viajan", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.post(baseUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeVehicle(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm("/vehicles/new");

    await user.selectOptions(screen.getByLabelText("Origen"), "CONSIGNMENT");
    await user.type(screen.getByLabelText("Consignante"), "Juan Pérez");
    await user.type(screen.getByLabelText("Comisión (%)"), "7.5");
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("listado de stock")).toBeInTheDocument());
    expect(postedBody).toMatchObject({
      origin: "CONSIGNMENT",
      consignorName: "Juan Pérez",
      consignmentCommissionPercent: 7.5,
      consignorEmail: null,
    });
  });
});

describe("VehicleFormPage — galería", () => {
  // El detalle es STATEFUL: cada escritura de la galería devuelve la galería
  // que quedó y el frontend después refetchea el detalle, así que el GET tiene
  // que reflejar lo mismo que devolvió la escritura (como el backend real).
  function galleryHandlers(initial: VehiclePhoto[]) {
    let photos = initial;
    const calls: { method: string; url: string; body?: unknown; raw?: string }[] = [];
    const handlers = [
      ...baseHandlers(),
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeVehicleDetail({ id: params.id as string }, photos)),
      ),
      http.post(`${baseUrl}/:id/photos`, async ({ request }) => {
        calls.push({ method: "POST", url: request.url, raw: await request.text() });
        photos = [
          ...photos,
          makeVehiclePhoto({
            id: `p${photos.length + 1}`,
            position: photos.length,
            isCover: false,
          }),
        ];
        return HttpResponse.json(photos, { status: 201 });
      }),
      http.patch(`${baseUrl}/:id/photos/:photoId`, async ({ request, params }) => {
        calls.push({ method: "PATCH", url: request.url, body: await request.json() });
        photos = photos.map((photo) => ({ ...photo, isCover: photo.id === params.photoId }));
        return HttpResponse.json(photos);
      }),
      http.delete(`${baseUrl}/:id/photos/:photoId`, ({ request, params }) => {
        calls.push({ method: "DELETE", url: request.url });
        photos = photos.filter((photo) => photo.id !== params.photoId);
        return HttpResponse.json(photos);
      }),
      http.put(`${baseUrl}/:id/photos/reorder`, async ({ request }) => {
        const body = (await request.json()) as { photoIds: string[] };
        calls.push({ method: "PUT", url: request.url, body });
        photos = body.photoIds.map((id, position) => ({
          ...photos.find((photo) => photo.id === id)!,
          position,
        }));
        return HttpResponse.json(photos);
      }),
    ];
    return { handlers, calls };
  }

  it("subir una foto manda el multipart en el campo 'photo' y actualiza el contador", async () => {
    const { handlers, calls } = galleryHandlers([]);
    server.use(...handlers);

    const user = userEvent.setup();
    renderForm("/vehicles/v1/edit");

    await waitFor(() => expect(screen.getByText(/0 fotos/)).toBeInTheDocument());
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "frente.jpg", {
      type: "image/jpeg",
    });
    await user.upload(screen.getByLabelText("Subir foto"), file);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${baseUrl}/v1/photos`);
    expect(calls[0].raw).toContain('name="photo"');
    await waitFor(() => expect(screen.getByText(/1 foto\./)).toBeInTheDocument());
    // La galería ya repintó con lo que devolvió el POST (y el refetch confirma).
    await waitFor(() => expect(screen.getByAltText("Foto 1")).toBeInTheDocument());
    // Y el checklist local ya no pide la foto.
    expect(within(localMissing()).queryByText("Al menos una foto")).not.toBeInTheDocument();
  });

  it("marcar portada, bajar y eliminar llaman a PATCH / PUT / DELETE con lo que el backend espera", async () => {
    const { handlers, calls } = galleryHandlers([
      makeVehiclePhoto({ id: "p1", position: 0, isCover: true }),
      makeVehiclePhoto({ id: "p2", position: 1, isCover: false }),
    ]);
    server.use(...handlers);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderForm("/vehicles/v1/edit");

    await waitFor(() => expect(screen.getByText(/2 fotos/)).toBeInTheDocument());
    // La portada actual no ofrece "marcar portada"; la segunda sí.
    expect(screen.getByText("Portada")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Marcar foto 1 como portada" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Marcar foto 2 como portada" }));
    await waitFor(() => expect(calls.at(-1)?.method).toBe("PATCH"));
    expect(calls.at(-1)?.url).toBe(`${baseUrl}/v1/photos/p2`);
    expect(calls.at(-1)?.body).toEqual({ isCover: true });
    await waitFor(() => expect(screen.getByAltText("Foto 2 (portada)")).toBeInTheDocument());

    // Reordenar manda la lista COMPLETA de ids en el orden nuevo.
    expect(screen.getByRole("button", { name: "Subir foto 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bajar foto 2" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Bajar foto 1" }));
    await waitFor(() => expect(calls.at(-1)?.method).toBe("PUT"));
    expect(calls.at(-1)?.url).toBe(`${baseUrl}/v1/photos/reorder`);
    expect(calls.at(-1)?.body).toEqual({ photoIds: ["p2", "p1"] });

    await waitFor(() => expect(screen.getByAltText("Foto 1 (portada)")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Eliminar foto 2" }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(calls.at(-1)?.method).toBe("DELETE"));
    expect(calls.at(-1)?.url).toBe(`${baseUrl}/v1/photos/p1`);
    await waitFor(() => expect(screen.getByText(/1 foto\./)).toBeInTheDocument());
  });

  it("cancelar el confirm no borra; un error de la galería se muestra sin romper la ficha", async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeVehicleDetail({ id: params.id as string }, [makeVehiclePhoto({ id: "p1" })]),
        ),
      ),
      http.post(`${baseUrl}/:id/photos`, () =>
        HttpResponse.json(
          { error: { message: "Solo se admiten fotos JPEG o PNG" } },
          { status: 415 },
        ),
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();
    renderForm("/vehicles/v1/edit");

    await waitFor(() => expect(screen.getByText(/1 foto\./)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Eliminar foto 1" }));
    expect(screen.getByText(/1 foto\./)).toBeInTheDocument();

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "doc.jpg", {
      type: "image/jpeg",
    });
    await user.upload(screen.getByLabelText("Subir foto"), file);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Solo se admiten fotos JPEG o PNG"),
    );
    expect(screen.getByLabelText("Marca")).toHaveValue("Toyota");
  });
});

describe("VehicleFormPage — historial de cambios", () => {
  it("el botón abre el Modal con la lista paginada de GET /vehicles/:id/change-log", async () => {
    let captured: URL | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${baseUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeVehicleDetail({ id: params.id as string })),
      ),
      http.get(`${baseUrl}/:id/change-log`, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json({
          data: [
            makeChangeLogEntry({ id: "cl1", fieldName: "status" }),
            makeChangeLogEntry({
              id: "cl2",
              fieldName: "priceListUsd",
              oldValue: null,
              newValue: "25000",
            }),
          ],
          pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        });
      }),
    );

    const user = userEvent.setup();
    renderForm("/vehicles/v1/edit");

    await waitFor(() => expect(screen.getByLabelText("Marca")).toHaveValue("Toyota"));
    expect(captured).toBeUndefined();

    await user.click(screen.getByRole("button", { name: "Ver historial de cambios" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Historial de cambios")).toBeInTheDocument();
    await waitFor(() =>
      expect(dialog.getByText("Estado: AVAILABLE → RESERVED")).toBeInTheDocument(),
    );
    expect(dialog.getByText("Precio de lista (USD): — → 25000")).toBeInTheDocument();
    expect(dialog.getAllByText(/Ana Pérez/)).toHaveLength(2);
    expect(captured?.pathname).toBe("/api/vehicles/v1/change-log");
    expect(captured?.searchParams.get("page")).toBe("1");

    await user.click(dialog.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
