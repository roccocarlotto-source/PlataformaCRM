import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { useFormDraft } from "../../lib/useFormDraft";
import { useCreateBranch, useUpdateBranch } from "./mutations";
import { useBranch } from "./queries";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS, isKnownTimezone } from "./timezones";
import type { Branch, CreateBranchInput } from "./types";

interface BranchFormValues {
  name: string;
  timezone: string;
}

const EMPTY_FORM: BranchFormValues = {
  name: "",
  timezone: DEFAULT_TIMEZONE,
};

function toFormValues(branch: Branch): BranchFormValues {
  return { name: branch.name, timezone: branch.timezone };
}

// Un único componente para create y edit — el modo se distingue del propio
// param de ruta (:id), mismo patrón que SourceFormPage y CompanyFormPage.
//
// Los dos campos son requeridos en el POST y opcionales-al-menos-uno en el
// PATCH; en edición se mandan los dos siempre, sin diferenciar cuál cambió
// (mismo criterio que Source y que el PATCH de organización, §19): "la
// sucursal queda así" es más simple que un diff, y el backend lo acepta.
export function BranchFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const branchQuery = useBranch(isEditMode ? id : undefined);
  const createBranchMutation = useCreateBranch();
  const updateBranchMutation = useUpdateBranch(id ?? "");

  const [values, setValues] = useFormDraft<BranchFormValues>(
    branchQuery.data?.id,
    branchQuery.data ? toFormValues(branchQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createBranchMutation.isPending || updateBranchMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const input: CreateBranchInput = {
      name: values.name,
      timezone: values.timezone,
    };

    try {
      if (isEditMode) {
        await updateBranchMutation.mutateAsync(input);
      } else {
        await createBranchMutation.mutateAsync(input);
      }
      navigate("/branches");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la sucursal");
    }
  }

  if (isEditMode && branchQuery.isLoading) {
    return <LoadingState />;
  }

  if (isEditMode && branchQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la sucursal
        {branchQuery.error instanceof Error ? `: ${branchQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>{isEditMode ? "Editar sucursal" : "Nueva sucursal"}</h1>
      <div className="ds-stack">
        <Card heading="Datos de la sucursal">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Nombre</span>}>
              <input
                type="text"
                value={values.name}
                onChange={(event) => setValues({ ...values, name: event.target.value })}
                required
              />
            </FormField>

            <FormField label={<span className="ds-required">Zona horaria</span>}>
              <select
                value={values.timezone}
                onChange={(event) => setValues({ ...values, timezone: event.target.value })}
                required
              >
                {/* Valor persistido FUERA de la lista (una sucursal creada por API
                    con "UTC", por ejemplo): se muestra como opción extra mientras
                    sea el vigente, para que el select nunca muestre Montevideo
                    mientras el PATCH manda otra cosa. Mismo criterio que Moneda
                    (§18.B/§19). Ver timezones.ts. */}
                {isKnownTimezone(values.timezone) ? null : (
                  <option value={values.timezone}>{values.timezone}</option>
                )}
                {TIMEZONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </Card>

        {error ? <ErrorState>{error}</ErrorState> : null}

        <div>
          <RequiredFieldsHint />
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </form>
  );
}
