import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { Select } from "../../design-system/Select";
import { useFormDraft } from "../../lib/useFormDraft";
import { getContactCustomFieldOptionUsage } from "./api";
import { TIPO_DE_CAMPO_LABEL, TIPOS_DE_CAMPO } from "./labels";
import { useCreateContactCustomField, useUpdateContactCustomField } from "./mutations";
import {
  cambiosDeOpciones,
  cambiosEnUso,
  filasDesdeOpciones,
  opcionesAgregadas,
  validarFilas,
  type FilaDeOpcion,
} from "./opciones";
import { OptionChangesDialog } from "./OptionChangesDialog";
import { OptionListEditor } from "./OptionListEditor";
import { useContactCustomField } from "./queries";
import {
  tieneOpciones,
  type ContactCustomFieldDefinition,
  type ContactCustomFieldType,
  type CreateContactCustomFieldInput,
  type DecisionSobreEliminada,
  type UpdateContactCustomFieldInput,
} from "./types";

// El mismo tope que el backend (utils/camposPersonalizados.ts).
const MAX_LABEL = 100;

interface FormValues {
  label: string;
  type: ContactCustomFieldType;
  // Las opciones de una lista, una por fila (OptionListEditor).
  opciones: FilaDeOpcion[];
  agentEditable: boolean;
}

// Una lista nueva arranca con una fila vacía lista para escribir.
const EMPTY_FORM: FormValues = {
  label: "",
  type: "TEXT",
  opciones: [{ id: "inicial", texto: "" }],
  agentEditable: false,
};

function toFormValues(campo: ContactCustomFieldDefinition): FormValues {
  return {
    label: campo.label,
    type: campo.type,
    opciones: filasDesdeOpciones(campo.options),
    agentEditable: campo.agentEditable,
  };
}

// ---------------------------------------------------------------------------
// Alta y edición de un campo personalizado de contactos (B6), mismo patrón
// que ServiceTypeFormPage. El TIPO solo se elige al crear: los valores que
// los contactos ya tienen son de ese tipo, y el backend rechaza cambiarlo.
// La clave la asigna el backend desde la etiqueta y no cambia después.
//
// LAS OPCIONES DE UNA LISTA QUE YA USAN CONTACTOS. Antes de guardar un cambio
// que renombra o elimina opciones guardadas, se le pregunta al backend cuántos
// contactos las tienen elegidas (option-usage) y, si es alguno, se abre
// OptionChangesDialog:
//   - renombrar: esos contactos pasan al texto nuevo (renamedOptions);
//   - eliminar: por cada opción, el ADMIN elige qué hacer con sus contactos
//     (removedOptions): sacarla, pasarla a otra(s) o conservarla como
//     "opción eliminada".
// El backend lo aplica en la misma transacción, solo en esta organización.
//
// EL TIPO se puede cambiar solo entre "Lista de opciones" y "Selección
// múltiple": el backend convierte los valores de los contactos (y rechaza
// volver a lista si alguno tiene más de una opción elegida).
// ---------------------------------------------------------------------------

// Lo que el diálogo necesita saber, mientras está abierto.
interface CambiosPendientes {
  cambios: ReturnType<typeof cambiosDeOpciones>;
  enUso: ReturnType<typeof cambiosEnUso>;
  options: string[];
}
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
  // Las filas de opciones que la última validación marcó para corregir.
  const [filasConError, setFilasConError] = useState<string[]>([]);
  const [verificando, setVerificando] = useState(false);
  const [pendientes, setPendientes] = useState<CambiosPendientes | null>(null);

  const isSubmitting = verificando || createMutation.isPending || updateMutation.isPending;

  // El tipo guardado, en edición; solo entre los que llevan opciones se
  // puede cambiar.
  const tipoGuardado = isEditMode ? campoQuery.data?.type : undefined;
  const puedeCambiarDeTipo = tipoGuardado !== undefined && tieneOpciones(tipoGuardado);
  const tiposOfrecidos: ContactCustomFieldType[] = !isEditMode
    ? TIPOS_DE_CAMPO
    : puedeCambiarDeTipo
      ? ["SELECT", "MULTI_SELECT"]
      : [values.type];

  // El PATCH de una edición, con las decisiones del diálogo si las hubo.
  async function guardarEdicion(
    campo: ContactCustomFieldDefinition,
    options: string[] | undefined,
    cambios: ReturnType<typeof cambiosDeOpciones>,
    decisiones: Record<string, DecisionSobreEliminada> = {},
  ) {
    const removedOptions = Object.entries(decisiones).map(([from, decision]) => ({
      from,
      ...decision,
    }));
    const input: UpdateContactCustomFieldInput = {
      label: values.label.trim(),
      agentEditable: values.agentEditable,
      ...(values.type !== campo.type ? { type: values.type } : {}),
      ...(options !== undefined ? { options } : {}),
      ...(cambios.renombradas.length > 0 ? { renamedOptions: cambios.renombradas } : {}),
      ...(removedOptions.length > 0 ? { removedOptions } : {}),
    };
    try {
      await updateMutation.mutateAsync(input);
      navigate("/contact-custom-fields");
    } catch (err) {
      setPendientes(null);
      setError(err instanceof Error ? err.message : "No pudimos guardar el campo");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFilasConError([]);

    let options: string[] | undefined;
    if (tieneOpciones(values.type)) {
      const validacion = validarFilas(values.opciones);
      if (!validacion.ok) {
        setError(validacion.mensaje);
        setFilasConError(validacion.filas);
        return;
      }
      options = validacion.opciones;
    }

    if (isEditMode) {
      const campo = campoQuery.data;
      if (!campo) return;
      const cambios =
        options !== undefined
          ? cambiosDeOpciones(campo.options, values.opciones)
          : { renombradas: [], eliminadas: [] };
      if (cambios.renombradas.length === 0 && cambios.eliminadas.length === 0) {
        await guardarEdicion(campo, options, cambios);
        return;
      }
      // Hay opciones renombradas o eliminadas: cuántos contactos las tienen,
      // con el número de ESTE momento.
      let uso: Record<string, number>;
      setVerificando(true);
      try {
        uso = (await getContactCustomFieldOptionUsage(campo.id)).contactsByOption;
      } catch {
        setError(
          "No pudimos verificar cuántos contactos usan las opciones que cambiaste. Probá guardar de nuevo.",
        );
        return;
      } finally {
        setVerificando(false);
      }
      const enUso = cambiosEnUso(cambios, uso);
      if (enUso.renombradas.length === 0 && enUso.eliminadas.length === 0) {
        await guardarEdicion(campo, options, cambios);
        return;
      }
      setPendientes({ cambios, enUso, options: options ?? [] });
      return;
    }

    try {
      {
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
      {pendientes && campoQuery.data ? (
        <OptionChangesDialog
          type={values.type}
          renombradas={pendientes.enUso.renombradas}
          eliminadas={pendientes.enUso.eliminadas}
          opcionesFinales={pendientes.options}
          opcionesAgregadas={opcionesAgregadas(values.opciones)}
          guardando={updateMutation.isPending}
          onConfirm={(decisiones) =>
            void guardarEdicion(
              campoQuery.data!,
              pendientes.options,
              pendientes.cambios,
              decisiones,
            )
          }
          onClose={() => setPendientes(null)}
        />
      ) : null}
      <PageHeader
        help={AYUDA.campoForm}
        title={isEditMode ? "Editar campo de contacto" : "Nuevo campo de contacto"}
      />
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
              options={tiposOfrecidos.map((type) => ({
                value: type,
                label: TIPO_DE_CAMPO_LABEL[type],
              }))}
              onChange={(type) => {
                if (type) setValues({ ...values, type });
              }}
              disabled={isEditMode && !puedeCambiarDeTipo}
              required
            />

            {tieneOpciones(values.type) ? (
              <div className="ds-field-grid--full">
                <OptionListEditor
                  filas={values.opciones}
                  filasConError={filasConError}
                  disabled={isSubmitting}
                  onChange={(opciones) => {
                    setFilasConError([]);
                    setValues({ ...values, opciones });
                  }}
                />
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
          {isEditMode && puedeCambiarDeTipo ? (
            <p className="ds-hint">
              El tipo solo se puede cambiar entre «Lista de opciones» y «Selección múltiple». A
              selección múltiple, cada contacto conserva su opción; a lista, solo si ningún contacto
              tiene más de una opción elegida.
            </p>
          ) : isEditMode ? (
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
