import { BRANCHES_PARA_SELECT, useBranches } from "./queries";

interface BranchSelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  onChange: (branchId: string) => void;
  // Texto de la opción vacía. En un formulario es "elegí una" (el backend
  // exige branchId); como filtro de listado es "Todas".
  emptyOptionLabel?: string;
  // Obligatorio: "*" de .ds-required en el rótulo Y `required` en el
  // <select>, siempre juntos (mismo contrato que PipelineSelect/StageSelect).
  // Lo pasan los formularios que exigen sucursal (QR, Vehículo, Claim); el
  // filtro del listado de QR no. El <select> solo existe con la lista
  // cargada: cada formulario cubre ese hueco con su propio chequeo.
  required?: boolean;
}

// Selector de sucursal del módulo QR (docs/qr-integration.md, Fase 3,
// decisión 5) — plantilla directa: UserSelect.tsx. <select> simple, sin
// búsqueda de texto, pageSize al máximo del contrato; ver BRANCHES_PARA_SELECT
// en queries.ts por el riesgo residual de más de 100 sucursales.
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
      {branchesQuery.isSuccess ? (
        <select
          id={id}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          required={required}
        >
          <option value="">{emptyOptionLabel}</option>
          {branchesQuery.data.data.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
