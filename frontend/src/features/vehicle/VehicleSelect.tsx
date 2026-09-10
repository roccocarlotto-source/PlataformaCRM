import { useEffect, useState } from "react";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { priceCell, unitTitle } from "./format";
import { STATUS_BADGE_VARIANT, STATUS_LABELS } from "./labels";
import { useVehicle, useVehicles } from "./queries";

interface VehicleSelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  // null = quitar el vínculo (a diferencia de ContactSelect, que nunca limpia:
  // Opportunity.vehicleId sí admite null en update, ver opportunity/types.ts).
  onChange: (vehicleId: string | null) => void;
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
// La búsqueda filtra status=AVAILABLE: vincular cualquier otra el backend la
// rechaza con 409 (assertVehicleAvailable en opportunity.service.ts), así que
// ofrecerla sería ofrecer un error. La unidad seleccionada, en cambio, se
// resuelve SIN ese filtro: una oportunidad abierta tiene su unidad RESERVED y
// una ganada la tiene SOLD — es el caso normal, no una excepción — y tiene
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
export function VehicleSelect({ id, label, value, onChange }: VehicleSelectProps) {
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedTerm(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [term]);

  const searchQuery = useVehicles(
    { q: debouncedTerm || undefined, status: ["AVAILABLE"], pageSize: 20 },
    { enabled: debouncedTerm.length > 0 },
  );

  const selectedVehicleQuery = useVehicle(value);

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {value ? (
        <p>
          Seleccionada:{" "}
          {selectedVehicleQuery.data ? (
            <>
              {unitTitle(selectedVehicleQuery.data)} · {priceCell(selectedVehicleQuery.data)}{" "}
              <Badge variant={STATUS_BADGE_VARIANT[selectedVehicleQuery.data.status]}>
                {STATUS_LABELS[selectedVehicleQuery.data.status]}
              </Badge>
            </>
          ) : selectedVehicleQuery.isLoading ? (
            "Cargando…"
          ) : (
            "No pudimos cargar la unidad seleccionada."
          )}{" "}
          <Button onClick={() => onChange(null)}>Quitar vínculo</Button>
        </p>
      ) : null}
      <input
        id={id}
        type="text"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Buscar disponible por marca, modelo, patente, VIN o código…"
      />
      {debouncedTerm ? (
        <ul>
          {searchQuery.isLoading ? <li>Buscando…</li> : null}
          {searchQuery.isError ? <li role="alert">No pudimos buscar unidades.</li> : null}
          {searchQuery.isSuccess && searchQuery.data.data.length === 0 ? (
            <li>Sin unidades disponibles para esa búsqueda.</li>
          ) : null}
          {searchQuery.isSuccess
            ? searchQuery.data.data.map((vehicle) => (
                <li key={vehicle.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(vehicle.id);
                      setTerm("");
                    }}
                  >
                    {unitTitle(vehicle)} · {priceCell(vehicle)}
                  </button>
                </li>
              ))
            : null}
        </ul>
      ) : null}
    </div>
  );
}
