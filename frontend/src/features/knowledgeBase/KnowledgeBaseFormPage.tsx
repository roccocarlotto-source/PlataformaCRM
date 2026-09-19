import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { useFormDraft } from "../../lib/useFormDraft";
import { BranchSelect } from "../branch/BranchSelect";
import { useCreateKnowledgeBaseEntry, useUpdateKnowledgeBaseEntry } from "./mutations";
import { useKnowledgeBaseEntry } from "./queries";
import type {
  CreateKnowledgeBaseEntryInput,
  KnowledgeBaseEntry,
  UpdateKnowledgeBaseEntryInput,
} from "./types";

// Los mismos topes que el backend (knowledgeBaseEntry.controller.ts). El
// maxLength del navegador es comodidad, no la garantía: quien valida es Zod.
const MAX_TITLE = 200;
const MAX_CONTENT = 10_000;

interface KnowledgeBaseFormValues {
  branchId: string | undefined;
  title: string;
  content: string;
  isActive: boolean;
}

const EMPTY_FORM: KnowledgeBaseFormValues = {
  branchId: undefined,
  title: "",
  content: "",
  isActive: true,
};

const PLACEHOLDER_CONTENIDO =
  "Ej.: Atendemos de lunes a viernes de 9 a 18 y los sábados de 9 a 13. El último turno se da media hora antes del cierre.";

function toFormValues(entry: KnowledgeBaseEntry): KnowledgeBaseFormValues {
  return {
    branchId: entry.branchId,
    title: entry.title,
    content: entry.content,
    isActive: entry.isActive,
  };
}

// El error de validación del cliente, o null si el formulario puede viajar.
// Solo mira lo que la validación nativa del navegador NO cubre: Título y
// Contenido llevan `required` y los frena el propio <form>.
function validar(values: KnowledgeBaseFormValues): string | null {
  // El `required` de BranchSelect no alcanza: mientras la lista de sucursales
  // carga, el componente no renderiza ningún input (solo el rótulo y el aviso
  // de carga), así que no hay nada que el navegador pueda frenar. Es el hueco
  // que el propio BranchSelect documenta y que cada formulario cubre por su
  // cuenta. Acá vale para los DOS modos, no solo para la creación: la sucursal
  // se puede cambiar también al editar.
  if (!values.branchId) {
    return "Elegí la sucursal a la que pertenece esta entrada.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Alta y edición de una entrada de la base de conocimiento — el modo se
// distingue del propio param de ruta (:id), mismo patrón que AgentFormPage y
// BranchFormPage.
//
// Cuatro campos, y a propósito no hay más: NO tiene modelo, ni acciones, ni
// canales, ni reglas del agente. Esto es texto que el negocio carga y que se
// suma tal cual al prompt de TODOS los agentes de la sucursal — sin traducción
// y sin confirmación, a diferencia de las reglas del agente (ítem 56), porque
// no hay nada que interpretar: lo que se escribe es lo que el modelo lee.
//
// LA SUCURSAL SÍ SE PUEDE CAMBIAR, y es la diferencia con AgentFormPage —donde
// el selector se muestra deshabilitado en edición. Un Agent no se mueve porque
// sus conversaciones históricas llevan el branchId denormalizado; una entrada
// de KB no tiene nada equivalente, así que mover una FAQ cargada en la
// sucursal equivocada es exactamente lo que alguien quiere poder hacer. Ver la
// nota de UpdateKnowledgeBaseEntryInput en
// src/services/knowledgeBaseEntry.service.ts.
// ---------------------------------------------------------------------------
export function KnowledgeBaseFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const entryQuery = useKnowledgeBaseEntry(isEditMode ? id : undefined);
  const createEntryMutation = useCreateKnowledgeBaseEntry();
  const updateEntryMutation = useUpdateKnowledgeBaseEntry(id ?? "");

  const [values, setValues] = useFormDraft<KnowledgeBaseFormValues>(
    entryQuery.data?.id,
    entryQuery.data ? toFormValues(entryQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createEntryMutation.isPending || updateEntryMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const errorDeValidacion = validar(values);
    if (errorDeValidacion !== null) {
      setError(errorDeValidacion);
      return;
    }

    // Se mandan todos los campos, sin diferenciar cuál cambió (mismo criterio
    // que Agent, Branch y Source): "la entrada queda así" es más simple que un
    // diff, y el PATCH parcial lo acepta. Acá el payload de los dos modos es
    // idéntico —branchId incluido— justamente porque la sucursal es editable.
    const input: CreateKnowledgeBaseEntryInput = {
      // validar() ya garantizó que hay sucursal elegida.
      branchId: values.branchId ?? "",
      title: values.title.trim(),
      content: values.content.trim(),
      isActive: values.isActive,
    };

    try {
      if (isEditMode) {
        await updateEntryMutation.mutateAsync(input satisfies UpdateKnowledgeBaseEntryInput);
      } else {
        await createEntryMutation.mutateAsync(input);
      }
      navigate("/knowledge-base");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la entrada");
    }
  }

  if (isEditMode && entryQuery.isLoading) {
    return <LoadingState />;
  }

  if (isEditMode && entryQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la entrada
        {entryQuery.error instanceof Error ? `: ${entryQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>{isEditMode ? "Editar entrada" : "Nueva entrada"}</h1>
      <div className="ds-stack">
        <Card heading="Datos de la entrada">
          <div className="ds-field-grid">
            <FormField label={<span className="ds-required">Título</span>}>
              <input
                type="text"
                value={values.title}
                maxLength={MAX_TITLE}
                placeholder="Horarios de atención"
                onChange={(event) => setValues({ ...values, title: event.target.value })}
                required
              />
            </FormField>

            {/* Suelto, sin FormField: BranchSelect trae su propio
                <label htmlFor> y FormField ES un <label>. Habilitado también
                en edición, a diferencia de AgentFormPage. */}
            <BranchSelect
              id="knowledge-base-form-branch"
              label="Sucursal"
              value={values.branchId}
              onChange={(branchId) => setValues({ ...values, branchId: branchId || undefined })}
              required
            />

            {/* Hijo DIRECTO de .ds-field-grid, con ds-field-grid--full en el
                propio <p>: es el patrón que el ítem 58 dejó documentado — el
                margen negativo de .ds-hint está calculado contra el gap de la
                grilla, y metido adentro de otro <div> se come el aire del
                campo de arriba. */}
            <p className="ds-hint ds-field-grid--full">
              El título identifica la entrada en esta lista y encabeza su bloque cuando el agente la
              lee. Conviene una entrada por tema: horarios, formas de pago, política de cancelación.
            </p>

            <div className="ds-field-grid--full">
              <FormField label="Activa">
                <input
                  type="checkbox"
                  checked={values.isActive}
                  onChange={(event) => setValues({ ...values, isActive: event.target.checked })}
                />
              </FormField>
            </div>

            <p className="ds-hint ds-field-grid--full">
              Desactivarla la saca del prompt sin borrarla: sirve para algo de temporada que después
              se quiere volver a usar.
            </p>
          </div>
        </Card>

        <Card heading="Contenido">
          <div className="ds-field-grid">
            <div className="ds-field-grid--full">
              <FormField label={<span className="ds-required">Contenido</span>}>
                <textarea
                  value={values.content}
                  rows={10}
                  maxLength={MAX_CONTENT}
                  placeholder={PLACEHOLDER_CONTENIDO}
                  onChange={(event) => setValues({ ...values, content: event.target.value })}
                  required
                />
              </FormField>
            </div>
            <p className="ds-hint ds-field-grid--full">
              Se suma tal cual al prompt de todos los agentes de esa sucursal, sin traducción ni
              confirmación. Escribilo como se lo contarías a alguien que recién entra a trabajar.
              Hasta {MAX_CONTENT.toLocaleString("es-UY")} caracteres por entrada.
            </p>
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
