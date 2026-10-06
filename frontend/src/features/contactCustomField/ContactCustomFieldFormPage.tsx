import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../../design-system/PageHeader";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { Select } from "../../design-system/Select";
import { useFormDraft } from "../../lib/useFormDraft";
import { TIPO_DE_CAMPO_LABEL, TIPOS_DE_CAMPO } from "./labels";
import { useCreateContactCustomField, useUpdateContactCustomField } from "./mutations";
import { opcionesDesdeTexto } from "./opciones";
import { useContactCustomField } from "./queries";
import type {
  ContactCustomFieldDefinition,
  ContactCustomFieldType,
  CreateContactCustomFieldInput,
} from "./types";

// Los mismos topes que el backend (utils/camposPersonalizados.ts).
const MAX_LABEL = 100;
const MAX_OPCIONES = 50;

interface FormValues {
  label: string;
  type: ContactCustomFieldType;
  // Una opción por renglón: es lo más simple para escribir y leer una lista.
  opciones: string;
  agentEditable: boolean;
}

const EMPTY_FORM: FormValues = { label: "", type: "TEXT", opciones: "", agentEditable: false };

function toFormValues(campo: ContactCustomFieldDefinition): FormValues {
  return {
    label: campo.label,
    type: campo.type,
    opciones: campo.options.join("\n"),
    agentEditable: campo.agentEditable,
  };
}

// ---------------------------------------------------------------------------
// Alta y edición de un campo personalizado de contactos (B6), mismo patrón
// que ServiceTypeFormPage. El TIPO solo se elige al crear: los valores que
// los contactos ya tienen son de ese tipo, y el backend rechaza cambiarlo.
// La clave la asigna el backend desde la etiqueta y no cambia después.
// ---------------------------------------------------------------------------
export function ContactCustomFieldFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const campoQuery = useContactCustomField(isEditMode ? id : undefined);
  const createMutation = useCreateContactCustomField();
  const updateMutation = useUpdateContactCustomField(id ?? "");

  const [values, setValues] = useFormDraft<FormValues>(
    campoQuery.data?.id,
    campoQuery.data ? toFormValues(campoQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const options = values.type === "SELECT" ? opcionesDesdeTexto(values.opciones) : undefined;
    if (values.type === "SELECT" && (options === undefined || options.length === 0)) {
      setError("Una lista necesita al menos una opción: escribí una por renglón.");
      return;
    }
    if (options !== undefined && options.length > MAX_OPCIONES) {
      setError(`Una lista no puede tener más de ${MAX_OPCIONES} opciones.`);
      return;
    }

    try {
      if (isEditMode) {
        await updateMutation.mutateAsync({
          label: values.label.trim(),
          agentEditable: values.agentEditable,
          ...(options !== undefined ? { options } : {}),
        });
      } else {
        const input: CreateContactCustomFieldInput = {
          label: values.label.trim(),
          type: values.type,
          agentEditable: values.agentEditable,
          ...(options !== undefined ? { options } : {}),
        };
        await createMutation.mutateAsync(input);
      }
      navigate("/contact-custom-fields");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar el campo");
    }
  }

  if (isEditMode && campoQuery.isLoading) {
    return <LoadingState variant="lines" />;
  }

  if (isEditMode && campoQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar el campo
        {campoQuery.error instanceof Error ? `: ${campoQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <PageHeader title={isEditMode ? "Editar campo de contacto" : "Nuevo campo de contacto"} />
      <div className="ds-stack">
        <Card heading="Datos del campo">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Etiqueta</span>}>
              <input
                type="text"
                value={values.label}
                maxLength={MAX_LABEL}
                placeholder="Patente del auto"
                onChange={(event) => setValues({ ...values, label: event.target.value })}
                required
              />
            </FormField>

            {/* Suelto, sin FormField: Select trae su propio <label htmlFor>. */}
            <Select
              id="contact-custom-field-type"
              label="Tipo"
              value={values.type}
              options={TIPOS_DE_CAMPO.map((type) => ({
                value: type,
                label: TIPO_DE_CAMPO_LABEL[type],
              }))}
              onChange={(type) => {
                if (type) setValues({ ...values, type });
              }}
              disabled={isEditMode}
              required
            />

            {values.type === "SELECT" ? (
              <div className="ds-field-grid--full">
                <FormField label={<span className="ds-required">Opciones (una por renglón)</span>}>
                  <textarea
                    value={values.opciones}
                    rows={5}
                    placeholder={"Nafta\nDiésel\nGNC"}
                    onChange={(event) => setValues({ ...values, opciones: event.target.value })}
                  />
                </FormField>
              </div>
            ) : null}

            <FormField label="Editable por el agente de IA">
              <input
                type="checkbox"
                checked={values.agentEditable}
                onChange={(event) => setValues({ ...values, agentEditable: event.target.checked })}
              />
            </FormField>
          </div>
          {isEditMode ? (
            <p className="ds-hint">
              El tipo no se puede cambiar: los contactos ya tienen valores de ese tipo. Para
              cambiarlo, eliminá el campo y creá otro.
            </p>
          ) : (
            <p className="ds-hint">
              La clave del campo (la que usa el agente) sale de la etiqueta y no cambia después.
            </p>
          )}
        </Card>

        {error ? <ErrorState>{error}</ErrorState> : null}

        <div>
          <RequiredFieldsHint />
          <Button type="submit" variant="primary" disabled={isSubmitting} loading={isSubmitting}>
            Guardar
          </Button>
        </div>
      </div>
    </form>
  );
}
