import { InlineLoading } from "../../design-system/LoadingState";
import { MultiSelect } from "../../design-system/MultiSelect";
import { BRANCHES_PARA_SELECT, useBranches } from "../branch/queries";

// Las sedes de una Recepción, al invitarla o al editarla (docs/rubros.md
// §11.5, R20). Solo se monta en una clínica. El backend exige al menos una
// (400 SEDES_OBLIGATORIAS) y valida que sean de la organización.
export function SedesSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string[];
  onChange: (branchIds: string[]) => void;
}) {
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);

  if (branchesQuery.isSuccess) {
    return (
      <MultiSelect
        id={id}
        label="Sedes"
        options={branchesQuery.data.data.map((b) => ({ value: b.id, label: b.name }))}
        value={value}
        onChange={onChange}
        emptyLabel="Elegir sedes…"
      />
    );
  }
  return (
    <div>
      <label htmlFor={id}>Sedes</label>
      {branchesQuery.isLoading ? <InlineLoading /> : null}
      {branchesQuery.isError ? <p role="alert">No pudimos cargar las sedes.</p> : null}
    </div>
  );
}
