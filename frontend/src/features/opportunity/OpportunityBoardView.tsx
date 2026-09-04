import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Avatar } from "../../design-system/Avatar";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { PipelineSelect } from "../pipeline/PipelineSelect";
import { usePipelines } from "../pipeline/queries";
import { useStages } from "../stage/queries";
import type { Stage } from "../stage/types";
import { buildMovePatch, todayIsoDate } from "./boardMove";
import { formatAmount, formatAmountTotals, formatDate } from "./format";
import { useMoveOpportunity } from "./mutations";
import { OpportunityAssociation } from "./OpportunityAssociation";
import { usePipelineOpportunitiesAll } from "./queries";
import { useCompanyNames, useContactNames, useOwnerNames } from "./relationResolution";
import type { Opportunity, UpdateOpportunityInput } from "./types";

// ---------------------------------------------------------------------------
// Vista de embudo de /opportunities — diseño de referencia "Pipeline CRM".
//
// Las columnas son TODAS las etapas del pipeline elegido, en su `order`
// real. El tratamiento visual de "Ganada" (verde) y "Perdida" (rojo) lo
// decide isWon/isLost de cada etapa, nunca su nombre; y como no hay
// ninguna regla que garantice una sola etapa ganada o una sola perdida por
// pipeline, puede haber cero, una o varias columnas de cada color, y eso
// es correcto.
//
// Solo se mueve ENTRE columnas: Opportunity no tiene campo de posición
// (prisma/schema.prisma), así que no hay reordenamiento dentro de una
// columna y no se fabrica uno. Al soltar, el PATCH lo arma buildMovePatch
// (boardMove.ts) con status/actualCloseDate según la etapa destino.
//
// El movimiento se refleja localmente antes de que responda el servidor
// (estado del componente, no cache de TanStack Query) y se revierte si la
// mutación falla. Ver `LocalMove` abajo para cómo se evita que ese estado
// local tape un cambio posterior del servidor.
// ---------------------------------------------------------------------------

// Tope real del backend para pageSize (stage.controller.ts listQuerySchema)
// — mismo límite que documenta PipelineSelect para el suyo. Un pipeline con
// más de 100 etapas quedaría truncado acá; StageListPage pagina de a 20
// justamente por eso, pero un tablero paginado no tiene sentido.
const STAGES_PAGE_SIZE = 100;

// Un movimiento aplicado localmente sobre lo que devolvió el servidor.
// Se aplica SOLO mientras la oportunidad traída siga teniendo el mismo
// updatedAt que tenía al soltar: el PATCH bumpea updatedAt, así que en
// cuanto el refetch trae la versión nueva, el override deja de aplicar
// solo — sin efectos ni timers. Y si otra persona la mueve después, esa
// versión también trae otro updatedAt y tampoco queda tapada.
interface LocalMove {
  patch: UpdateOpportunityInput;
  baseUpdatedAt: string;
}

function applyLocalMove(opportunity: Opportunity, move: LocalMove | undefined): Opportunity {
  if (!move || move.baseUpdatedAt !== opportunity.updatedAt) return opportunity;
  const { patch } = move;
  return {
    ...opportunity,
    stageId: patch.stageId ?? opportunity.stageId,
    status: patch.status ?? opportunity.status,
    actualCloseDate:
      patch.actualCloseDate === undefined ? opportunity.actualCloseDate : patch.actualCloseDate,
  };
}

export function OpportunityBoardView() {
  const { me } = useAuth();
  // Mismo gating que la tabla: GET /api/users es ADMIN-only, así que el
  // avatar del propietario solo existe para ADMIN — no se expande ningún
  // permiso. Y las acciones de escritura ("+ Añadir", editar) también.
  const isAdmin = me?.role === "ADMIN";

  // Misma query (y por lo tanto misma caché) que PipelineSelect: acá se
  // necesita la lista para autoseleccionar el primero. La mayoría de las
  // organizaciones tiene un solo pipeline ("MVP: uno por organización", ver
  // PipelineSelect.tsx), así que pedirle que lo elija sería fricción pura.
  // Es un valor DERIVADO (no un efecto que haga setState): la elección
  // explícita del usuario pisa el default, y mientras no elija, vale el
  // primero de la lista.
  const pipelinesQuery = usePipelines({ pageSize: 100, sortBy: "name", sortOrder: "asc" });
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | undefined>(undefined);
  const pipelineId = selectedPipelineId ?? pipelinesQuery.data?.data[0]?.id;

  const stagesQuery = useStages(
    pipelineId ?? "",
    { pipelineId, pageSize: STAGES_PAGE_SIZE, sortBy: "order", sortOrder: "asc" },
    { enabled: pipelineId !== undefined },
  );
  const opportunitiesQuery = usePipelineOpportunitiesAll(pipelineId);

  const moveMutation = useMoveOpportunity();
  const [localMoves, setLocalMoves] = useState<Record<string, LocalMove>>({});
  const [search, setSearch] = useState("");

  const stages = useMemo(() => stagesQuery.data?.data ?? [], [stagesQuery.data]);

  // Lo que devolvió el servidor + los movimientos locales todavía no
  // confirmados. Todo lo que se muestra sale de acá.
  const opportunities = useMemo(
    () =>
      (opportunitiesQuery.data ?? []).map((opportunity) =>
        applyLocalMove(opportunity, localMoves[opportunity.id]),
      ),
    [opportunitiesQuery.data, localMoves],
  );

  // Buscador client-side por título sobre el conjunto ya traído: se trajo
  // el pipeline entero, no hace falta otro request.
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return opportunities;
    return opportunities.filter((o) => o.title.toLocaleLowerCase().includes(needle));
  }, [opportunities, search]);

  const byStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const opportunity of visible) {
      const bucket = map.get(opportunity.stageId);
      if (bucket) bucket.push(opportunity);
      else map.set(opportunity.stageId, [opportunity]);
    }
    return map;
  }, [visible]);

  // "En curso" = SOLO las OPEN. No es un dato fabricado: es un filtro sobre
  // el mismo conjunto ya traído; las cerradas cuentan en el total de
  // oportunidades pero no suman en "en curso". El buscador no lo afecta a
  // propósito — describe el pipeline, no lo que matcheó la búsqueda.
  const inProgress = useMemo(
    () => opportunities.filter((o) => o.status === "OPEN"),
    [opportunities],
  );

  // Solo los ids realmente presentes en el tablero — mismo criterio que la
  // tabla (nunca "todas las Companies/Contacts").
  const companyIds = useMemo(
    () => opportunities.map((o) => o.companyId).filter((id): id is string => id !== null),
    [opportunities],
  );
  const contactIds = useMemo(
    () => opportunities.map((o) => o.contactId).filter((id): id is string => id !== null),
    [opportunities],
  );
  const companyNames = useCompanyNames(companyIds);
  const contactNames = useContactNames(contactIds);
  const ownerNames = useOwnerNames(isAdmin);

  // distance: 5 — un click sin desplazamiento sigue siendo un click (el
  // título de la tarjeta es un link para ADMIN); solo arrastrar activa el
  // drag. KeyboardSensor: la misma operación con Espacio/Enter + flechas.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const opportunity = opportunities.find((o) => o.id === active.id);
    const target = stages.find((stage) => stage.id === over.id);
    if (!opportunity || !target) return;

    const patch = buildMovePatch(opportunity, target, todayIsoDate());
    if (!patch) return;

    setLocalMoves((current) => ({
      ...current,
      [opportunity.id]: { patch, baseUpdatedAt: opportunity.updatedAt },
    }));
    moveMutation.mutate(
      { id: opportunity.id, input: patch },
      {
        // Revertir: sin el override, la tarjeta vuelve a la columna que
        // dice el servidor. El error se muestra abajo con ErrorState.
        onError: () => {
          setLocalMoves((current) => {
            const next = { ...current };
            delete next[opportunity.id];
            return next;
          });
        },
      },
    );
  }

  if (pipelinesQuery.isSuccess && pipelinesQuery.data.data.length === 0) {
    return (
      <EmptyState>No hay pipelines todavía. Creá uno en Pipelines para ver el embudo.</EmptyState>
    );
  }

  return (
    <div>
      <div className="ds-board-toolbar">
        <div className="ds-board-toolbar-group">
          <PipelineSelect
            id="board-pipeline"
            label="Pipeline"
            value={pipelineId}
            onChange={setSelectedPipelineId}
          />
          <label>
            Buscar
            <input
              type="search"
              placeholder="Buscar oportunidad…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {opportunitiesQuery.isSuccess ? (
          <p className="ds-board-summary">
            {`${opportunities.length} ${opportunities.length === 1 ? "oportunidad" : "oportunidades"} · ${formatAmountTotals(inProgress)} en curso`}
          </p>
        ) : null}
      </div>

      {stagesQuery.isLoading || opportunitiesQuery.isLoading ? <LoadingState /> : null}

      {stagesQuery.isError ? (
        <ErrorState>
          No pudimos cargar las etapas
          {stagesQuery.error instanceof Error ? `: ${stagesQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {opportunitiesQuery.isError ? (
        <ErrorState>
          No pudimos cargar las oportunidades
          {opportunitiesQuery.error instanceof Error
            ? `: ${opportunitiesQuery.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      {moveMutation.isError ? (
        <ErrorState>
          No pudimos mover la oportunidad
          {moveMutation.error instanceof Error ? `: ${moveMutation.error.message}` : "."}
        </ErrorState>
      ) : null}

      {stagesQuery.isSuccess && stages.length === 0 ? (
        <EmptyState>Este pipeline no tiene etapas todavía.</EmptyState>
      ) : null}

      {stagesQuery.isSuccess && opportunitiesQuery.isSuccess && stages.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragEnd={handleDragEnd}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "Para mover una oportunidad de etapa, presioná Espacio o Enter, movela con las flechas y volvé a presionar Espacio para soltarla. Escape cancela.",
            },
          }}
        >
          <div className="ds-board">
            {stages.map((stage) => (
              <BoardColumn
                key={stage.id}
                stage={stage}
                pipelineId={pipelineId ?? ""}
                opportunities={byStage.get(stage.id) ?? []}
                isAdmin={isAdmin}
                companyNames={companyNames.byId}
                contactNames={contactNames.byId}
                ownerNames={ownerNames.byId}
              />
            ))}
          </div>
        </DndContext>
      ) : null}
    </div>
  );
}

interface BoardColumnProps {
  stage: Stage;
  pipelineId: string;
  opportunities: Opportunity[];
  isAdmin: boolean;
  companyNames: Map<string, { name: string }>;
  contactNames: Map<string, string>;
  ownerNames: Map<string, string>;
}

function BoardColumn({
  stage,
  pipelineId,
  opportunities,
  isAdmin,
  companyNames,
  contactNames,
  ownerNames,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  // La columna de una etapa normal es la única donde tiene sentido crear:
  // una oportunidad nueva arranca OPEN (OpportunityFormPage), y crearla
  // directo en "Ganada"/"Perdida" la dejaría OPEN en una columna cerrada.
  const isOutcome = stage.isWon || stage.isLost;
  const className = [
    "ds-board-column",
    stage.isWon ? "ds-board-column--won" : null,
    stage.isLost ? "ds-board-column--lost" : null,
    isOver ? "ds-board-column--over" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section ref={setNodeRef} className={className} aria-labelledby={`board-stage-${stage.id}`}>
      <div className="ds-board-column-bar" aria-hidden="true" />
      <div className="ds-board-column-header">
        <h2 id={`board-stage-${stage.id}`} className="ds-board-column-title">
          {stage.name}
        </h2>
        <span className="ds-board-count" aria-label={`${opportunities.length} oportunidades`}>
          {opportunities.length}
        </span>
      </div>
      <div className="ds-board-cards">
        {opportunities.map((opportunity) => (
          <BoardCard
            key={opportunity.id}
            opportunity={opportunity}
            isAdmin={isAdmin}
            companyName={
              opportunity.companyId ? (companyNames.get(opportunity.companyId)?.name ?? "—") : null
            }
            contactName={
              opportunity.contactId ? (contactNames.get(opportunity.contactId) ?? "—") : null
            }
            ownerName={isAdmin ? (ownerNames.get(opportunity.ownerId) ?? null) : null}
          />
        ))}
      </div>
      {isAdmin && !isOutcome ? (
        // Preselecciona pipeline y etapa en el formulario de alta vía query
        // params (OpportunityFormPage los lee solo en modo creación).
        <Link
          to={`/opportunities/new?pipelineId=${encodeURIComponent(pipelineId)}&stageId=${encodeURIComponent(stage.id)}`}
          className="ds-button ds-button--secondary ds-board-add"
        >
          + Añadir
        </Link>
      ) : null}
      <div className="ds-board-column-total">
        <span>Total:</span>
        <strong>{formatAmountTotals(opportunities)}</strong>
      </div>
    </section>
  );
}

interface BoardCardProps {
  opportunity: Opportunity;
  isAdmin: boolean;
  companyName: string | null;
  contactName: string | null;
  ownerName: string | null;
}

function BoardCard({ opportunity, isAdmin, companyName, contactName, ownerName }: BoardCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opportunity.id,
  });

  // Abierta → fecha estimada; cerrada (WON o LOST) → fecha real. Mismo
  // criterio que la columna Cierre de la tabla.
  const isClosed = opportunity.status !== "OPEN";
  const closeDate = isClosed ? opportunity.actualCloseDate : opportunity.expectedCloseDate;

  return (
    <article
      ref={setNodeRef}
      className={`ds-board-card${isDragging ? " ds-board-card--dragging" : ""}`}
      style={
        transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
      }
      {...listeners}
      {...attributes}
    >
      <div className="ds-board-card-title">
        {isAdmin ? (
          <Link to={`/opportunities/${opportunity.id}/edit`}>{opportunity.title}</Link>
        ) : (
          opportunity.title
        )}
      </div>
      <div className="ds-board-card-meta">
        <OpportunityAssociation companyName={companyName} contactName={contactName} />
      </div>
      <div className="ds-board-card-footer">
        <span className="ds-board-card-amount">
          {formatAmount(opportunity.amount, opportunity.currency)}
        </span>
        <span className="ds-cell-stack">
          <span className="ds-cell-caption">{isClosed ? "Cierre real" : "Estimado"}</span>
          <span>{closeDate ? formatDate(closeDate) : "—"}</span>
        </span>
        {ownerName ? <Avatar name={ownerName} size="sm" /> : null}
      </div>
    </article>
  );
}
