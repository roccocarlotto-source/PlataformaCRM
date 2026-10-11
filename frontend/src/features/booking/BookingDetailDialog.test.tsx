import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeBooking } from "../../test/bookingFixtures";
import {
  VOCABULARIO_DE_CLINICA_POR_DEFECTO,
  type VocabularioCompleto,
} from "../../auth/vocabulario";
import { BookingDetailDialog } from "./BookingDetailDialog";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// R13 (docs/rubros.md §6.4): "Confirmado por el paciente" en el detalle del
// turno. Solo lo trae una clínica (CAMPOS_DE_CLINICA lo saca de una
// automotora); sin el campo, el detalle es el de siempre.
// Una clínica con contactTerm PACIENTE, salvo que se pida otro vocabulario.
function renderDialog(
  patientConfirmedAt: string | null | undefined,
  vocabulario: VocabularioCompleto = VOCABULARIO_DE_CLINICA_POR_DEFECTO,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BookingDetailDialog
        vocabulario={vocabulario}
        esClinica
        booking={makeBooking(patientConfirmedAt === undefined ? {} : { patientConfirmedAt })}
        contactName="Paciente Ejemplo"
        serviceName="Consulta"
        resourceName="Ana"
        zona="America/Montevideo"
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe("BookingDetailDialog — confirmación del paciente", () => {
  it("con patientConfirmedAt muestra «Confirmado por el paciente»", () => {
    renderDialog("2027-02-28T12:00:00.000Z");
    expect(screen.getByText("Confirmado por el paciente")).toBeInTheDocument();
  });

  it("con contactTerm CLIENTE dice «Confirmado por el cliente», no «paciente» fijo", () => {
    renderDialog("2027-02-28T12:00:00.000Z", {
      ...VOCABULARIO_DE_CLINICA_POR_DEFECTO,
      contacto: {
        singular: "cliente",
        plural: "clientes",
        singularTitulo: "Cliente",
        pluralTitulo: "Clientes",
        genero: "masculino",
      },
    });
    expect(screen.getByText("Confirmado por el cliente")).toBeInTheDocument();
    expect(screen.getByText("Cliente")).toBeInTheDocument();
  });

  it("sin el campo (una automotora) o sin confirmar, no muestra nada", () => {
    renderDialog(undefined);
    expect(screen.queryByText("Confirmado por el paciente")).not.toBeInTheDocument();
  });

  it("con null tampoco", () => {
    renderDialog(null);
    expect(screen.queryByText("Confirmación")).not.toBeInTheDocument();
  });
});
