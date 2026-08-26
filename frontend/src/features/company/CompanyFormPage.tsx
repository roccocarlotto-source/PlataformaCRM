import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { useFormDraft } from "../../lib/useFormDraft";
import { UserSelect } from "../user/UserSelect";
import { useCreateCompany, useUpdateCompany } from "./mutations";
import { useCompany } from "./queries";
import type { Company, CreateCompanyInput } from "./types";

interface CompanyFormValues {
  name: string;
  domain: string;
  industry: string;
  phone: string;
  city: string;
  country: string;
  // undefined = "no elegido", que es lo que el backend interpreta como
  // "asignar a quien crea". Nunca null: el PATCH no puede limpiar ownerId
  // (chequeo truthy en company.service.ts, ver types.ts).
  ownerId: string | undefined;
}

const EMPTY_FORM: CompanyFormValues = {
  name: "",
  domain: "",
  industry: "",
  phone: "",
  city: "",
  country: "",
  ownerId: undefined,
};

// Los valores del formulario derivados de una Company ya persistida. Antes
// esto vivía adentro de un useEffect que hacía setValues; ahora es una función
// pura y el estado local aparece recién cuando el usuario edita algo — ver
// lib/useFormDraft.ts para por qué el efecto perdía datos.
function toFormValues(company: Company): CompanyFormValues {
  return {
    name: company.name,
    domain: company.domain ?? "",
    industry: company.industry ?? "",
    phone: company.phone ?? "",
    city: company.city ?? "",
    country: company.country ?? "",
    // ?? undefined, no ?? "": Company.ownerId es nullable y UserSelect espera
    // string | undefined. Mismo patrón que companyId en ContactFormPage.
    ownerId: company.ownerId ?? undefined,
  };
}

// Los campos vacíos se envían como undefined (no como "") — el backend los
// trata como "no enviado", consistente con create/update reales.
function toInput(values: CompanyFormValues): CreateCompanyInput {
  return {
    name: values.name,
    domain: values.domain || undefined,
    industry: values.industry || undefined,
    phone: values.phone || undefined,
    city: values.city || undefined,
    country: values.country || undefined,
    ownerId: values.ownerId || undefined,
  };
}

// Un único componente para create y edit — el modo se distingue del propio
// param de ruta (:id), no de una prop separada.
//
// ownerId YA ESTÁ en el formulario. Quedó afuera en M2 por un motivo que dejó
// de ser cierto: entonces no había forma de mostrar un nombre real en vez de un
// UUID crudo, porque el frontend no consumía GET /api/users. M5 lo consumió
// para Opportunity y dejó UserSelect listo, así que replicarlo acá es reusar,
// no construir.
//
// UserSelect se monta suelto, sin envolverlo en FormField: trae su propio
// <label htmlFor>, y FormField ES un <label>, así que anidarlos produciría HTML
// inválido y un getByLabelText ambiguo. Es el mismo trato que le da
// OpportunityFormPage. Mantener el resto del formulario en FormField no es
// inconsistencia: es que este control ya viene resuelto.
//
// Sin emptyOptionLabel: el default del componente ("Asignado a quien crea (por
// defecto)") describe exactamente lo que hace createCompany —resolveOwnerId
// devuelve actorUserId si no se manda nada—, a diferencia de Activity, que
// nunca autoasigna y por eso sí pasa un label propio.
export function CompanyFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const companyQuery = useCompany(isEditMode ? id : undefined);
  const createCompanyMutation = useCreateCompany();
  const updateCompanyMutation = useUpdateCompany(id ?? "");

  const [values, setValues] = useFormDraft<CompanyFormValues>(
    companyQuery.data?.id,
    companyQuery.data ? toFormValues(companyQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createCompanyMutation.isPending || updateCompanyMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      if (isEditMode) {
        await updateCompanyMutation.mutateAsync(toInput(values));
      } else {
        await createCompanyMutation.mutateAsync(toInput(values));
      }
      navigate("/companies");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la empresa");
    }
  }

  if (isEditMode && companyQuery.isLoading) {
    return <LoadingState />;
  }

  if (isEditMode && companyQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la empresa
        {companyQuery.error instanceof Error ? `: ${companyQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{isEditMode ? "Editar empresa" : "Nueva empresa"}</h1>
      <FormField label="Nombre">
        <input
          type="text"
          value={values.name}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
          required
        />
      </FormField>
      <FormField label="Dominio">
        <input
          type="text"
          value={values.domain}
          onChange={(event) => setValues({ ...values, domain: event.target.value })}
        />
      </FormField>
      <FormField label="Industria">
        <input
          type="text"
          value={values.industry}
          onChange={(event) => setValues({ ...values, industry: event.target.value })}
        />
      </FormField>
      <FormField label="Teléfono">
        <input
          type="text"
          value={values.phone}
          onChange={(event) => setValues({ ...values, phone: event.target.value })}
        />
      </FormField>
      <FormField label="Ciudad">
        <input
          type="text"
          value={values.city}
          onChange={(event) => setValues({ ...values, city: event.target.value })}
        />
      </FormField>
      <FormField label="País">
        <input
          type="text"
          value={values.country}
          onChange={(event) => setValues({ ...values, country: event.target.value })}
        />
      </FormField>
      <UserSelect
        id="company-form-owner"
        label="Propietario"
        value={values.ownerId}
        onChange={(ownerId) => setValues({ ...values, ownerId: ownerId || undefined })}
      />
      {error ? <ErrorState>{error}</ErrorState> : null}
      <Button type="submit" variant="primary" disabled={isSubmitting}>
        {isSubmitting ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
