import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { DetailList } from "../../design-system/DetailList";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { SortOrderSelect } from "../../design-system/SortOrderSelect";
import { Table } from "../../design-system/Table";
import { CompanySelect } from "../company/CompanySelect";
import { useCompaniesByIds } from "../contact/companyResolution";
import { useContactNames, useOwnerNames } from "../opportunity/relationResolution";
import { useConfirmActivity, useDeleteActivity } from "./mutations";
import { useActivities } from "./queries";
import {
  resolveUserLabel as resolveUserLabelShared,
  useOpportunityNames,
} from "./relationResolution";
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS, confirmationStatusOf } from "./types";
import type {
  Activity,
  ActivityConfirmationStatus,
  ActivitySortBy,
  ActivityType,
  SortOrder,
} from "./types";

const PAGE_SIZE = 20;

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

// Columna "Confirmación" (§29): el mismo Badge en la tabla y en el detalle.
// "—" neutral para lo que no está completado (no hay nada que confirmar),
// info mientras espera al ADMIN, success una vez confirmada.
const CONFIRMATION_BADGE: Record<
  ActivityConfirmationStatus,
  { label: string; variant: "neutral" | "info" | "success" }
> = {
  NOT_COMPLETED: { label: "—", variant: "neutral" },
  AWAITING_CONFIRMATION: { label: "Pendiente de confirmar", variant: "info" },
  CONFIRMED: { label: "Confirmada", variant: "success" },
};

function confirmationBadge(activity: Activity) {
  const { label, variant } = CONFIRMATION_BADGE[confirmationStatusOf(activity)];
  return <Badge variant={variant}>{label}</Badge>;
}

// Filtro "Confirmación": "" = todas; los otros dos solo tienen sentido sobre
// completadas, así que mandan completed=true implícito junto con confirmed.
type ConfirmationFilter = "" | "AWAITING_CONFIRMATION" | "CONFIRMED";

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
  const [confirmation, setConfirmation] = useState<ConfirmationFilter>("");
  const [sortBy, setSortBy] = useState<ActivitySortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  // Id de la fila cuyo pop up "Ver detalle" está abierto (§28). Estado local y
  // no una ruta: el detalle no tiene URL propia, decisión tomada en el ítem.
  const [detalleAbierto, setDetalleAbierto] = useState<string | null>(null);

  const activitiesQuery = useActivities({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    type: type || undefined,
    companyId,
    completed: confirmation ? true : undefined,
    confirmed: confirmation ? confirmation === "CONFIRMED" : undefined,
    sortBy,
    sortOrder,
  });

  const deleteActivityMutation = useDeleteActivity();
  const confirmActivityMutation = useConfirmActivity();

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

  // La regla ("Vos" / nombre resuelto / "—") vive en relationResolution.ts
  // desde el §30, compartida con el feed de actividad del Dashboard.
  const resolveUserLabel = (userId: string | null) =>
    resolveUserLabelShared(userId, { meId: me?.id, isAdmin, names: userNames.byId });

  // La fila del detalle sale del array ya cargado, sin un GET aparte: el
  // listado trae el objeto Activity completo (§28). Si la fila desaparece
  // (se eliminó, cambió la página) el pop up se cierra solo.
  const detalle = rows.find((activity) => activity.id === detalleAbierto);

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
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Nueva actividad
          </Link>
        ) : null}
      </div>

      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <label>
            {/* Solo para lectores de pantalla: el placeholder ya dice "Buscar…" y el
                rótulo visible lo repetía (docs/frontend-cambios-pendientes.md §4.b). */}
            <span className="ds-sr-only">Buscar</span>
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
          <Select
            label="Tipo"
            value={type}
            options={ACTIVITY_TYPES.map((t) => ({ value: t, label: ACTIVITY_TYPE_LABELS[t] }))}
            emptyOption={{ label: "Todos" }}
            onChange={(value) => {
              setType(value);
              setPage(1);
            }}
          />
          <Select
            label="Confirmación"
            value={confirmation}
            options={[
              { value: "AWAITING_CONFIRMATION", label: "Pendiente de confirmar" },
              { value: "CONFIRMED", label: "Confirmada" },
            ]}
            emptyOption={{ label: "Todas" }}
            onChange={(value) => {
              setConfirmation(value);
              setPage(1);
            }}
          />
          <div>
            <CompanySelect
              id="activity-filter-company"
              label="Empresa"
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
          <Select
            label="Ordenar por"
            value={sortBy}
            options={[
              { value: "createdAt", label: "Fecha de creación" },
              { value: "updatedAt", label: "Última actualización" },
              { value: "dueDate", label: "Vencimiento" },
              { value: "completedAt", label: "Completada" },
              { value: "subject", label: "Asunto" },
            ]}
            onChange={(value) => {
              if (value) setSortBy(value);
            }}
          />
          <SortOrderSelect value={sortOrder} onChange={setSortOrder} />
        </div>

        {activitiesQuery.isLoading ? <LoadingState variant="rows" /> : null}

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

        {confirmActivityMutation.isError ? (
          <ErrorState>
            No pudimos {confirmActivityMutation.variables?.confirmed ? "confirmar" : "rechazar"} la
            actividad
            {confirmActivityMutation.error instanceof Error
              ? `: ${confirmActivityMutation.error.message}`
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
                <th>Confirmación</th>
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
                  <td>{confirmationBadge(activity)}</td>
                  {isAdmin ? (
                    <td>
                      <ActionsMenu
                        actions={[
                          // Primero "Ver detalle": la acción de consulta,
                          // antes que las de escritura (§28).
                          {
                            label: "Ver detalle",
                            onClick: () => setDetalleAbierto(activity.id),
                          },
                          // Confirmar / Rechazar (§29): acciones de flujo de
                          // trabajo, entre la consulta y la edición, y SOLO
                          // mientras la tarea espera confirmación. Una vez
                          // confirmada no aparecen: revertirla es edición
                          // manual, fuera de este menú.
                          ...(confirmationStatusOf(activity) === "AWAITING_CONFIRMATION"
                            ? [
                                {
                                  label: "Confirmar",
                                  onClick: () =>
                                    confirmActivityMutation.mutate({
                                      id: activity.id,
                                      confirmed: true,
                                    }),
                                },
                                {
                                  label: "Rechazar",
                                  onClick: () =>
                                    confirmActivityMutation.mutate({
                                      id: activity.id,
                                      confirmed: false,
                                    }),
                                },
                              ]
                            : []),
                          { label: "Editar", to: `/activities/${activity.id}/edit` },
                          {
                            label: "Eliminar",
                            onClick: () => handleDelete(activity.id),
                            destructive: true,
                          },
                        ]}
                      />
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

      {/* Los mismos campos que ActivityFormPage, en solo lectura, con las
          relaciones y las fechas resueltas igual que en las columnas. Autor
          no está en el formulario (no se edita) pero sí en la tabla: es un
          dato de la actividad y el detalle no lo recorta. */}
      {detalle ? (
        <Modal
          variant="dialog"
          title="Detalle de la actividad"
          onClose={() => setDetalleAbierto(null)}
        >
          <DetailList
            sections={[
              {
                items: [
                  {
                    label: "Tipo",
                    value: <Badge variant="neutral">{ACTIVITY_TYPE_LABELS[detalle.type]}</Badge>,
                  },
                  { label: "Asunto", value: detalle.subject },
                  { label: "Notas", value: detalle.body },
                  {
                    label: "Empresa",
                    value: detalle.companyId
                      ? (companyNames.byId.get(detalle.companyId)?.name ?? "—")
                      : null,
                  },
                  {
                    label: "Contacto",
                    value: detalle.contactId
                      ? (contactNames.byId.get(detalle.contactId) ?? "—")
                      : null,
                  },
                  {
                    label: "Oportunidad",
                    value: detalle.opportunityId
                      ? (opportunityNames.byId.get(detalle.opportunityId) ?? "—")
                      : null,
                  },
                  { label: "Autor", value: resolveUserLabel(detalle.authorId) },
                  { label: "Asignado a", value: resolveUserLabel(detalle.assigneeId) },
                  { label: "Vencimiento", value: formatDateTime(detalle.dueDate) },
                  { label: "Completada", value: formatDateTime(detalle.completedAt) },
                  // §29: el mismo Badge de la columna y, solo si está
                  // confirmada, quién y cuándo (nombre resuelto como Autor/
                  // Asignado, nunca el UUID).
                  { label: "Confirmación", value: confirmationBadge(detalle) },
                  ...(confirmationStatusOf(detalle) === "CONFIRMED"
                    ? [
                        { label: "Confirmada por", value: resolveUserLabel(detalle.confirmedById) },
                        {
                          label: "Fecha de confirmación",
                          value: formatDateTime(detalle.confirmedAt),
                        },
                      ]
                    : []),
                ],
              },
            ]}
          />
        </Modal>
      ) : null}
    </div>
  );
}
