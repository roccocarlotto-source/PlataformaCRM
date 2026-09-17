import { Select } from "../../design-system/Select";
import { BRANCHES_PARA_SELECT, useBranches } from "./queries";

interface BranchSelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  onChange: (branchId: string) => void;
  // Texto de la fila vacía. En un formulario es "elegí una" (el backend
  // exige branchId); como filtro de listado es "Todas".
  emptyOptionLabel?: string;
  // Obligatorio: "*" de .ds-required en el rótulo Y `required` en el input
  // del selector, siempre juntos (mismo contrato que PipelineSelect/
  // StageSelect). Lo pasan los formularios que exigen sucursal (QR, Vehículo,
  // Claim); el filtro del listado de QR no. El selector solo existe con la
  // lista cargada: cada formulario cubre ese hueco con su propio chequeo.
  required?: boolean;
}

// Selector de sucursal del módulo QR (docs/qr-integration.md, Fase 3,
// decisión 5) — plantilla directa: UserSelect.tsx. Combobox del design system
// (Select, §44 de docs/frontend-cambios-pendientes.md) de una sola línea, sin
// subtítulo; tipear filtra localmente la página ya traída, sin pedir `search`
// al backend. pageSize al máximo del contrato; ver BRANCHES_PARA_SELECT en
// queries.ts por el riesgo residual de más de 100 sucursales.
//
// GET /api/branches es de lectura abierta a cualquier usuario autenticado de
// la organización (branch.routes.ts: solo `authenticate`), así que este
// componente puede montarse fuera de AdminRoute sin producir un 403 — a
// diferencia de UserSelect. El aislamiento por organización lo garantiza el
// backend: la lista solo trae sucursales del tenant del JWT.
export function BranchSelect({
  id,
  label,
  value,
  onChange,
  emptyOptionLabel = "Elegir sucursal…",
  required = false,
}: BranchSelectProps) {
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);

  // Mismo reparto que UserSelect: cargada, Select trae el rótulo; antes, el
  // rótulo va con el aviso de carga o de error debajo.
  if (branchesQuery.isSuccess) {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        options={branchesQuery.data.data.map((branch) => ({
          value: branch.id,
          label: branch.name,
        }))}
        emptyOption={{ label: emptyOptionLabel }}
        required={required}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id}>{required ? <span className="ds-required">{label}</span> : label}</label>
      {branchesQuery.isLoading ? <p>Cargando…</p> : null}
      {branchesQuery.isError ? (
        <p role="alert">
          No pudimos cargar las sucursales
          {branchesQuery.error instanceof Error ? `: ${branchesQuery.error.message}` : "."}
        </p>
      ) : null}
    </div>
  );
}
