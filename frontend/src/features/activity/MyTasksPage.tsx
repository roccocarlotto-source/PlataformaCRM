import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../design-system/Badge";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { useCompanyNames, useContactNames } from "../opportunity/relationResolution";
import { useCompleteActivity } from "./mutations";
import { activityKeys, useMyPendingActivities } from "./queries";
import { useOpportunityNames } from "./relationResolution";
import {
  TASK_BUCKET_LABELS,
  TASK_BUCKET_ORDER,
  bucketFor,
  formatTaskCompletedAt,
  formatTaskDueDate,
  type TaskBucket,
} from "./taskBuckets";
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS } from "./types";
import type { Activity, ActivityListResponse, ActivityType } from "./types";

// ---------------------------------------------------------------------------
// "Mis tareas" — diseño de referencia "Mis tareas": las actividades
// asignadas a quien mira que todavía le conciernen, agrupadas por
// vencimiento (Vencidas / Hoy / Esta semana / Más adelante / Sin fecha), con
// un checkbox para completarlas, y al final el bloque "Esperando
// confirmación" (§29) con las que ya tildó y un ADMIN todavía no revisó. Es
// la fase propia que ActivityListPage dejó anotada; esa tabla (todas las
// actividades, ADMIN) no cambia.
//
// No es un concepto nuevo: "pendiente" es completedAt === null, "esperando
// confirmación" es completedAt !== null && confirmedAt === null, y
// "asignada a vos" es assigneeId === me.id — campos reales del modelo (no
// hay status/priority/isCompleted). El backend filtra assigneeId +
// confirmed=false, así que acá llega solo lo abierto de esta persona y los
// dos filtros de la vista (buscador, tipo) son client-side sobre ese
// conjunto, como el buscador del embudo.
//
// Completar es PATCH { completedAt } sobre la propia actividad, permitido a
// cualquier rol desde esta fase (activity.service.ts,
// canSelfServiceCompleteActivity), pero desde el §29 no es la palabra final:
// la tarea queda "pendiente de confirmar" hasta que un ADMIN la confirme
// (desaparece de acá) o la rechace (vuelve a su bloque por vencimiento).
// Por eso una fila tildada NO se va: cambia de bloque. Un ADMIN que tilda
// la suya queda confirmado en el acto (auto-confirmación del backend) y sí
// desaparece. Crear sigue siendo ADMIN-only, por eso "+ Nueva tarea" solo
// aparece para ADMIN.
// ---------------------------------------------------------------------------

export function MyTasksPage() {
  const { me } = useAuth();
  const meId = me?.id;
  const isAdmin = me?.role === "ADMIN";
  const queryClient = useQueryClient();

  const tasksQuery = useMyPendingActivities(meId);
  const completeMutation = useCompleteActivity();

  // Instante de referencia, fijado una vez al montar (inicializador de
  // useState, no Date.now() en render — react-hooks/purity). Mismo patrón
  // que el `now` de ActivityListPage: lo que vence mientras la página sigue
  // abierta se reubica recién al volver a entrar.
  const [now] = useState(() => new Date());

  const [search, setSearch] = useState("");
  const [type, setType] = useState<ActivityType | "">("");

  // Lo que sigue abierto para esta persona. El filtro por confirmedAt es
  // defensa contra la propia cache: la respuesta del PATCH de un ADMIN que
  // tildó la suya vuelve ya confirmada (ver handleComplete) y no tiene que
  // verse ni un render mientras llega el refetch.
  const open = useMemo(
    () => (tasksQuery.data ?? []).filter((task) => task.confirmedAt === null),
    [tasksQuery.data],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return open.filter(
      (task) =>
        (type === "" || task.type === type) &&
        (needle === "" || task.subject.toLocaleLowerCase().includes(needle)),
    );
  }, [open, search, type]);

  // Agrupado en el orden de la vista; un bloque sin tareas no se renderiza.
  // Una tarea ya tildada va a "Esperando confirmación" sin importar su
  // vencimiento: la decisión se toma acá y no en bucketFor, que sigue
  // siendo una función pura sobre dueDate (§29).
  const groups = useMemo(() => {
    const byBucket = new Map<TaskBucket, Activity[]>();
    for (const task of visible) {
      const bucket: TaskBucket = task.completedAt
        ? "AWAITING_CONFIRMATION"
        : bucketFor(task.dueDate, now);
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
    () => open.map((t) => t.companyId).filter((v): v is string => v !== null),
    [open],
  );
  const contactIds = useMemo(
    () => open.map((t) => t.contactId).filter((v): v is string => v !== null),
    [open],
  );
  const opportunityIds = useMemo(
    () => open.map((t) => t.opportunityId).filter((v): v is string => v !== null),
    [open],
  );
  const companyNames = useCompanyNames(companyIds);
  const contactNames = useContactNames(contactIds);
  const opportunityNames = useOpportunityNames(opportunityIds);

  // Actualización optimista SOBRE LA CACHE de TanStack Query, no una lista
  // aparte en memoria: la fila tildada tiene que QUEDAR (pasa a "Esperando
  // confirmación"), así que lo que cambia es el completedAt de esa tarea en
  // cada página cacheada del listado, y el agrupado de arriba la reubica
  // solo en el próximo render. setQueriesData con el prefijo de listas
  // alcanza a todas las páginas que useMyPendingActivities tenga abiertas.
  function patchCached(id: string, patch: Partial<Activity>) {
    queryClient.setQueriesData<ActivityListResponse>(
      { queryKey: activityKeys.lists() },
      (current) =>
        current
          ? {
              ...current,
              data: current.data.map((task) => (task.id === id ? { ...task, ...patch } : task)),
            }
          : current,
    );
  }

  function handleComplete(task: Activity) {
    const completedAt = new Date().toISOString();
    patchCached(task.id, { completedAt });
    completeMutation.mutate(
      { id: task.id, completedAt },
      {
        // Lo que el server devolvió manda: para un ADMIN viene ya confirmada
        // (auto-confirmación) y la fila sale de la vista sin esperar el
        // refetch que el hook dispara igual.
        onSuccess: (saved) => patchCached(task.id, saved),
        // Revertir: la fila vuelve a su bloque; el error se muestra abajo.
        onError: () => patchCached(task.id, { completedAt: null }),
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

  // Tipo + asunto (link a editar solo para ADMIN) + relacionados: lo mismo
  // en una fila pendiente que en una esperando confirmación.
  function taskMain(task: Activity) {
    return (
      <div className="ds-task-main">
        <div className="ds-task-title">
          <Badge variant="neutral">{ACTIVITY_TYPE_LABELS[task.type]}</Badge>
          {isAdmin ? (
            <Link to={`/activities/${task.id}/edit`}>{task.subject}</Link>
          ) : (
            <span>{task.subject}</span>
          )}
        </div>
        {relatedLine(task) ? <div className="ds-task-related">{relatedLine(task)}</div> : null}
      </div>
    );
  }

  // Pie: sobre el conjunto YA FILTRADO por buscador/tipo, no sobre el total:
  // describe lo que está en pantalla. "Pendientes" son solo las sin tildar;
  // las que esperan confirmación se cuentan aparte, cuando las hay.
  const pendingCount = visible.filter((task) => task.completedAt === null).length;
  const awaitingCount = visible.length - pendingCount;
  const footer = [
    pendingCount === 1 ? "1 tarea pendiente" : `${pendingCount} tareas pendientes`,
    awaitingCount > 0 ? `${awaitingCount} esperando confirmación` : null,
  ]
    .filter(Boolean)
    .join(" · ");

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

      <h2 className="ds-filters-title">Filtros</h2>
      <div className="ds-filters">
        <label>
          {/* Solo para lectores de pantalla: el placeholder ya dice "Buscar…" y el
              rótulo visible lo repetía (docs/frontend-cambios-pendientes.md §4.b). */}
          <span className="ds-sr-only">Buscar</span>
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

      {tasksQuery.isSuccess && open.length === 0 ? (
        <EmptyState>No tenés tareas pendientes.</EmptyState>
      ) : null}

      {tasksQuery.isSuccess && open.length > 0 && visible.length === 0 ? (
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
            {tasks.map((task) =>
              bucket === "AWAITING_CONFIRMATION" ? (
                // Sin checkbox: ya no hay nada que tildar. Grisada, con un
                // indicador en el lugar del checkbox y la fecha en que se
                // completó en vez del vencimiento (§29).
                <li key={task.id} className="ds-task-row ds-task-row--awaiting">
                  <span className="ds-task-awaiting-mark" aria-hidden="true" />
                  {taskMain(task)}
                  <span className="ds-task-due">
                    {formatTaskCompletedAt(task.completedAt ?? "", now)}
                  </span>
                </li>
              ) : (
                <li key={task.id} className="ds-task-row">
                  <input
                    type="checkbox"
                    className="ds-task-check"
                    checked={false}
                    onChange={() => handleComplete(task)}
                    aria-label={`Completar: ${task.subject}`}
                  />
                  {taskMain(task)}
                  <span
                    className={`ds-task-due${bucket === "OVERDUE" ? " ds-task-due--overdue" : ""}`}
                  >
                    {formatTaskDueDate(task.dueDate, now)}
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>
      ))}

      {tasksQuery.isSuccess && visible.length > 0 ? (
        <p className="ds-task-footer">{footer}</p>
      ) : null}
    </div>
  );
}
