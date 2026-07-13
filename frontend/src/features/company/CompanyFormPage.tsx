import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCreateCompany, useUpdateCompany } from "./mutations";
import { useCompany } from "./queries";
import type { CreateCompanyInput } from "./types";

interface CompanyFormValues {
  name: string;
  domain: string;
  industry: string;
  phone: string;
  city: string;
  country: string;
}

const EMPTY_FORM: CompanyFormValues = {
  name: "",
  domain: "",
  industry: "",
  phone: "",
  city: "",
  country: "",
};

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
  };
}

// Un único componente para create y edit — el modo se distingue del propio
// param de ruta (:id), no de una prop separada. ownerId queda deliberadamente
// fuera de este formulario: ver types.ts y el informe de M2 para el gap
// (no hay forma de resolver nombres de usuario sin traer el módulo de Users,
// fuera de alcance de este ciclo — el backend ya asigna el owner por default
// a quien crea si no se envía nada).
export function CompanyFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const companyQuery = useCompany(isEditMode ? id : undefined);
  const createCompanyMutation = useCreateCompany();
  const updateCompanyMutation = useUpdateCompany(id ?? "");

  const [values, setValues] = useState<CompanyFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditMode && companyQuery.data) {
      setValues({
        name: companyQuery.data.name,
        domain: companyQuery.data.domain ?? "",
        industry: companyQuery.data.industry ?? "",
        phone: companyQuery.data.phone ?? "",
        city: companyQuery.data.city ?? "",
        country: companyQuery.data.country ?? "",
      });
    }
  }, [isEditMode, companyQuery.data]);

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
    return <p>Cargando…</p>;
  }

  if (isEditMode && companyQuery.isError) {
    return (
      <p role="alert">
        No pudimos cargar la empresa
        {companyQuery.error instanceof Error ? `: ${companyQuery.error.message}` : "."}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{isEditMode ? "Editar empresa" : "Nueva empresa"}</h1>
      <label>
        Nombre
        <input
          type="text"
          value={values.name}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
          required
        />
      </label>
      <label>
        Dominio
        <input
          type="text"
          value={values.domain}
          onChange={(event) => setValues({ ...values, domain: event.target.value })}
        />
      </label>
      <label>
        Industria
        <input
          type="text"
          value={values.industry}
          onChange={(event) => setValues({ ...values, industry: event.target.value })}
        />
      </label>
      <label>
        Teléfono
        <input
          type="text"
          value={values.phone}
          onChange={(event) => setValues({ ...values, phone: event.target.value })}
        />
      </label>
      <label>
        Ciudad
        <input
          type="text"
          value={values.city}
          onChange={(event) => setValues({ ...values, city: event.target.value })}
        />
      </label>
      <label>
        País
        <input
          type="text"
          value={values.country}
          onChange={(event) => setValues({ ...values, country: event.target.value })}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
