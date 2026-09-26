import { Select } from "../../design-system/Select";
import { RESOURCES_PARA_SELECT, useResources } from "./queries";
import { InlineLoading } from "../../design-system/LoadingState";

interface ResourceSelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  onChange: (resourceId: string) => void;
  // Si viene, solo se ofrecen los recursos de esa sucursal. El filtro es LOCAL
  // sobre RESOURCES_PARA_SELECT (ver queries.ts): la misma request sirve para
  // cualquier sucursal y para resolver nombres en los listados.
  branchId?: string;
  emptyOptionLabel?: string;
  required?: boolean;
  disabled?: boolean;
}

// Selector de recurso — plantilla directa: branch/BranchSelect.tsx, con el
// mismo reparto (cargada, Select trae el rótulo; antes, el rótulo va con el
// aviso de carga o de error debajo) y la misma lectura abierta: GET
// /api/resources es `authenticate` a secas (resource.routes.ts), así que se
// puede montar fuera de AdminRoute sin producir un 403 — lo hace el filtro del
// listado de Reservas.
export function ResourceSelect({
  id,
  label,
  value,
  onChange,
  branchId,
  emptyOptionLabel = "Elegir recurso…",
  required = false,
  disabled = false,
}: ResourceSelectProps) {
  const resourcesQuery = useResources(RESOURCES_PARA_SELECT);

  if (resourcesQuery.isSuccess) {
    const recursos = resourcesQuery.data.data.filter(
      (resource) => branchId === undefined || resource.branchId === branchId,
    );
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={recursos.map((resource) => ({ value: resource.id, label: resource.name }))}
        emptyOption={{ label: emptyOptionLabel }}
        required={required}
        disabled={disabled}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id}>{required ? <span className="ds-required">{label}</span> : label}</label>
      {resourcesQuery.isLoading ? <InlineLoading /> : null}
      {resourcesQuery.isError ? (
        <p role="alert">
          No pudimos cargar los recursos
          {resourcesQuery.error instanceof Error ? `: ${resourcesQuery.error.message}` : "."}
        </p>
      ) : null}
    </div>
  );
}
