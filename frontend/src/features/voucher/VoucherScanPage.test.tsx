import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { formatDateTime } from "../../design-system/detailFormat";
import { ThemeProvider } from "../../theme/ThemeContext";
import type { QrCameraReaderProps } from "./QrCameraReader";
import type { RedeemedVoucher } from "./types";
import { VoucherScanPage } from "./VoucherScanPage";

const apiMock = vi.hoisted(() => ({ redeemVoucher: vi.fn() }));
vi.mock("./api", () => apiMock);

// El lector de cámara, reemplazado por uno que guarda sus callbacks: cada
// test "escanea" llamando a onDecode — sin cámara ni jsQR.
const lector = vi.hoisted(() => ({ props: null as QrCameraReaderProps | null }));
vi.mock("./QrCameraReader", () => ({
  QrCameraReader: (props: QrCameraReaderProps) => {
    lector.props = props;
    return <div data-testid="camara" />;
  },
}));

const ID = "5b0f7a4e-2c1d-4f3a-9e8b-1a2b3c4d5e6f";
const OTRO_ID = "00000000-0000-4000-8000-000000000001";
const LINK = `https://qr.test.local/v/${ID}`; // VITE_QR_PUBLIC_BASE_URL de vite.config.ts

function cupon(overrides: Partial<RedeemedVoucher> = {}): RedeemedVoucher {
  return {
    id: ID,
    label: "15% de descuento en el taller",
    status: "CONSUMED",
    expiresAt: "2026-10-28T12:00:00.000Z",
    consumedAt: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
}

// `historial`: lo que hay en el historial antes del escáner. Vacío = se entró
// directo a /vouchers/scan (la primera entrada, key "default").
function renderPage(historial: string[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[...historial, "/vouchers/scan"]}>
          <Routes>
            <Route path="/" element={<p>Dashboard</p>} />
            <Route path="/contacts" element={<p>Contactos</p>} />
            <Route path="/vouchers/scan" element={<VoucherScanPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function escanear(texto: string) {
  act(() => lector.props!.onDecode(texto));
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  lector.props = null;
});

describe("VoucherScanPage", () => {
  it("escanear el link del cupón lo canjea por su id y muestra el label", async () => {
    apiMock.redeemVoucher.mockResolvedValue(cupon());
    renderPage();

    escanear(LINK);

    expect(await screen.findByText("Cupón canjeado")).toBeInTheDocument();
    expect(screen.getByText("15% de descuento en el taller")).toBeInTheDocument();
    expect(apiMock.redeemVoucher).toHaveBeenCalledTimes(1);
    expect(apiMock.redeemVoucher).toHaveBeenCalledWith(ID);
    // El resultado reemplaza a la cámara (y al campo manual), con las dos salidas.
    expect(screen.queryByTestId("camara")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Link o código del cupón")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escanear otro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listo" })).toBeInTheDocument();
  });

  it("un error también apaga la cámara y ofrece las dos salidas", async () => {
    renderPage();

    escanear("https://g.page/r/abc/review");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("camara")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escanear otro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listo" })).toBeInTheDocument();
  });

  it('"Escanear otro" limpia el resultado y vuelve a prender la cámara', async () => {
    const user = userEvent.setup();
    apiMock.redeemVoucher.mockResolvedValue(cupon());
    renderPage();

    escanear(LINK);
    await user.click(await screen.findByRole("button", { name: "Escanear otro" }));

    expect(screen.getByTestId("camara")).toBeInTheDocument();
    expect(screen.queryByText("Cupón canjeado")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Link o código del cupón")).toBeInTheDocument();
  });

  it('"Listo" vuelve a la pantalla anterior', async () => {
    const user = userEvent.setup();
    apiMock.redeemVoucher.mockResolvedValue(cupon());
    renderPage(["/contacts"]);

    escanear(LINK);
    await user.click(await screen.findByRole("button", { name: "Listo" }));

    expect(screen.getByText("Contactos")).toBeInTheDocument();
  });

  it('"Listo" lleva al Dashboard si se entró directo al escáner', async () => {
    const user = userEvent.setup();
    apiMock.redeemVoucher.mockResolvedValue(cupon());
    renderPage();

    escanear(LINK);
    await user.click(await screen.findByRole("button", { name: "Listo" }));

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("409 ya canjeado: el mensaje del backend tal cual, con cuándo", async () => {
    const consumedAt = "2026-09-20T15:30:00.000Z";
    apiMock.redeemVoucher.mockRejectedValue(
      new ApiError(409, "Este cupón ya fue canjeado", { consumedAt }),
    );
    renderPage();

    escanear(LINK);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      `Este cupón ya fue canjeado (${formatDateTime(consumedAt)})`,
    );
  });

  it("409 vencido: el mensaje del backend tal cual, con cuándo", async () => {
    const expiresAt = "2026-09-01T00:00:00.000Z";
    apiMock.redeemVoucher.mockRejectedValue(new ApiError(409, "Este cupón venció", { expiresAt }));
    renderPage();

    escanear(LINK);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      `Este cupón venció (${formatDateTime(expiresAt)})`,
    );
  });

  it("404: el mensaje del backend tal cual", async () => {
    apiMock.redeemVoucher.mockRejectedValue(
      new ApiError(404, "El cupón no existe o no pertenece a tu organización"),
    );
    renderPage();

    escanear(LINK);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El cupón no existe o no pertenece a tu organización",
    );
  });

  it("un QR que no es un cupón no llama al backend", async () => {
    renderPage();

    escanear("https://g.page/r/abc/review");

    expect(await screen.findByRole("alert")).toHaveTextContent("Esto no es un cupón.");
    expect(apiMock.redeemVoucher).not.toHaveBeenCalled();
  });

  it("el QR de reseñas (termina en UUID) no va al canje: avisa qué QR escanear", async () => {
    renderPage();

    escanear(`https://qr.test.local/r/${ID}`);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este es un QR de reseñas, no un cupón. Escaneá el QR que el cliente tiene en la página de su cupón.",
    );
    expect(apiMock.redeemVoucher).not.toHaveBeenCalled();
  });

  it("un link de otro dominio que termina en UUID no va al canje", async () => {
    renderPage();

    escanear(`https://otro-sitio.com/v/${ID}`);

    expect(await screen.findByRole("alert")).toHaveTextContent("Esto no es un cupón.");
    expect(apiMock.redeemVoucher).not.toHaveBeenCalled();
  });

  it('tras "Escanear otro", el QR que sigue frente a la cámara se ignora; otro se procesa enseguida', async () => {
    const user = userEvent.setup();
    apiMock.redeemVoucher
      .mockResolvedValueOnce(cupon())
      .mockResolvedValueOnce(cupon({ id: OTRO_ID, label: "Lavado gratis" }));
    renderPage();

    escanear(LINK);
    expect(await screen.findByText("15% de descuento en el taller")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Escanear otro" }));
    // El cliente sigue con el celular enfrente: no se reintenta (sería un 409).
    escanear(LINK);
    escanear(LINK);
    expect(apiMock.redeemVoucher).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("camara")).toBeInTheDocument();

    // El siguiente cliente, sin recargar.
    escanear(`https://qr.test.local/v/${OTRO_ID}`);
    expect(await screen.findByText("Lavado gratis")).toBeInTheDocument();
    expect(apiMock.redeemVoucher).toHaveBeenLastCalledWith(OTRO_ID);
    expect(apiMock.redeemVoucher).toHaveBeenCalledTimes(2);
  });

  it("el mismo código se puede volver a escanear después de un rato sin verlo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    apiMock.redeemVoucher
      .mockResolvedValueOnce(cupon())
      .mockRejectedValueOnce(new ApiError(409, "Este cupón ya fue canjeado"));
    renderPage();

    escanear(LINK);
    expect(await screen.findByText("Cupón canjeado")).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "Escanear otro" }).click());

    vi.setSystemTime(Date.now() + 5000);
    escanear(LINK);
    expect(await screen.findByRole("alert")).toHaveTextContent("Este cupón ya fue canjeado");
    expect(apiMock.redeemVoucher).toHaveBeenCalledTimes(2);
  });

  it("sin cámara: muestra el motivo y se canjea pegando el link a mano", async () => {
    const user = userEvent.setup();
    apiMock.redeemVoucher.mockResolvedValue(cupon());
    renderPage();

    act(() => lector.props!.onUnavailable("No se dio permiso para usar la cámara."));

    expect(screen.queryByTestId("camara")).not.toBeInTheDocument();
    expect(screen.getByText(/No se dio permiso para usar la cámara\./)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Link o código del cupón"), LINK);
    await user.click(screen.getByRole("button", { name: "Canjear" }));

    expect(await screen.findByText("Cupón canjeado")).toBeInTheDocument();
    expect(apiMock.redeemVoucher).toHaveBeenCalledWith(ID);

    // Mismas salidas que con la cámara; "Escanear otro" vuelve al campo, vacío.
    await user.click(screen.getByRole("button", { name: "Escanear otro" }));
    expect(screen.getByLabelText("Link o código del cupón")).toHaveValue("");
    expect(screen.queryByTestId("camara")).not.toBeInTheDocument();
  });

  it("el campo manual acepta el id pelado", async () => {
    const user = userEvent.setup();
    apiMock.redeemVoucher.mockResolvedValue(cupon());
    renderPage();

    await user.type(screen.getByLabelText("Link o código del cupón"), ID);
    await user.click(screen.getByRole("button", { name: "Canjear" }));

    await waitFor(() => expect(apiMock.redeemVoucher).toHaveBeenCalledWith(ID));
  });
});
