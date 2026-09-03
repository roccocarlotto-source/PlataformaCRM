import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Avatar } from "../../design-system/Avatar";
import { Badge, type BadgeVariant } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { CompanySelect } from "../company/CompanySelect";
import { PipelineSelect } from "../pipeline/PipelineSelect";
import { useDeleteOpportunity } from "./mutations";
import { useOpportunities } from "./queries";
import {
  useCompanyNames,
  useContactNames,
  useOwnerNames,
  usePipelineNames,
  useStageNames,
} from "./relationResolution";
import type { OpportunitySortBy, OpportunityStatus, SortOrder } from "./types";

const PAGE_SIZE = 20;
const STATUSES: OpportunityStatus[] = ["OPEN", "WON", "LOST"];

// Traducción del enum real a texto + color. Es el mismo status que ya se
// leía crudo; no hay ningún estado inventado.
const STATUS_LABEL: Record<OpportunityStatus, string> = {
  OPEN: "Abierta",
  WON: "Ganada",
  LOST: "Perdida",
};

const STATUS_BADGE_VARIANT: Record<OpportunityStatus, BadgeVariant> = {
  OPEN: "neutral",
  WON: "success",
  LOST: "danger",
};

// amount siempre llega como string desde la API (Prisma.Decimal, ver
// types.ts) — Number() antes de formatear, nunca .toFixed() directo sobre
// el string crudo.
function formatAmount(amount: string, currency: string): string {
  return `${Number(amount).toFixed(2)} ${currency}`;
}

// Fecha sola (sin hora) a partir del ISO de la API. Se toma solo la parte
// YYYY-MM-DD y se formatea en UTC: mismo criterio que el slice(0,10) del
// formulario, para que un "2026-08-15T00:00:00.000Z" no se corra al 14 en
// una zona horaria negativa.
function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Íconos de la columna Asociado (edificio = empresa, persona = contacto).
// Son puramente cosméticos —el nombre al lado es el dato—, por eso van
// aria-hidden y viven acá y no en design-system/: único consumidor.
function BuildingIcon() {
  return (
    <svg className="ds-cell-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 14V3.5A1.5 1.5 0 0 1 4.5 2h4A1.5 1.5 0 0 1 10 3.5V14M10 6h2.5A1.5 1.5 0 0 1 14 7.5V14M2 14h13M5.5 5h2M5.5 8h2M5.5 11h2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg className="ds-cell-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="5" r="2.75" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2.75 14a5.25 5.25 0 0 1 10.5 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function OpportunityListPage() {
  const { me } = useAuth();
  // Ocultar acciones de escritura y la columna Propietario para no-ADMIN es
  // cortesía de UX / respeto al contrato de autorización real: GET
  // /api/users es ADMIN-only (user.routes.ts), así que useOwnerNames se
  // gatea con este mismo booleano — para USER, ese fetch nunca se dispara.
  const isAdmin = me?.role === "ADMIN";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OpportunityStatus | "">("");
  const [companyId, setCompanyId] = useState<string | undefined>(undefined);
  const [pipelineId, setPipelineId] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<OpportunitySortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const opportunitiesQuery = useOpportunities({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    status: status || undefined,
    companyId,
    pipelineId,
    sortBy,
    sortOrder,
  });

  const deleteOpportunityMutation = useDeleteOpportunity();

  const rows = useMemo(() => opportunitiesQuery.data?.data ?? [], [opportunitiesQuery.data]);

  // Solo los ids/pares REALMENTE visibles en esta página — nunca "todas las
  // Companies/Contacts/Pipelines/Stages/Users" (mismo criterio que
  // useCompaniesByIds en ContactListPage, M3).
  const visibleCompanyIds = useMemo(
    () => rows.map((o) => o.companyId).filter((id): id is string => id !== null),
    [rows],
  );
  const visibleContactIds = useMemo(
    () => rows.map((o) => o.contactId).filter((id): id is string => id !== null),
    [rows],
  );
  const visiblePipelineIds = useMemo(() => rows.map((o) => o.pipelineId), [rows]);
  const visibleStageRefs = useMemo(
    () => rows.map((o) => ({ pipelineId: o.pipelineId, stageId: o.stageId })),
    [rows],
  );

  const companyNames = useCompanyNames(visibleCompanyIds);
  const contactNames = useContactNames(visibleContactIds);
  const pipelineNames = usePipelineNames(visiblePipelineIds);
  const stageNames = useStageNames(visibleStageRefs);
  const ownerNames = useOwnerNames(isAdmin);

  function handleDelete(id: string) {
    if (!window.confirm("¿Eliminar esta oportunidad?")) return;
    deleteOpportunityMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Oportunidades</h1>
        {isAdmin ? (
          <Link to="/opportunities/new" className="ds-link-button">
            Nueva oportunidad
          </Link>
        ) : null}
      </div>

      {/* Los mismos filtros que ya existían, con el look del sistema. El
          diseño muestra además Etapa y Propietario, y no muestra el orden:
          agregar filtros es funcionalidad nueva y sacar los que funcionan
          sería una regresión, así que ni una cosa ni la otra. */}
      <div className="ds-filters">
        <label>
          Buscar
          <input
            type="search"
            placeholder="Buscar por título"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Estado
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as OpportunityStatus | "");
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <div>
          <CompanySelect
            id="opportunity-filter-company"
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
        <div>
          <PipelineSelect
            id="opportunity-filter-pipeline"
            label="Filtrar por pipeline"
            value={pipelineId}
            onChange={(id) => {
              setPipelineId(id);
              setPage(1);
            }}
          />
          {pipelineId ? (
            <Button
              onClick={() => {
                setPipelineId(undefined);
                setPage(1);
              }}
            >
              Quitar filtro de pipeline
            </Button>
          ) : null}
        </div>
        <label>
          Ordenar por
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as OpportunitySortBy)}
          >
            <option value="createdAt">Fecha de creación</option>
            <option value="updatedAt">Última actualización</option>
            <option value="amount">Monto</option>
            <option value="title">Título</option>
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

      {opportunitiesQuery.isLoading ? <LoadingState /> : null}

      {opportunitiesQuery.isError ? (
        <ErrorState>
          No pudimos cargar las oportunidades
          {opportunitiesQuery.error instanceof Error
            ? `: ${opportunitiesQuery.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      {deleteOpportunityMutation.isError ? (
        <ErrorState>
          No pudimos eliminar la oportunidad
          {deleteOpportunityMutation.error instanceof Error
            ? `: ${deleteOpportunityMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      {opportunitiesQuery.isSuccess && rows.length === 0 ? (
        <EmptyState>No hay oportunidades para mostrar.</EmptyState>
      ) : null}

      {/* Columnas en el orden de la pantalla "Oportunidades CRM" del diseño. */}
      {opportunitiesQuery.isSuccess && rows.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Título</th>
              <th>Asociado</th>
              <th>Embudo · Etapa</th>
              <th>Monto</th>
              <th>Cierre</th>
              {isAdmin ? <th>Propietario</th> : null}
              <th>Estado</th>
              {isAdmin ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((opportunity) => {
              const companyName = opportunity.companyId
                ? (companyNames.byId.get(opportunity.companyId)?.name ?? "—")
                : null;
              const contactName = opportunity.contactId
                ? (contactNames.byId.get(opportunity.contactId) ?? "—")
                : null;
              const ownerName = ownerNames.byId.get(opportunity.ownerId) ?? null;
              // Abierta → fecha estimada; cerrada (WON o LOST) → fecha real.
              // Son los dos campos que ya existen, cada uno en su caso.
              const isClosed = opportunity.status !== "OPEN";
              const closeDate = isClosed
                ? opportunity.actualCloseDate
                : opportunity.expectedCloseDate;

              return (
                <tr key={opportunity.id}>
                  <td>{opportunity.title}</td>
                  {/* Empresa y Contacto son independientes en el backend y
                      pueden coexistir; el diseño solo muestra uno pero acá
                      no se descarta ninguno: con ambos, dos líneas apiladas;
                      con uno, ese; sin ninguno, "—". Un id que no se pudo
                      resolver muestra "—" en su línea, nunca el UUID. */}
                  <td>
                    {companyName === null && contactName === null ? (
                      "—"
                    ) : (
                      <span className="ds-cell-stack">
                        {companyName !== null ? (
                          <span className="ds-cell-with-icon">
                            <BuildingIcon />
                            <span>{companyName}</span>
                          </span>
                        ) : null}
                        {contactName !== null ? (
                          <span className="ds-cell-with-icon">
                            <PersonIcon />
                            <span>{contactName}</span>
                          </span>
                        ) : null}
                      </span>
                    )}
                  </td>
                  <td>
                    <Badge variant="neutral">
                      {`${pipelineNames.byId.get(opportunity.pipelineId) ?? "—"} · ${
                        stageNames.byId.get(opportunity.stageId) ?? "—"
                      }`}
                    </Badge>
                  </td>
                  <td>{formatAmount(opportunity.amount, opportunity.currency)}</td>
                  <td>
                    <span className="ds-cell-stack">
                      <span className="ds-cell-caption">
                        {isClosed ? "Cierre real" : "Estimado"}
                      </span>
                      <span>{closeDate ? formatDate(closeDate) : "—"}</span>
                    </span>
                  </td>
                  {isAdmin ? (
                    <td>
                      {ownerName ? (
                        <span className="ds-person">
                          <Avatar name={ownerName} size="sm" decorative />
                          <span>{ownerName}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  ) : null}
                  <td>
                    <Badge variant={STATUS_BADGE_VARIANT[opportunity.status]}>
                      {STATUS_LABEL[opportunity.status]}
                    </Badge>
                  </td>
                  {isAdmin ? (
                    <td>
                      <Link to={`/opportunities/${opportunity.id}/edit`}>Editar</Link>{" "}
                      <Button variant="danger" onClick={() => handleDelete(opportunity.id)}>
                        Eliminar
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : null}

      {opportunitiesQuery.isSuccess ? (
        <Pagination
          page={page}
          totalPages={opportunitiesQuery.data.pagination.totalPages}
          onPrevious={() => setPage((current) => current - 1)}
          onNext={() => setPage((current) => current + 1)}
        />
      ) : null}
    </div>
  );
}
