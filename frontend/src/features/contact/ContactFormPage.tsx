import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CompanySelect } from "../company/CompanySelect";
import { useCreateContact, useUpdateContact } from "./mutations";
import { useContact } from "./queries";
import type { CreateContactInput, LifecycleStage } from "./types";

interface ContactFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  lifecycleStage: LifecycleStage;
  source: string;
  companyId: string | undefined;
}

const EMPTY_FORM: ContactFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  jobTitle: "",
  lifecycleStage: "LEAD",
  source: "",
  companyId: undefined,
};

// Los campos de texto vacíos se envían como undefined (no como ""),
// consistente con el patrón ya usado en Company. companyId se envía tal
// cual esté en el estado del form — nunca se ofrece limpiarlo a partir de
// un valor ya persistido (ver CompanySelect: sin botón de "quitar").
function toInput(values: ContactFormValues): CreateContactInput {
  return {
    firstName: values.firstName,
    lastName: values.lastName,
    email: values.email || undefined,
    phone: values.phone || undefined,
    jobTitle: values.jobTitle || undefined,
    lifecycleStage: values.lifecycleStage,
    source: values.source || undefined,
    companyId: values.companyId,
  };
}

// Un único componente para create y edit — el modo se distingue del propio
// param de ruta (:id), mismo patrón que CompanyFormPage. ownerId queda
// deliberadamente fuera de este formulario (mismo motivo que Company: sin
// GET /api/users consumido todavía, no hay forma de mostrar nombres reales).
export function ContactFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const contactQuery = useContact(isEditMode ? id : undefined);
  const createContactMutation = useCreateContact();
  const updateContactMutation = useUpdateContact(id ?? "");

  const [values, setValues] = useState<ContactFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditMode && contactQuery.data) {
      setValues({
        firstName: contactQuery.data.firstName,
        lastName: contactQuery.data.lastName,
        email: contactQuery.data.email ?? "",
        phone: contactQuery.data.phone ?? "",
        jobTitle: contactQuery.data.jobTitle ?? "",
        lifecycleStage: contactQuery.data.lifecycleStage,
        source: contactQuery.data.source ?? "",
        companyId: contactQuery.data.companyId ?? undefined,
      });
    }
  }, [isEditMode, contactQuery.data]);

  const isSubmitting = createContactMutation.isPending || updateContactMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      if (isEditMode) {
        await updateContactMutation.mutateAsync(toInput(values));
      } else {
        await createContactMutation.mutateAsync(toInput(values));
      }
      navigate("/contacts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el contacto");
    }
  }

  if (isEditMode && contactQuery.isLoading) {
    return <p>Cargando…</p>;
  }

  if (isEditMode && contactQuery.isError) {
    return (
      <p role="alert">
        No pudimos cargar el contacto
        {contactQuery.error instanceof Error ? `: ${contactQuery.error.message}` : "."}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{isEditMode ? "Editar contacto" : "Nuevo contacto"}</h1>
      <label>
        Nombre
        <input
          type="text"
          value={values.firstName}
          onChange={(event) => setValues({ ...values, firstName: event.target.value })}
          required
        />
      </label>
      <label>
        Apellido
        <input
          type="text"
          value={values.lastName}
          onChange={(event) => setValues({ ...values, lastName: event.target.value })}
          required
        />
      </label>
      <label>
        Email
        <input
          type="email"
          value={values.email}
          onChange={(event) => setValues({ ...values, email: event.target.value })}
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
        Puesto
        <input
          type="text"
          value={values.jobTitle}
          onChange={(event) => setValues({ ...values, jobTitle: event.target.value })}
        />
      </label>
      <label>
        Etapa
        <select
          value={values.lifecycleStage}
          onChange={(event) =>
            setValues({ ...values, lifecycleStage: event.target.value as LifecycleStage })
          }
        >
          <option value="LEAD">LEAD</option>
          <option value="MQL">MQL</option>
          <option value="SQL">SQL</option>
          <option value="CUSTOMER">CUSTOMER</option>
          <option value="CHURNED">CHURNED</option>
        </select>
      </label>
      <label>
        Fuente
        <input
          type="text"
          value={values.source}
          onChange={(event) => setValues({ ...values, source: event.target.value })}
        />
      </label>
      <CompanySelect
        id="contact-form-company"
        label="Empresa"
        value={values.companyId}
        onChange={(companyId) => setValues({ ...values, companyId })}
      />
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
