import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
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

// amount siempre llega como string desde la API (Prisma.Decimal, ver
// types.ts) — Number() antes de formatear, nunca .toFixed() directo sobre
// el string crudo.
function formatAmount(amount: string, currency: string): string {
  return `${Number(amount).toFixed(2)} ${currency}`;
}

export function OpportunityListPage() {
  const { me } = useAuth();
  // Ocultar acciones de escritura y la columna Owner para no-ADMIN es
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
      <h1>Oportunidades</h1>
      {isAdmin ? <Link to="/opportunities/new">Nueva oportunidad</Link> : null}

      <div>
        <input
          type="search"
          placeholder="Buscar por título"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
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
                {s}
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
            <button
              type="button"
              onClick={() => {
                setCompanyId(undefined);
                setPage(1);
              }}
            >
              Quitar filtro de empresa
            </button>
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
            <button
              type="button"
              onClick={() => {
                setPipelineId(undefined);
                setPage(1);
              }}
            >
              Quitar filtro de pipeline
            </button>
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
        <select
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value as SortOrder)}
        >
          <option value="desc">Descendente</option>
          <option value="asc">Ascendente</option>
        </select>
      </div>

      {opportunitiesQuery.isLoading ? <p>Cargando…</p> : null}

      {opportunitiesQuery.isError ? (
        <p role="alert">
          No pudimos cargar las oportunidades
          {opportunitiesQuery.error instanceof Error
            ? `: ${opportunitiesQuery.error.message}`
            : "."}
        </p>
      ) : null}

      {deleteOpportunityMutation.isError ? (
        <p role="alert">
          No pudimos eliminar la oportunidad
          {deleteOpportunityMutation.error instanceof Error
            ? `: ${deleteOpportunityMutation.error.message}`
            : "."}
        </p>
      ) : null}

      {opportunitiesQuery.isSuccess && rows.length === 0 ? (
        <p>No hay oportunidades para mostrar.</p>
      ) : null}

      {opportunitiesQuery.isSuccess && rows.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Título</th>
              <th>Empresa</th>
              <th>Contacto</th>
              <th>Pipeline</th>
              <th>Etapa</th>
              <th>Estado</th>
              <th>Monto</th>
              {isAdmin ? <th>Owner</th> : null}
              {isAdmin ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((opportunity) => (
              <tr key={opportunity.id}>
                <td>{opportunity.title}</td>
                <td>
                  {opportunity.companyId
                    ? (companyNames.byId.get(opportunity.companyId)?.name ?? "—")
                    : ""}
                </td>
                <td>
                  {opportunity.contactId
                    ? (contactNames.byId.get(opportunity.contactId) ?? "—")
                    : ""}
                </td>
                <td>{pipelineNames.byId.get(opportunity.pipelineId) ?? "—"}</td>
                <td>{stageNames.byId.get(opportunity.stageId) ?? "—"}</td>
                <td>{opportunity.status}</td>
                <td>{formatAmount(opportunity.amount, opportunity.currency)}</td>
                {isAdmin ? <td>{ownerNames.byId.get(opportunity.ownerId) ?? "—"}</td> : null}
                {isAdmin ? (
                  <td>
                    <Link to={`/opportunities/${opportunity.id}/edit`}>Editar</Link>
                    <button type="button" onClick={() => handleDelete(opportunity.id)}>
                      Eliminar
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {opportunitiesQuery.isSuccess ? (
        <div>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </button>
          <span>
            Página {opportunitiesQuery.data.pagination.page} de{" "}
            {opportunitiesQuery.data.pagination.totalPages || 1}
          </span>
          <button
            type="button"
            disabled={page >= opportunitiesQuery.data.pagination.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
