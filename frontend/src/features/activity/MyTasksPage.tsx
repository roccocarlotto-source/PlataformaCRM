import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../design-system/Badge";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { useCompanyNames, useContactNames } from "../opportunity/relationResolution";
import { useCompleteActivity } from "./mutations";
import { useMyPendingActivities } from "./queries";
import { useOpportunityNames } from "./relationResolution";
import {
  TASK_BUCKET_LABELS,
  TASK_BUCKET_ORDER,
  bucketFor,
  formatTaskDueDate,
  type TaskBucket,
} from "./taskBuckets";
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS } from "./types";
import type { Activity, ActivityType } from "./types";

// ---------------------------------------------------------------------------
// "Mis tareas" — diseño de referencia "Mis tareas": las actividades
// PENDIENTES asignadas a quien mira, agrupadas por vencimiento (Vencidas /
// Hoy / Esta semana / Más adelante / Sin fecha), con un checkbox para
// completarlas. Es la fase propia que ActivityListPage dejó anotada; esa
// tabla (todas las actividades, ambos roles) no cambia.
//
// No es un concepto nuevo: "pendiente" es completedAt === null y "asignada
// a vos" es assigneeId === me.id, los dos campos reales del modelo (no hay
// status/priority/isCompleted). El backend filtra las dos cosas
// (assigneeId + completed=false), así que acá llega solo lo pendiente de
// esta persona y los dos filtros de la vista (buscador, tipo) son
// client-side sobre ese conjunto, como el buscador del embudo.
//
// Completar es PATCH { completedAt } sobre la propia actividad, permitido a
// cualquier rol desde esta fase (activity.service.ts,
// canSelfServiceCompleteActivity). Crear sigue siendo ADMIN-only, por eso
// "+ Nueva tarea" solo aparece para ADMIN.
// ---------------------------------------------------------------------------

export function MyTasksPage() {
  const { me } = useAuth();
  const meId = me?.id;
  const isAdmin = me?.role === "ADMIN";

  const tasksQuery = useMyPendingActivities(meId);
  const completeMutation = useCompleteActivity();

  // Instante de referencia, fijado una vez al montar (inicializador de
  // useState, no Date.now() en render — react-hooks/purity). Mismo patrón
  // que el `now` de ActivityListPage: lo que vence mientras la página sigue
  // abierta se reubica recién al volver a entrar.
  const [now] = useState(() => new Date());

  // Movimiento optimista: una fila tildada desaparece del render en el acto
  // y vuelve solo si el PATCH falla.
  const [completedIds, setCompletedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [type, setType] = useState<ActivityType | "">("");

  const pending = useMemo(
    () => (tasksQuery.data ?? []).filter((task) => !completedIds.has(task.id)),
    [tasksQuery.data, completedIds],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return pending.filter(
      (task) =>
        (type === "" || task.type === type) &&
        (needle === "" || task.subject.toLocaleLowerCase().includes(needle)),
    );
  }, [pending, search, type]);

  // Agrupado en el orden de la vista; un bloque sin tareas no se renderiza.
  const groups = useMemo(() => {
    const byBucket = new Map<TaskBucket, Activity[]>();
    for (const task of visible) {
      const bucket = bucketFor(task.dueDate, now);
      const list = byBucket.get(bucket);
      if (list) list.push(task);
      else byBucket.set(bucket, [task]);
    }
    return TASK_BUCKET_ORDER.filter((bucket) => byBucket.has(bucket)).map((bucket) => ({
      bucket,
      tasks: byBucket.get(bucket) ?? [],
    }));
  }, [visible, now]);

  // Solo los ids realmente presentes — mismo criterio que ActivityListPage.
  const companyIds = useMemo(
    () => pending.map((t) => t.companyId).filter((v): v is string => v !== null),
    [pending],
  );
  const contactIds = useMemo(
    () => pending.map((t) => t.contactId).filter((v): v is string => v !== null),
    [pending],
  );
  const opportunityIds = useMemo(
    () => pending.map((t) => t.opportunityId).filter((v): v is string => v !== null),
    [pending],
  );
  const companyNames = useCompanyNames(companyIds);
  const contactNames = useContactNames(contactIds);
  const opportunityNames = useOpportunityNames(opportunityIds);

  function handleComplete(task: Activity) {
    setCompletedIds((current) => new Set(current).add(task.id));
    completeMutation.mutate(
      { id: task.id, completedAt: new Date().toISOString() },
      {
        // Revertir: la fila vuelve a su bloque; el error se muestra abajo.
        onError: () => {
          setCompletedIds((current) => {
            const next = new Set(current);
            next.delete(task.id);
            return next;
          });
        },
      },
    );
  }

  // Empresa · Contacto · Oportunidad: lo que exista, con el nombre real
  // (el título real de la oportunidad, no un monto). Un id sin resolver
  // muestra "—" en su lugar, nunca el UUID.
  function relatedLine(task: Activity): string {
    const parts: string[] = [];
    if (task.companyId) parts.push(companyNames.byId.get(task.companyId)?.name ?? "—");
    if (task.contactId) parts.push(contactNames.byId.get(task.contactId) ?? "—");
    if (task.opportunityId) parts.push(opportunityNames.byId.get(task.opportunityId) ?? "—");
    return parts.join(" · ");
  }

  return (
    <div>
      <div className="ds-page-header">
        <div>
          <h1>Mis tareas</h1>
          <p className="ds-page-subtitle">Actividades asignadas a vos, con o sin vencimiento.</p>
        </div>
        {isAdmin && meId ? (
          // Nace asignada a quien la pide (ActivityFormPage lee assigneeId
          // solo en creación).
          <Link
            to={`/activities/new?assigneeId=${encodeURIComponent(meId)}`}
            className="ds-link-button"
          >
            + Nueva tarea
          </Link>
        ) : null}
      </div>

      <div className="ds-filters">
        <label>
          Buscar
          <input
            type="search"
            placeholder="Buscar tarea…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Tipo
          <select
            value={type}
            onChange={(event) => setType(event.target.value as ActivityType | "")}
          >
            <option value="">Todos los tipos</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACTIVITY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tasksQuery.isLoading ? <LoadingState /> : null}

      {tasksQuery.isError ? (
        <ErrorState>
          No pudimos cargar tus tareas
          {tasksQuery.error instanceof Error ? `: ${tasksQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {completeMutation.isError ? (
        <ErrorState>
          No pudimos completar la tarea
          {completeMutation.error instanceof Error ? `: ${completeMutation.error.message}` : "."}
        </ErrorState>
      ) : null}

      {tasksQuery.isSuccess && pending.length === 0 ? (
        <EmptyState>No tenés tareas pendientes.</EmptyState>
      ) : null}

      {tasksQuery.isSuccess && pending.length > 0 && visible.length === 0 ? (
        <EmptyState>Ninguna tarea pendiente coincide con el filtro.</EmptyState>
      ) : null}

      {groups.map(({ bucket, tasks }) => (
        <section key={bucket} className="ds-task-group" aria-labelledby={`task-group-${bucket}`}>
          <h2 id={`task-group-${bucket}`} className="ds-task-group-title">
            <span>{TASK_BUCKET_LABELS[bucket]}</span>
            <span className="ds-task-count" aria-label={`${tasks.length} tareas`}>
              {tasks.length}
            </span>
          </h2>
          <ul className="ds-task-list">
            {tasks.map((task) => (
              <li key={task.id} className="ds-task-row">
                <input
                  type="checkbox"
                  className="ds-task-check"
                  checked={false}
                  onChange={() => handleComplete(task)}
                  aria-label={`Completar: ${task.subject}`}
                />
                <div className="ds-task-main">
                  <div className="ds-task-title">
                    <Badge variant="neutral">{ACTIVITY_TYPE_LABELS[task.type]}</Badge>
                    {isAdmin ? (
                      <Link to={`/activities/${task.id}/edit`}>{task.subject}</Link>
                    ) : (
                      <span>{task.subject}</span>
                    )}
                  </div>
                  {relatedLine(task) ? (
                    <div className="ds-task-related">{relatedLine(task)}</div>
                  ) : null}
                </div>
                <span
                  className={`ds-task-due${bucket === "OVERDUE" ? " ds-task-due--overdue" : ""}`}
                >
                  {formatTaskDueDate(task.dueDate, now)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Sobre el conjunto YA FILTRADO por buscador/tipo, no sobre el total:
          describe lo que está en pantalla. */}
      {tasksQuery.isSuccess && visible.length > 0 ? (
        <p className="ds-task-footer">
          {visible.length === 1 ? "1 tarea pendiente" : `${visible.length} tareas pendientes`}
        </p>
      ) : null}
    </div>
  );
}
