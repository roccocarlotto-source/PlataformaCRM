import { Link } from "react-router-dom";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import type { Opportunity } from "../opportunity/types";
import { vehicleLabel } from "../quote/format";
import { useVehicles } from "./queries";
import { LoadingState } from "../../design-system/LoadingState";

export interface TradeInSectionProps {
  opportunity: Pick<Opportunity, "id">;
}

// Tope del listado del backend (B-21). Una venta con más de un puñado de
// autos en permuta no existe en la práctica; no hace falta paginar.
const TRADE_IN_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Tarjeta "Permuta" de la ficha de la oportunidad (§41 de
// docs/frontend-cambios-pendientes.md), debajo de Cotización y Entrega.
//
// A diferencia de Entrega, se muestra SIEMPRE en edición: la permuta se carga
// durante la negociación, con la oportunidad abierta, ganada o perdida. Lista
// las unidades del stock vinculadas a esta venta (GET
// /vehicles?tradeInOpportunityId=) — cero, una o varias — con un link a su
// ficha, y un botón que lleva al alta de unidad con el origen y el vínculo ya
// puestos. No es un feature propio: es una lectura con un filtro más sobre
// features/vehicle, y el alta es la ficha de siempre.
//
// El valor acordado vive en la ficha de la unidad y NO se descuenta solo del
// monto ni de la cotización: lo dice la propia tarjeta, para que nadie lo
// asuma.
//
// Vive en OpportunityFormPage, que es ADMIN-only, igual que /vehicles/new y
// /vehicles/:id/edit: no hay gating por rol acá.
// ---------------------------------------------------------------------------
export function TradeInSection({ opportunity }: TradeInSectionProps) {
  const vehiclesQuery = useVehicles({
    tradeInOpportunityId: opportunity.id,
    pageSize: TRADE_IN_PAGE_SIZE,
    sortBy: "createdAt",
    sortOrder: "asc",
  });
  const vehicles = vehiclesQuery.data?.data ?? [];

  return (
    <div className="ds-form ds-stack ds-trade-in-section">
      <Card heading="Permuta" aria-label="Permuta">
        <div className="ds-trade-in">
          {vehiclesQuery.isError ? (
            <ErrorState>
              No pudimos cargar los autos en permuta
              {vehiclesQuery.error instanceof Error ? `: ${vehiclesQuery.error.message}` : "."}
            </ErrorState>
          ) : vehiclesQuery.isLoading ? (
            <LoadingState variant="lines" count={2} />
          ) : vehicles.length === 0 ? (
            <p className="ds-hint">El cliente no entregó ningún auto en esta venta.</p>
          ) : (
            <ul className="ds-trade-in-list" aria-label="Autos recibidos en permuta">
              {vehicles.map((vehicle) => (
                <li key={vehicle.id}>
                  <Link to={`/vehicles/${vehicle.id}/edit`}>{vehicleLabel(vehicle)}</Link>
                </li>
              ))}
            </ul>
          )}
          <p className="ds-hint">
            El valor de la permuta no se descuenta solo del monto ni de la cotización.
          </p>
          <div>
            <Link
              to={`/vehicles/new?tradeInOpportunityId=${encodeURIComponent(opportunity.id)}`}
              className="ds-link-button"
            >
              Agregar auto en permuta
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
