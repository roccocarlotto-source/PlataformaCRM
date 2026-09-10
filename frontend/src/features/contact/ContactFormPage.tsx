import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { CompanySelect } from "../company/CompanySelect";
import { UserSelect } from "../user/UserSelect";
import { LIFECYCLE_STAGE_LABELS, LIFECYCLE_STAGES } from "./labels";
import { useCreateContact, useUpdateContact } from "./mutations";
import { useContact } from "./queries";
import type { Contact, CreateContactInput, LifecycleStage } from "./types";
import { useFormDraft } from "../../lib/useFormDraft";

interface ContactFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  lifecycleStage: LifecycleStage;
  source: string;
  companyId: string | undefined;
  // Mismo criterio que companyId: undefined = "no elegido". En creación
  // arranca en el id de quien crea (ver initialValues). Nunca null — el
  // PATCH no puede limpiar ownerId (chequeo truthy en contact.service.ts).
  ownerId: string | undefined;
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
  ownerId: undefined,
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
    ownerId: values.ownerId || undefined,
  };
}

// Valores del formulario derivados de un registro ya persistido. Antes esto
// vivía adentro de un useEffect que hacía setValues; ahora es una función pura
// y el estado local aparece recién cuando el usuario edita algo — ver
// lib/useFormDraft.ts para por qué ese efecto perdía datos.
function toFormValues(data: Contact): ContactFormValues {
  return {
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email ?? "",
    phone: data.phone ?? "",
    jobTitle: data.jobTitle ?? "",
    lifecycleStage: data.lifecycleStage,
    source: data.source ?? "",
    companyId: data.companyId ?? undefined,
    // ?? undefined por lo mismo que companyId justo arriba: el campo es
    // nullable en la API y UserSelect espera string | undefined.
    ownerId: data.ownerId ?? undefined,
  };
}

// Un único componente para create y edit — el modo se distingue del propio
// param de ruta (:id), mismo patrón que CompanyFormPage.
//
// ownerId YA ESTÁ en el formulario, por el mismo motivo que en Company: el gap
// de M3 era que no había GET /api/users consumido y un UUID crudo no es un
// control aceptable. M5 lo consumió y dejó UserSelect listo.
//
// Propietario arranca preseleccionado en quien crea, igual que en Company
// (ítem 7 de docs/frontend-cambios-pendientes.md): createContact llama al
// MISMO resolveOwnerId que createCompany (ownership.service.ts) y
// autoasignaría igual si no se mandara nada, pero la opción "Asignado a quien
// crea (por defecto)" al lado del mismo usuario en la lista era redundante.
// Con clearable={false}, UserSelect no renderiza opción vacía mientras haya
// un valor (el PATCH no puede limpiar ownerId: chequeo truthy en
// contact.service.ts); emptyOptionLabel="Sin asignar" solo se ve al editar un
// contacto viejo con ownerId null, donde guardar sin tocar el campo NO asigna
// a nadie. Verificado en el service, no asumido por analogía.
//
// CompanySelect y UserSelect se montan sueltos, sin envolverlos en FormField:
// traen su propio <label htmlFor>, y FormField ES un <label>, así que
// anidarlos produciría HTML inválido y un getByLabelText ambiguo. Mismo trato
// que en CompanyFormPage y OpportunityFormPage. Su restyle interno es una
// tarea aparte, compartida por varios módulos.
//
// Etapa es un <select> normal, no un Badge: Badge es solo para mostrar el
// estado, no para elegirlo.
export function ContactFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();
  const { me } = useAuth();

  const contactQuery = useContact(isEditMode ? id : undefined);
  const createContactMutation = useCreateContact();
  const updateContactMutation = useUpdateContact(id ?? "");

  // Solo en creación: el propietario inicial es quien está creando. En
  // edición el valor viene del registro (toFormValues), y si no tiene dueño
  // queda undefined — no se inventa uno.
  const initialValues: ContactFormValues = isEditMode
    ? EMPTY_FORM
    : { ...EMPTY_FORM, ownerId: me?.id };

  const [values, setValues] = useFormDraft<ContactFormValues>(
    contactQuery.data?.id,
    contactQuery.data ? toFormValues(contactQuery.data) : initialValues,
  );
  const [error, setError] = useState<string | null>(null);

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
    return <LoadingState />;
  }

  if (isEditMode && contactQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar el contacto
        {contactQuery.error instanceof Error ? `: ${contactQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  // Restyle según "Nuevo contacto CRM" de Claude Design, con las piezas que
  // dejó el restyle de Empresas (Card, .ds-form, .ds-field-grid,
  // .ds-required): una tarjeta con los campos de a pares en el orden del
  // diseño — Nombre + Apellido, Email + Teléfono, Puesto + Empresa, Fuente +
  // Etapa, Propietario solo en la última fila (a media columna, como en el
  // export). El "*" va SOLO en los dos campos que de verdad llevan `required`
  // (Nombre, Apellido); el diseño también marca Email pero el formulario no
  // lo exige y no se inventa esa validación. Fuente sigue siendo texto libre
  // aunque el diseño lo dibuje como desplegable: no hay opciones reales que
  // ofrecer. La segunda tarjeta "Campos personalizados" del export no existe
  // en Contact. Guardar sigue al pie, como en el resto de los módulos.
  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>{isEditMode ? "Editar contacto" : "Nuevo contacto"}</h1>
      <div className="ds-stack">
        <Card heading="Datos del contacto">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Nombre</span>}>
              <input
                type="text"
                value={values.firstName}
                onChange={(event) => setValues({ ...values, firstName: event.target.value })}
                required
              />
            </FormField>
            <FormField label={<span className="ds-required">Apellido</span>}>
              <input
                type="text"
                value={values.lastName}
                onChange={(event) => setValues({ ...values, lastName: event.target.value })}
                required
              />
            </FormField>
            <FormField label="Email">
              <input
                type="email"
                value={values.email}
                onChange={(event) => setValues({ ...values, email: event.target.value })}
              />
            </FormField>
            <FormField label="Teléfono">
              <input
                type="text"
                value={values.phone}
                onChange={(event) => setValues({ ...values, phone: event.target.value })}
              />
            </FormField>
            <FormField label="Puesto">
              <input
                type="text"
                value={values.jobTitle}
                onChange={(event) => setValues({ ...values, jobTitle: event.target.value })}
              />
            </FormField>
            <CompanySelect
              id="contact-form-company"
              label="Empresa"
              value={values.companyId}
              onChange={(companyId) => setValues({ ...values, companyId })}
            />
            <FormField label="Fuente">
              <input
                type="text"
                value={values.source}
                onChange={(event) => setValues({ ...values, source: event.target.value })}
              />
            </FormField>
            <FormField label="Etapa">
              <select
                value={values.lifecycleStage}
                onChange={(event) =>
                  setValues({ ...values, lifecycleStage: event.target.value as LifecycleStage })
                }
              >
                {LIFECYCLE_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {LIFECYCLE_STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
            </FormField>
            <UserSelect
              id="contact-form-owner"
              label="Propietario"
              value={values.ownerId}
              onChange={(ownerId) => setValues({ ...values, ownerId: ownerId || undefined })}
              emptyOptionLabel="Sin asignar"
              clearable={false}
            />
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
