import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { CompanySelect } from "../company/CompanySelect";
import { useCompaniesByIds } from "../contact/companyResolution";
import { useContactNames, useOwnerNames } from "../opportunity/relationResolution";
import { useDeleteActivity } from "./mutations";
import { useActivities } from "./queries";
import { useOpportunityNames } from "./relationResolution";
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS } from "./types";
import type { Activity, ActivitySortBy, ActivityType, SortOrder } from "./types";

const PAGE_SIZE = 20;

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

// "Vencida" es un hecho derivado de dos campos que ya existen: vencimiento en
// el pasado y sin fecha de completado. No es un estado del modelo (Activity
// no tiene status) ni un dato inventado; es lo único de la vista "Mis
// tareas" del diseño que se trae acá. `now` se pasa por parámetro para que
// el cálculo sea puro y el instante de comparación sea uno solo por render.
function isOverdue(activity: Activity, now: number): boolean {
  if (!activity.dueDate || activity.completedAt) return false;
  return new Date(activity.dueDate).getTime() < now;
}

// Restyle conservador, decidido con el dueño del proyecto: la vista "Mis
// tareas" del diseño (agrupada por vencimiento, solo las asignadas a vos,
// checkbox para completar) es funcionalidad nueva y queda para una fase
// propia. Esta página sigue listando TODAS las actividades, para ambos
// roles, con los mismos filtros, orden y paginación de siempre.
export function ActivityListPage() {
  const { me } = useAuth();
  // Lectura abierta a cualquier rol (activity.routes.ts: GET sin
  // authorize) — a diferencia de OpportunityListPage, esta página entera
  // NO va detrás de AdminRoute. Solo las acciones de escritura (Nueva/
  // Editar/Eliminar) y la resolución de author/assignee vía GET /api/users
  // están condicionadas por rol.
  const isAdmin = me?.role === "ADMIN";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<ActivityType | "">("");
  const [companyId, setCompanyId] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<ActivitySortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const activitiesQuery = useActivities({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    type: type || undefined,
    companyId,
    sortBy,
    sortOrder,
  });

  const deleteActivityMutation = useDeleteActivity();

  const rows = useMemo(() => activitiesQuery.data?.data ?? [], [activitiesQuery.data]);

  // Solo los ids REALMENTE visibles en esta página — nunca "todas las
  // Companies/Contacts/Opportunities/Users" (mismo criterio que M5).
  const visibleCompanyIds = useMemo(
    () => rows.map((a) => a.companyId).filter((v): v is string => v !== null),
    [rows],
  );
  const visibleContactIds = useMemo(
    () => rows.map((a) => a.contactId).filter((v): v is string => v !== null),
    [rows],
  );
  const visibleOpportunityIds = useMemo(
    () => rows.map((a) => a.opportunityId).filter((v): v is string => v !== null),
    [rows],
  );

  const companyNames = useCompaniesByIds(visibleCompanyIds);
  const contactNames = useContactNames(visibleContactIds);
  const opportunityNames = useOpportunityNames(visibleOpportunityIds);
  // Una sola llamada resuelve tanto author como assignee (mismo mapa
  // id -> fullName): mismo gating por rol que Owner en Opportunity (M5) —
  // para USER, enabled=false, GET /api/users nunca se dispara.
  const userNames = useOwnerNames(isAdmin);

  // Instante de referencia para "Vencida", fijado una vez al montar la
  // página (inicializador de useState, no una llamada en cada render: la
  // regla react-hooks/purity no admite Date.now() durante el render). Una
  // actividad que vence mientras la página sigue abierta se marca recién
  // al volver a entrar; es una aproximación aceptable para un indicador.
  const [now] = useState(() => Date.now());

  // USER nunca resuelve el nombre de otro usuario (sin acceso a GET
  // /api/users): compara contra su propio id (conocido vía useAuth, sin
  // request adicional) y muestra "Vos" en ese caso; cualquier otro id
  // ajeno cae en el fallback humano "—", nunca el UUID crudo. ADMIN
  // resuelve cualquier id vía userNames.
  function resolveUserLabel(userId: string | null): string {
    if (!userId) return "";
    if (userId === me?.id) return "Vos";
    if (isAdmin) return userNames.byId.get(userId) ?? "—";
    return "—";
  }

  function handleDelete(id: string) {
    if (!window.confirm("¿Eliminar esta actividad?")) return;
    deleteActivityMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Actividades</h1>
        {isAdmin ? (
          <Link to="/activities/new" className="ds-link-button">
            Nueva actividad
          </Link>
        ) : null}
      </div>

      <div className="ds-filters">
        <label>
          Buscar
          <input
            type="search"
            placeholder="Buscar por asunto o notas"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Tipo
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as ActivityType | "");
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACTIVITY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <div>
          <CompanySelect
            id="activity-filter-company"
            label="Filtrar por empresa"
            value={companyId}
            onChange={(id) => {
              setCompanyId(id);
              setPage(1);
            }}
          />
          {companyId ? (
            <Button
              onClick={() => {
                setCompanyId(undefined);
                setPage(1);
              }}
            >
              Quitar filtro de empresa
            </Button>
          ) : null}
        </div>
        <label>
          Ordenar por
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as ActivitySortBy)}
          >
            <option value="createdAt">Fecha de creación</option>
            <option value="updatedAt">Última actualización</option>
            <option value="dueDate">Vencimiento</option>
            <option value="completedAt">Completada</option>
            <option value="subject">Asunto</option>
          </select>
        </label>
        <label>
          Orden
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as SortOrder)}
          >
            <option value="desc">Descendente</option>
            <option value="asc">Ascendente</option>
          </select>
        </label>
      </div>

      {activitiesQuery.isLoading ? <LoadingState /> : null}

      {activitiesQuery.isError ? (
        <ErrorState>
          No pudimos cargar las actividades
          {activitiesQuery.error instanceof Error ? `: ${activitiesQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {deleteActivityMutation.isError ? (
        <ErrorState>
          No pudimos eliminar la actividad
          {deleteActivityMutation.error instanceof Error
            ? `: ${deleteActivityMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      {activitiesQuery.isSuccess && rows.length === 0 ? (
        <EmptyState>No hay actividades para mostrar.</EmptyState>
      ) : null}

      {/* Mismas columnas y mismo orden que antes del restyle. */}
      {activitiesQuery.isSuccess && rows.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Asunto</th>
              <th>Tipo</th>
              <th>Empresa</th>
              <th>Contacto</th>
              <th>Oportunidad</th>
              <th>Autor</th>
              <th>Asignado a</th>
              <th>Vencimiento</th>
              <th>Completada</th>
              {isAdmin ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((activity) => (
              <tr key={activity.id}>
                <td>{activity.subject}</td>
                <td>
                  <Badge variant="neutral">{ACTIVITY_TYPE_LABELS[activity.type]}</Badge>
                </td>
                <td>
                  {activity.companyId
                    ? (companyNames.byId.get(activity.companyId)?.name ?? "—")
                    : ""}
                </td>
                <td>
                  {activity.contactId ? (contactNames.byId.get(activity.contactId) ?? "—") : ""}
                </td>
                <td>
                  {activity.opportunityId
                    ? (opportunityNames.byId.get(activity.opportunityId) ?? "—")
                    : ""}
                </td>
                <td>{resolveUserLabel(activity.authorId)}</td>
                <td>{resolveUserLabel(activity.assigneeId)}</td>
                <td>
                  <span className="ds-cell-inline">
                    <span>{formatDateTime(activity.dueDate)}</span>
                    {isOverdue(activity, now) ? <Badge variant="danger">Vencida</Badge> : null}
                  </span>
                </td>
                <td>{formatDateTime(activity.completedAt)}</td>
                {isAdmin ? (
                  <td>
                    <Link to={`/activities/${activity.id}/edit`}>Editar</Link>{" "}
                    <Button variant="danger" onClick={() => handleDelete(activity.id)}>
                      Eliminar
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      {activitiesQuery.isSuccess ? (
        <Pagination
          page={page}
          totalPages={activitiesQuery.data.pagination.totalPages}
          onPrevious={() => setPage((current) => current - 1)}
          onNext={() => setPage((current) => current + 1)}
        />
      ) : null}
    </div>
  );
}
