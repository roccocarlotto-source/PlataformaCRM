import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Table } from "../../design-system/Table";
import { useToast } from "../../design-system/useToast";
import { useCreateStage, useDeleteStage, useUpdateStage } from "./mutations";
import { formatProbability, probabilityWidth } from "./probability";
import { ProbabilityField } from "./ProbabilityField";
import { useStages } from "./queries";
import type { CreateStageInput, Stage, UpdateStageInput } from "./types";

// ---------------------------------------------------------------------------
// Editor de etapas integrado en el formulario de Pipeline
// (docs/frontend-cambios-pendientes.md §11). Se monta debajo de la Card
// "Datos del pipeline" en PipelineFormPage, solo cuando el pipeline ya existe
// (necesita un pipelineId real para crear un Stage).
//
// ES UN AGREGADO, NO UN REEMPLAZO: StageListPage/StageFormPage y sus rutas
// (/pipelines/:id/stages y sus hijas) quedan de respaldo tal cual, y el link
// "Ver etapas" de PipelineListPage también. Las dos formas de gestionar etapas
// coexisten (decisión confirmada de §11). Por eso este archivo reusa lo que
// esas pantallas ya tenían —los mismos hooks de mutations.ts, la misma
// presentación de probabilidad (probability.ts), el mismo patrón de acciones
// por fila— en vez de reescribir nada.
//
// GUARDADO POR FILA, AL TOQUE. No hay un "Guardar" para las etapas: cada fila
// llama al hook correspondiente apenas se confirma (Agregar etapa, Guardar
// etapa, Eliminar, Subir/Bajar). El botón "Guardar" del formulario de
// Pipeline queda acotado a Nombre/Default y no sabe que esto existe. Toda la
// lógica de negocio sigue en el backend sin tocar: nombre único dentro del
// pipeline, una misma etapa no puede ser ganada y perdida a la vez (varias
// etapas del pipeline sí pueden llevar el mismo flag desde §13), no se borra
// una etapa con oportunidades activas, reindexado del order
// (stage.service.ts). Acá solo se muestra el error que devuelva, en la fila
// que lo causó.
//
// "EDITAR" ES UNA FILA EDITABLE INLINE, y "Nueva etapa" es el mismo
// mini-formulario (StageRowForm, abajo) al pie de la lista. Un solo componente
// para los dos modos evita duplicar los cuatro campos y su validación; la
// diferencia entre crear y editar es solo qué mutation corre y si el
// formulario se vacía al terminar. Se descartó abrir un Modal para editar: el
// panel lateral tapa la lista que se está ordenando, y la edición inline es
// lo que pide §11 ("sin cambiar de pantalla").
//
// SIN CAMPO ORDEN. Al crear, el backend agrega la etapa al final si no se
// manda order; el orden se cambia con Subir/Bajar (mismo handleMove que
// StageListPage: propone el order del vecino y confía en el refetch para
// reflejar el reindexado del servidor). No hay drag-and-drop (decisión de
// §11).
//
// SIN PAGINACIÓN. Se piden hasta 100 etapas (el máximo de listQuerySchema)
// ordenadas por order; un pipeline con más de 100 etapas no es un caso real,
// pero para no truncar en silencio (el problema que R1.10 arregló en
// StageListPage) se avisa con un link a la pantalla completa.
//
// TOAST (§12): "Etapa guardada" al crear o editar, "Etapa eliminada" al
// borrar. Subir/Bajar NO muestran toast a propósito: la fila cambia de lugar
// a la vista, y reordenar suele ser varios clicks seguidos — un cartel por
// click sería ruido. El toast lo provee ToastProvider (App.tsx); este
// componente solo llama a show().
// ---------------------------------------------------------------------------

// El máximo que acepta listQuerySchema en el backend.
const MAX_PAGE_SIZE = 100;

interface StageFormValues {
  name: string;
  probability: string;
  isWon: boolean;
  isLost: boolean;
}

const EMPTY_FORM: StageFormValues = {
  name: "",
  probability: "",
  isWon: false,
  isLost: false,
};

// Sin order: se agrega al final (ver SIN CAMPO ORDEN arriba).
function toCreateInput(values: StageFormValues, pipelineId: string): CreateStageInput {
  return {
    pipelineId,
    name: values.name,
    probability: values.probability ? Number(values.probability) : undefined,
    isWon: values.isWon,
    isLost: values.isLost,
  };
}

// Sin order: editar una fila no la mueve; para eso están Subir/Bajar.
function toUpdateInput(values: StageFormValues): UpdateStageInput {
  return {
    name: values.name,
    probability: values.probability ? Number(values.probability) : undefined,
    isWon: values.isWon,
    isLost: values.isLost,
  };
}

function toFormValues(stage: Stage): StageFormValues {
  return {
    name: stage.name,
    // probability llega como string (Decimal) — Number() para poder editarlo
    // como campo numérico, nunca el string crudo tal cual.
    probability: String(Number(stage.probability)),
    isWon: stage.isWon,
    isLost: stage.isLost,
  };
}

interface StageRowFormProps {
  initialValues: StageFormValues;
  submitLabel: string;
  // Corre la mutation. Si rechaza, el mensaje del error se muestra dentro del
  // propio formulario (la fila que lo causó), no a nivel de la lista.
  onSubmit: (values: StageFormValues) => Promise<void>;
  // Solo en edición: "Cancelar" (y Escape) vuelven a la fila de lectura.
  onCancel?: () => void;
  // Solo en creación: tras guardar, vaciar los campos y dejar el foco en el
  // nombre para cargar la siguiente etapa sin volver a clickear.
  clearOnSuccess?: boolean;
}

// Los cuatro campos de StageFormPage (Nombre, Probabilidad, Ganada, Perdida)
// en una sola fila, como mini-formulario. Es un <form> propio —Enter guarda,
// `required` de Nombre frena el submit— y por eso PipelineFormPage lo monta
// AFUERA de su propio <form>: un form adentro de otro es HTML inválido.
//
// El rótulo es "Nombre de la etapa" y no "Nombre" a secas: en la misma página
// está el "Nombre" del pipeline, y dos campos con el mismo nombre accesible
// son ambiguos para un lector de pantalla (y para getByLabelText).
//
// isWon/isLost se desmarcan mutuamente como cortesía visual, igual que en
// StageFormPage; la autoridad sigue siendo el 409/CHECK del backend.
//
// Probabilidad va oculta detrás de "+ Agregar probabilidad" (ProbabilityField,
// §13): visible desde el arranque solo al editar una etapa que ya tiene una
// probabilidad distinta de 0.
function StageRowForm({
  initialValues,
  submitLabel,
  onSubmit,
  onCancel,
  clearOnSuccess = false,
}: StageRowFormProps) {
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(values);
      if (clearOnSuccess) {
        setValues(EMPTY_FORM);
        nameRef.current?.focus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la etapa");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="ds-stage-editor-form">
      <div className="ds-stage-editor-fields">
        <FormField label={<span className="ds-required">Nombre de la etapa</span>}>
          <input
            ref={nameRef}
            type="text"
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            required
            // En edición el foco va directo al campo: la persona acaba de
            // elegir "Editar" en esa fila.
            autoFocus={onCancel !== undefined}
          />
        </FormField>
        <ProbabilityField
          value={values.probability}
          onChange={(probability) => setValues({ ...values, probability })}
        />
        <FormField label="Ganada">
          <input
            type="checkbox"
            checked={values.isWon}
            onChange={(event) =>
              setValues({ ...values, isWon: event.target.checked, isLost: false })
            }
          />
        </FormField>
        <FormField label="Perdida">
          <input
            type="checkbox"
            checked={values.isLost}
            onChange={(event) =>
              setValues({ ...values, isLost: event.target.checked, isWon: false })
            }
          />
        </FormField>
        <div className="ds-stage-editor-actions">
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Guardando…" : submitLabel}
          </Button>
          {onCancel ? (
            <Button onClick={onCancel} disabled={isSubmitting}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <ErrorState>{error}</ErrorState> : null}
    </form>
  );
}

export interface StageEditorProps {
  pipelineId: string;
}

export function StageEditor({ pipelineId }: StageEditorProps) {
  const toast = useToast();
  const newHeadingId = useId();

  const stagesQuery = useStages(pipelineId, {
    pipelineId,
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: "order",
    sortOrder: "asc",
  });

  const createStageMutation = useCreateStage(pipelineId);
  const updateStageMutation = useUpdateStage(pipelineId);
  // Segunda instancia del mismo hook para Subir/Bajar, a propósito: así el
  // error de un movimiento (que se muestra a nivel de la lista, no hay fila
  // editable de por medio) no se mezcla con el de una edición inline, que se
  // muestra dentro de su propia fila.
  const moveStageMutation = useUpdateStage(pipelineId);
  const deleteStageMutation = useDeleteStage(pipelineId);

  // Una sola fila en edición a la vez: elegir "Editar" en otra descarta el
  // borrador de la anterior.
  const [editingId, setEditingId] = useState<string | null>(null);

  async function handleCreate(values: StageFormValues) {
    await createStageMutation.mutateAsync(toCreateInput(values, pipelineId));
    toast.show("Etapa guardada");
  }

  async function handleUpdate(id: string, values: StageFormValues) {
    await updateStageMutation.mutateAsync({ id, input: toUpdateInput(values) });
    setEditingId(null);
    toast.show("Etapa guardada");
  }

  function handleDelete(id: string) {
    if (!window.confirm("¿Eliminar esta etapa?")) return;
    deleteStageMutation.mutate(id, { onSuccess: () => toast.show("Etapa eliminada") });
  }

  // Nunca reordena localmente antes de la respuesta del backend: solo
  // propone el order del vecino inmediato y confía en el refetch (vía
  // invalidación de stageKeys.byPipeline) para reflejar el order final
  // que reindexStages calculó server-side. Mismo criterio que StageListPage.
  function handleMove(id: string, targetOrder: number) {
    moveStageMutation.mutate({ id, input: { order: targetOrder } });
  }

  const stages = stagesQuery.data?.data ?? [];

  return (
    <Card heading="Etapas" className="ds-stage-editor">
      <div className="ds-stack">
        {stagesQuery.isLoading ? <LoadingState /> : null}

        {stagesQuery.isError ? (
          <ErrorState>
            No pudimos cargar las etapas
            {stagesQuery.error instanceof Error ? `: ${stagesQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {deleteStageMutation.isError ? (
          <ErrorState>
            No pudimos eliminar la etapa
            {deleteStageMutation.error instanceof Error
              ? `: ${deleteStageMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {moveStageMutation.isError ? (
          <ErrorState>
            No pudimos mover la etapa
            {moveStageMutation.error instanceof Error
              ? `: ${moveStageMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {stagesQuery.isSuccess && stages.length === 0 ? (
          <EmptyState>
            Este pipeline todavía no tiene etapas. Agregá la primera acá abajo.
          </EmptyState>
        ) : null}

        {stagesQuery.isSuccess && stages.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Orden</th>
                <th>Nombre</th>
                <th>Probabilidad</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage, index) => {
                if (editingId === stage.id) {
                  // La fila de lectura se reemplaza por el mini-formulario, a
                  // lo ancho de las columnas que no son Orden (el orden no se
                  // edita acá, ver SIN CAMPO ORDEN).
                  return (
                    <tr key={stage.id}>
                      <td>{stage.order}</td>
                      <td colSpan={4}>
                        <StageRowForm
                          initialValues={toFormValues(stage)}
                          submitLabel="Guardar etapa"
                          onSubmit={(values) => handleUpdate(stage.id, values)}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  );
                }

                // Borde real del pipeline, no de la página (ver SIN PAGINACIÓN):
                // con más de una página, el último de esta no es el último.
                const { page: currentPage, totalPages } = stagesQuery.data.pagination;
                const isFirstOverall = currentPage === 1 && index === 0;
                const isLastOverall = currentPage === totalPages && index === stages.length - 1;

                return (
                  <tr key={stage.id}>
                    <td>{stage.order}</td>
                    <td>{stage.name}</td>
                    <td>
                      <span className="ds-meter-inline">
                        <span className="ds-meter-track" aria-hidden="true">
                          <span
                            className="ds-meter-fill"
                            style={{ width: `${probabilityWidth(stage.probability)}%` }}
                          />
                        </span>
                        <span className="ds-meter-value">
                          {formatProbability(stage.probability)}
                        </span>
                      </span>
                    </td>
                    <td>
                      {stage.isWon ? <Badge variant="success">Etapa de Ganada</Badge> : null}
                      {stage.isLost ? <Badge variant="danger">Etapa de Perdida</Badge> : null}
                    </td>
                    <td>
                      {/* Subir/Bajar afuera del menú y Editar/Eliminar adentro:
                          mismo criterio que StageListPage (§8).
                          Además del borde, se deshabilitan TODOS mientras hay
                          un movimiento en curso (§14): como no se reordena
                          localmente hasta el refetch, sin esto una respuesta
                          lenta del backend se ve como "el click no hizo
                          nada". Toda la tabla y no solo la fila clickeada,
                          porque la mutation es una sola y cada movimiento
                          propone el order del vecino sobre la lista actual:
                          un segundo click antes del refetch usaría datos
                          viejos. */}
                      <div className="ds-row-actions">
                        <Button
                          disabled={isFirstOverall || moveStageMutation.isPending}
                          onClick={() => handleMove(stage.id, stage.order - 1)}
                        >
                          Subir
                        </Button>
                        <Button
                          disabled={isLastOverall || moveStageMutation.isPending}
                          onClick={() => handleMove(stage.id, stage.order + 1)}
                        >
                          Bajar
                        </Button>
                        <ActionsMenu
                          label={`Más acciones de ${stage.name}`}
                          actions={[
                            { label: "Editar", onClick: () => setEditingId(stage.id) },
                            {
                              label: "Eliminar",
                              onClick: () => handleDelete(stage.id),
                              destructive: true,
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : null}

        {stagesQuery.isSuccess && stagesQuery.data.pagination.totalPages > 1 ? (
          <p className="ds-hint">
            Se muestran las primeras {MAX_PAGE_SIZE} etapas. Para ver todas, usá{" "}
            <Link to={`/pipelines/${pipelineId}/stages`}>Ver etapas</Link>.
          </p>
        ) : null}

        {stagesQuery.isSuccess ? (
          <section aria-labelledby={newHeadingId}>
            <h3 id={newHeadingId} className="ds-stage-editor-subtitle">
              Nueva etapa
            </h3>
            <StageRowForm
              initialValues={EMPTY_FORM}
              submitLabel="Agregar etapa"
              onSubmit={handleCreate}
              clearOnSuccess
            />
          </section>
        ) : null}
      </div>
    </Card>
  );
}
