import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { useFormDraft } from "../../lib/useFormDraft";
import { FieldMappingEditor } from "./FieldMappingEditor";
import {
  mapToRows,
  rowsToMapping,
  type FieldMappingRow,
  type RowsToMappingResult,
} from "./fieldMapping";
import { useCreateSource, useUpdateSource } from "./mutations";
import { useSource } from "./queries";
import type { CreateSourceInput, Source, SourceType, UpdateSourceInput } from "./types";

interface SourceFormValues {
  name: string;
  type: SourceType;
  isActive: boolean;
  // El mapeo vive como LISTA mientras se edita y se convierte a mapa recién al
  // enviar — ver fieldMapping.ts para por qué no puede ser el objeto directo.
  mappingRows: FieldMappingRow[];
}

const EMPTY_FORM: SourceFormValues = {
  name: "",
  // WEBHOOK como default: es el caso más simple (no necesita mapeo) y el que
  // motivó la capa de ingesta. Que el editor de mapeo aparezca recién al elegir
  // FILE_IMPORT es la consecuencia buscada.
  type: "WEBHOOK",
  isActive: true,
  mappingRows: [],
};

function toFormValues(source: Source): SourceFormValues {
  return {
    name: source.name,
    type: source.type,
    isActive: source.isActive,
    mappingRows: mapToRows(source.fieldMapping),
  };
}

// Un único componente para create y edit — el modo se distingue del propio param
// de ruta (:id), mismo patrón que CompanyFormPage y ContactFormPage.
//
// EL TIPO ES INMUTABLE, y esto es lo que más lo diferencia de los otros
// formularios del proyecto: `type` viaja en el POST pero NO existe en
// updateSourceSchema (source.controller.ts). Una integración de webhook no se
// convierte en una importación de Excel; se crea otra. En edición se muestra
// deshabilitado con la razón escrita, en vez de esconderlo: que el dato esté a
// la vista y no se pueda tocar informa más que su ausencia.
//
// EL MAPEO SOLO APLICA A FILE_IMPORT. El backend lo rechaza en cualquier otro
// tipo —en el create con el superRefine del schema, en el PATCH con un chequeo
// en updateSource— así que el editor se muestra solo cuando corresponde. Al
// crear, eso depende de lo que la persona acaba de elegir en el select; al
// editar, del `type` real de la fila, que ya no se puede cambiar.
export function SourceFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditMode = id !== undefined;
  const navigate = useNavigate();

  const sourceQuery = useSource(isEditMode ? id : undefined);
  const createSourceMutation = useCreateSource();
  const updateSourceMutation = useUpdateSource(id ?? "");

  const [values, setValues] = useFormDraft<SourceFormValues>(
    sourceQuery.data?.id,
    sourceQuery.data ? toFormValues(sourceQuery.data) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = createSourceMutation.isPending || updateSourceMutation.isPending;
  const usaMapeo = values.type === "FILE_IMPORT";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // El mapeo se valida ANTES de tocar la red: los errores posibles (destino
    // repetido, fila a medio llenar, tope) son de forma y se pueden decir sin
    // preguntarle al servidor. Ver fieldMapping.ts.
    //
    // Si el tipo no es FILE_IMPORT no se manda mapeo aunque hubiera filas
    // cargadas: el backend lo rechazaría, y borrarlas en silencio sería peor —
    // quedan en el formulario por si vuelve a elegir el tipo correcto.
    // Anotado a mano: sin el tipo explícito, el literal del `else` ensancha `ok`
    // a `boolean` y la unión discriminada deja de discriminar.
    const resultado: RowsToMappingResult = usaMapeo
      ? rowsToMapping(values.mappingRows)
      : { ok: true, mapping: null };
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    const mapping = resultado.mapping;

    try {
      if (isEditMode) {
        // PATCH: `null` LIMPIA el mapeo. Es la única forma de vaciarlo — un
        // objeto vacío lo rechaza fieldMappingSchema ("para no mapear nada,
        // omitilo o mandá null"). Por eso quitar todas las filas manda null y
        // no {}.
        //
        // En una fuente que no es FILE_IMPORT ni se menciona el campo: mandar
        // null sobre una WEBHOOK sería un 400, porque el chequeo de tipo del
        // service corre para cualquier valor distinto de undefined.
        const input: UpdateSourceInput = {
          name: values.name,
          isActive: values.isActive,
          ...(usaMapeo ? { fieldMapping: mapping } : {}),
        };
        await updateSourceMutation.mutateAsync(input);
      } else {
        // POST: el campo es `.optional()` pero NO `.nullable()`, así que "sin
        // mapeo" se expresa OMITIENDO la clave. Mandar null sería un 400.
        const input: CreateSourceInput = {
          name: values.name,
          type: values.type,
          isActive: values.isActive,
          ...(usaMapeo && mapping ? { fieldMapping: mapping } : {}),
        };
        await createSourceMutation.mutateAsync(input);
      }
      navigate("/sources");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la fuente");
    }
  }

  if (isEditMode && sourceQuery.isLoading) {
    return <LoadingState />;
  }

  if (isEditMode && sourceQuery.isError) {
    return (
      <ErrorState>
        No pudimos cargar la fuente
        {sourceQuery.error instanceof Error ? `: ${sourceQuery.error.message}` : "."}
      </ErrorState>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{isEditMode ? "Editar fuente" : "Nueva fuente"}</h1>

      <FormField label="Nombre">
        <input
          type="text"
          value={values.name}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
          required
        />
      </FormField>

      <FormField label="Tipo">
        <select
          value={values.type}
          disabled={isEditMode}
          onChange={(event) => setValues({ ...values, type: event.target.value as SourceType })}
        >
          {/* Falta EXTERNAL_DB del enum a propósito, no es un olvido: el ítem 6
              (bases de datos externas) sigue pospuesto —ver docs/project-overview.md
              §8— y no hay ninguna forma de ingesta que lo consuma. Crear una
              fuente de ese tipo hoy no rompe nada, pero tampoco hace nada.
              `SourceType` en types.ts SÍ lo incluye: el backend lo acepta, así
              que el tipo tiene que poder representar una fuente existente que
              llegue por otro camino. Esto es solo no ofrecer la opción. */}
          <option value="WEBHOOK">Webhook</option>
          <option value="FILE_IMPORT">Importación de archivo</option>
        </select>
      </FormField>
      {isEditMode ? (
        <p className="ds-hint">
          El tipo no se puede cambiar: una integración de webhook no se convierte en una importación
          de archivo. Si necesitás otro tipo, creá una fuente nueva.
        </p>
      ) : null}

      <FormField label="Activa">
        <input
          type="checkbox"
          checked={values.isActive}
          onChange={(event) => setValues({ ...values, isActive: event.target.checked })}
        />
      </FormField>

      {usaMapeo ? (
        <FieldMappingEditor
          rows={values.mappingRows}
          disabled={isSubmitting}
          onChange={(mappingRows) => setValues({ ...values, mappingRows })}
        />
      ) : null}

      {error ? <ErrorState>{error}</ErrorState> : null}

      <Button type="submit" variant="primary" disabled={isSubmitting}>
        {isSubmitting ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
