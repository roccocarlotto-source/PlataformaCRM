import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { priceCell, unitTitle } from "./format";
import { STATUS_BADGE_VARIANT, STATUS_LABELS } from "./labels";
import { useVehicle, useVehicles } from "./queries";
import { InlineLoading } from "../../design-system/LoadingState";
import { SearchSelect } from "../../design-system/SearchSelect";

interface VehicleSelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  // null = quitar el vínculo (a diferencia de ContactSelect, que nunca limpia:
  // Opportunity.vehicleId sí admite null en update, ver opportunity/types.ts).
  onChange: (vehicleId: string | null) => void;
  // Lo que se muestra de la unidad seleccionada si no se puede leer por id
  // (una dada de baja: GET /vehicles/:id ya no la devuelve). Lo usa el
  // vehículo de interés del contacto, que la sigue mostrando con su estado.
  selectedFallback?: ReactNode;
  // El texto del botón que limpia la selección.
  clearLabel?: string;
}

const SEARCH_DEBOUNCE_MS = 300;

// Selector de unidad de stock para Opportunity (Fase 3b). Plantilla exacta:
// features/opportunity/ContactSelect.tsx — búsqueda server-side por texto con
// debounce, que nunca precarga un listado (enabled solo con término), y la
// unidad YA SELECCIONADA resuelta con una query aparte por id (useVehicle),
// independiente de la búsqueda. Vive acá y no en features/opportunity/ por
// el mismo criterio que CompanySelect vive en features/company/: el feature
// dueño del recurso.
//
// La búsqueda filtra las libres, AVAILABLE y UNAVAILABLE ("No disponible", que
// se reserva directo sin quedar ofrecible por el agente en el medio, decisión
// del 07/10/2026): vincular cualquier otra el backend la rechaza con 409
// (assertVehicleAvailable en opportunity.service.ts), así que ofrecerla sería
// ofrecer un error. Una «No disponible» lleva su estado al lado. La unidad seleccionada, en cambio, se
// resuelve SIN ese filtro: una oportunidad abierta tiene su unidad RESERVED y
// una ganada la tiene SOLD o DELIVERED — es el caso normal, no una excepción — y tiene
// que poder mostrarse igual, con su estado al lado.
//
// Cada resultado muestra la unidad como el listado de stock (unitTitle) más
// su precio (priceCell): al vincular, la oportunidad toma ese precio salvo que
// el formulario mande uno explícito, y quien elige tiene que ver cuál es.
//
// No siembra vehicleKeys.detail(id) con los resultados de la búsqueda, a
// diferencia de ContactSelect con contactKeys.detail: el detalle de una
// unidad es VehicleDetail (con `photos`) y una fila del listado no lo trae —
// sembrarla dejaría la ficha con una galería inexistente.
export function VehicleSelect({
  id,
  label,
  value,
  onChange,
  selectedFallback,
  clearLabel = "Quitar vínculo",
}: VehicleSelectProps) {
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedTerm(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [term]);

  const searchQuery = useVehicles(
    { q: debouncedTerm || undefined, status: ["AVAILABLE", "UNAVAILABLE"], pageSize: 20 },
    { enabled: debouncedTerm.length > 0 },
  );

  const selectedVehicleQuery = useVehicle(value);

  return (
    <SearchSelect
      id={id}
      label={label}
      placeholder="Buscar disponible por marca, modelo, patente, VIN o código…"
      term={term}
      onTermChange={setTerm}
      open={debouncedTerm.length > 0}
      selected={
        value
          ? {
              prefix: "Seleccionada",
              content: selectedVehicleQuery.data ? (
                <>
                  {unitTitle(selectedVehicleQuery.data)} · {priceCell(selectedVehicleQuery.data)}{" "}
                  <Badge variant={STATUS_BADGE_VARIANT[selectedVehicleQuery.data.status]}>
                    {STATUS_LABELS[selectedVehicleQuery.data.status]}
                  </Badge>
                </>
              ) : selectedVehicleQuery.isLoading ? (
                <InlineLoading />
              ) : (
                (selectedFallback ?? "No pudimos cargar la unidad seleccionada.")
              ),
              action: <Button onClick={() => onChange(null)}>{clearLabel}</Button>,
            }
          : null
      }
      loading={searchQuery.isLoading}
      error={searchQuery.isError ? "No pudimos buscar unidades." : null}
      results={searchQuery.isSuccess ? searchQuery.data.data : undefined}
      emptyText="Sin unidades disponibles para esa búsqueda."
      getKey={(vehicle) => vehicle.id}
      renderItem={(vehicle) => (
        <>
          {unitTitle(vehicle)} · {priceCell(vehicle)}
          {vehicle.status === "UNAVAILABLE" ? (
            <>
              {" "}
              <Badge variant={STATUS_BADGE_VARIANT.UNAVAILABLE}>{STATUS_LABELS.UNAVAILABLE}</Badge>
            </>
          ) : null}
        </>
      )}
      onSelect={(vehicle) => {
        onChange(vehicle.id);
        setTerm("");
      }}
    />
  );
}
