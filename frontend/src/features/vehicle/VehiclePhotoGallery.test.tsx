import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeVehicleDetail, makeVehiclePhoto } from "../../test/vehicleFixtures";
import { useVehicle } from "./queries";
import { VehiclePhotoGallery } from "./VehiclePhotoGallery";
import type { VehiclePhoto } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/vehicles`;

// La galería recibe las fotos por PROP: en la ficha real se las pasa
// VehicleFormPage desde el detalle del vehículo. Este harness hace exactamente
// lo mismo con la misma query, así que el refetch que disparan las mutations
// repinta la grilla igual que en la pantalla — sin eso, un borrado se vería
// como que no pasó nada.
function Harness() {
  const query = useVehicle("v1");
  if (!query.data) return null;
  return <VehiclePhotoGallery vehicleId="v1" photos={query.data.photos} />;
}

// El "servidor" de la galería: una lista de fotos que el DELETE achica de
// verdad, y un conjunto de ids cuyo borrado falla (para el caso de falla
// parcial del lote).
function mockGallery(initial: VehiclePhoto[], fallan: string[] = []) {
  let photos = initial;
  const borrados: string[] = [];

  server.use(
    http.get(`${baseUrl}/:id`, () => HttpResponse.json(makeVehicleDetail({ id: "v1" }, photos))),
    http.delete(`${baseUrl}/:id/photos/:photoId`, ({ params }) => {
      const photoId = params.photoId as string;
      if (fallan.includes(photoId)) {
        return HttpResponse.json(
          { error: { message: "No pudimos borrar esa foto" } },
          { status: 500 },
        );
      }
      borrados.push(photoId);
      photos = photos.filter((photo) => photo.id !== photoId);
      // 200 con la galería que quedó, no 204 (ver deleteVehiclePhotoHandler).
      return HttpResponse.json(photos);
    }),
  );

  return borrados;
}

function tresFotos() {
  return [
    makeVehiclePhoto({ id: "p1", position: 0, isCover: true }),
    makeVehiclePhoto({ id: "p2", position: 1, isCover: false }),
    makeVehiclePhoto({ id: "p3", position: 2, isCover: false }),
  ];
}

function renderGallery() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

function casilla(index: number) {
  return screen.getByLabelText(`Seleccionar foto ${index}`);
}

describe("VehiclePhotoGallery — selección múltiple", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm");
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it("sin nada tildado no hay barra de acciones", async () => {
    mockGallery(tresFotos());
    renderGallery();

    await screen.findByLabelText("Seleccionar foto 1");
    expect(
      screen.queryByRole("button", { name: "Eliminar seleccionadas" }),
    ).not.toBeInTheDocument();
  });

  it("tildar fotos muestra la barra con el conteo, en singular y en plural", async () => {
    mockGallery(tresFotos());
    const user = userEvent.setup();
    renderGallery();

    await user.click(await screen.findByLabelText("Seleccionar foto 1"));
    expect(screen.getByText("1 foto seleccionada")).toBeInTheDocument();

    await user.click(casilla(3));
    expect(screen.getByText("2 fotos seleccionadas")).toBeInTheDocument();

    // Destildar vuelve atrás: la casilla es un interruptor, no un "agregar".
    await user.click(casilla(3));
    expect(screen.getByText("1 foto seleccionada")).toBeInTheDocument();
  });

  it("'Cancelar selección' destilda todo y NO borra nada", async () => {
    const borrados = mockGallery(tresFotos());
    const user = userEvent.setup();
    renderGallery();

    await user.click(await screen.findByLabelText("Seleccionar foto 1"));
    await user.click(casilla(2));
    await user.click(screen.getByRole("button", { name: "Cancelar selección" }));

    expect(screen.queryByText(/seleccionada/)).not.toBeInTheDocument();
    expect(casilla(1)).not.toBeChecked();
    expect(casilla(2)).not.toBeChecked();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(borrados).toEqual([]);
    // Las tres siguen en la galería.
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("confirmar el borrado en lote manda un DELETE por foto seleccionada", async () => {
    const borrados = mockGallery(tresFotos());
    confirmSpy.mockReturnValue(true);
    const user = userEvent.setup();
    renderGallery();

    await user.click(await screen.findByLabelText("Seleccionar foto 1"));
    await user.click(casilla(2));
    await user.click(screen.getByRole("button", { name: "Eliminar seleccionadas" }));

    // El texto de la confirmación dice cuántas son: es lo único que separa
    // este borrado del de a una.
    expect(confirmSpy).toHaveBeenCalledWith("¿Eliminar las 2 fotos seleccionadas?");

    await waitFor(() => expect([...borrados].sort()).toEqual(["p1", "p2"]));
    // Queda una sola foto y la selección se vacía sola.
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(1));
    expect(screen.queryByText(/seleccionada/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 foto\./)).toBeInTheDocument();
  });

  it("una sola tildada usa el singular en la confirmación", async () => {
    const borrados = mockGallery(tresFotos());
    confirmSpy.mockReturnValue(true);
    const user = userEvent.setup();
    renderGallery();

    await user.click(await screen.findByLabelText("Seleccionar foto 2"));
    await user.click(screen.getByRole("button", { name: "Eliminar seleccionadas" }));

    expect(confirmSpy).toHaveBeenCalledWith("¿Eliminar la foto seleccionada?");
    await waitFor(() => expect(borrados).toEqual(["p2"]));
  });

  it("cancelar la confirmación no borra nada y deja la selección como estaba", async () => {
    const borrados = mockGallery(tresFotos());
    confirmSpy.mockReturnValue(false);
    const user = userEvent.setup();
    renderGallery();

    await user.click(await screen.findByLabelText("Seleccionar foto 1"));
    await user.click(casilla(2));
    await user.click(screen.getByRole("button", { name: "Eliminar seleccionadas" }));

    expect(borrados).toEqual([]);
    // La selección sobrevive: cancelar la pregunta no es cancelar la
    // selección, para eso está el otro botón.
    expect(screen.getByText("2 fotos seleccionadas")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("una falla parcial borra las demás, avisa, y deja tildada la que falló", async () => {
    const borrados = mockGallery(tresFotos(), ["p2"]);
    confirmSpy.mockReturnValue(true);
    const user = userEvent.setup();
    renderGallery();

    await user.click(await screen.findByLabelText("Seleccionar foto 1"));
    await user.click(casilla(2));
    await user.click(casilla(3));
    await user.click(screen.getByRole("button", { name: "Eliminar seleccionadas" }));

    // p2 falló y NO abortó a p3: allSettled y no all.
    await waitFor(() => expect([...borrados].sort()).toEqual(["p1", "p3"]));
    expect(
      await screen.findByText(
        "No se pudieron eliminar 1 de 3 fotos. Siguen seleccionadas para reintentar.",
      ),
    ).toBeInTheDocument();

    // Queda solo p2, todavía tildada, lista para reintentar.
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(1));
    expect(casilla(1)).toBeChecked();
    expect(screen.getByText("1 foto seleccionada")).toBeInTheDocument();
  });

  it("el 'Eliminar' individual de cada foto sigue funcionando igual que antes", async () => {
    const borrados = mockGallery(tresFotos());
    confirmSpy.mockReturnValue(true);
    const user = userEvent.setup();
    renderGallery();

    await screen.findByLabelText("Seleccionar foto 1");
    await user.click(screen.getByRole("button", { name: "Eliminar foto 2" }));

    // Su propia pregunta, en singular y sin mencionar selección alguna.
    expect(confirmSpy).toHaveBeenCalledWith("¿Eliminar esta foto?");
    await waitFor(() => expect(borrados).toEqual(["p2"]));
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
    // Y no hay barra: borrar de a una no pasa por la selección.
    expect(
      screen.queryByRole("button", { name: "Eliminar seleccionadas" }),
    ).not.toBeInTheDocument();
  });

  it("una foto sin vista previa también se puede seleccionar", async () => {
    const borrados = mockGallery([
      makeVehiclePhoto({ id: "p1", url: null, isCover: true }),
      makeVehiclePhoto({ id: "p2", position: 1, isCover: false }),
    ]);
    confirmSpy.mockReturnValue(true);
    const user = userEvent.setup();
    renderGallery();

    // Sin <img> que firmar, la casilla va igual al lado del cartel: borrar
    // una foto rota es justamente para lo que sirve.
    expect(await screen.findByText("Sin vista previa")).toBeInTheDocument();
    await user.click(casilla(1));
    await user.click(screen.getByRole("button", { name: "Eliminar seleccionadas" }));

    await waitFor(() => expect(borrados).toEqual(["p1"]));
  });
});
