import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Badge } from "../../design-system/Badge";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { descripcionDe, ETIQUETA_DE_ESTADO, formatearFecha } from "./formato";
import { useQuery } from "@tanstack/react-query";
import { vehiculosDelContactoQuery } from "./queries";

// La tarjeta "Vehículos" de la ficha del contacto (docs/servicios.md §4.6).
// SOLO se monta con el módulo Servicios (useModulo en ContactFormPage): sin el
// módulo la ficha no la monta y no llama a /api/servicios, que daría 403
// (§13.1, lo fija ContactFormPage.test.tsx).
export function TarjetaVehiculosDelContacto({
  contactId,
  puedeAgregar,
}: {
  contactId: string;
  // Un contacto con los datos borrados es de solo lectura: no se le agregan.
  puedeAgregar: boolean;
}) {
  const vehiculosQuery = useQuery(vehiculosDelContactoQuery(contactId));

  // Mismo envoltorio que ContactVouchersSection: el ancho de la ficha, y
  // .ds-payment-section para separarla de la sección de arriba.
  return (
    <div className="ds-form ds-stack ds-payment-section">
      <Card heading="Vehículos">
        {vehiculosQuery.isLoading ? <LoadingState variant="rows" /> : null}
        {vehiculosQuery.isError ? <ErrorState>No pudimos cargar sus vehículos.</ErrorState> : null}
        {vehiculosQuery.isSuccess && vehiculosQuery.data.data.length === 0 ? (
          <EmptyState>No tiene vehículos cargados en el taller.</EmptyState>
        ) : null}
        {vehiculosQuery.isSuccess && vehiculosQuery.data.data.length > 0 ? (
          <ul className="ds-stack">
            {vehiculosQuery.data.data.map((v) => (
              <li key={v.id}>
                <Link to={`/taller/vehiculos/${v.id}`}>
                  {[descripcionDe(v), v.licensePlate].filter(Boolean).join(" · ")}
                </Link>
                <div className="ds-cell-muted">
                  {v.remindersOptOut
                    ? "No recordar"
                    : v.nextServiceDueOn
                      ? `Próximo service: ${formatearFecha(v.nextServiceDueOn)}`
                      : "Sin próximo service"}
                  {v.ordenAbierta ? (
                    <>
                      {" "}
                      <Badge variant="info">
                        {`${v.ordenAbierta.numero} · ${ETIQUETA_DE_ESTADO[v.ordenAbierta.status]}`}
                      </Badge>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {puedeAgregar ? (
          <p>
            <Link
              to={`/taller/vehiculos/nuevo?contactId=${encodeURIComponent(contactId)}`}
              className="ds-link-button"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
              Agregar vehículo
            </Link>
          </p>
        ) : null}
      </Card>
    </div>
  );
}
