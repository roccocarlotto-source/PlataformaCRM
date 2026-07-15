import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useOwnerNames } from "../opportunity/relationResolution";
import { useRevokeInvitation } from "./mutations";
import { useInvitations } from "./queries";
import { INVITATION_STATUSES, INVITATION_STATUS_LABELS } from "./types";
import type { InvitationSortBy, InvitationStatus, SortOrder } from "./types";

const PAGE_SIZE = 20;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

// Esta página es siempre ADMIN (AdminRoute la envuelve, ver router.tsx) —
// GET /invitations es ADMIN-only en el propio contrato, a diferencia de
// Activity. useOwnerNames(true) es seguro sin gating condicional acá.
export function InvitationListPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<InvitationStatus | "">("");
  const [sortBy, setSortBy] = useState<InvitationSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const invitationsQuery = useInvitations({
    page,
    pageSize: PAGE_SIZE,
    status: status || undefined,
    sortBy,
    sortOrder,
  });

  const revokeInvitationMutation = useRevokeInvitation();

  const rows = useMemo(() => invitationsQuery.data?.data ?? [], [invitationsQuery.data]);

  // invitedById SÍ es resoluble: reutiliza tal cual la infraestructura de
  // M5 (opportunity/relationResolution.ts, useOwnerNames) — trae hasta 100
  // usuarios activos y arma un mapa id -> fullName, sin filtrar por ids
  // puntuales (ese hook no lo soporta), sin duplicarla.
  const inviterNames = useOwnerNames(true);

  function handleRevoke(id: string) {
    if (!window.confirm("¿Revocar esta invitación?")) return;
    revokeInvitationMutation.mutate(id);
  }

  return (
    <div>
      <h1>Invitaciones</h1>
      <Link to="/invitations/new">Invitar</Link>

      <div>
        <label>
          Estado
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as InvitationStatus | "");
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            {INVITATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INVITATION_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ordenar por
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as InvitationSortBy)}
          >
            <option value="createdAt">Fecha de creación</option>
            <option value="expiresAt">Vencimiento</option>
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

      {invitationsQuery.isLoading ? <p>Cargando…</p> : null}

      {invitationsQuery.isError ? (
        <p role="alert">
          No pudimos cargar las invitaciones
          {invitationsQuery.error instanceof Error ? `: ${invitationsQuery.error.message}` : "."}
        </p>
      ) : null}

      {revokeInvitationMutation.isError ? (
        <p role="alert">
          No pudimos revocar la invitación
          {revokeInvitationMutation.error instanceof Error
            ? `: ${revokeInvitationMutation.error.message}`
            : "."}
        </p>
      ) : null}

      {invitationsQuery.isSuccess && rows.length === 0 ? (
        <p>No hay invitaciones para mostrar.</p>
      ) : null}

      {invitationsQuery.isSuccess && rows.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Invitado por</th>
              <th>Creada</th>
              <th>Vence</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((invitation) => (
              <tr key={invitation.id}>
                <td>{invitation.email}</td>
                {/* roleId nunca se resuelve a nombre: no existe GET
                    /api/roles ni include en el contrato real (ver
                    types.ts) — "—" en vez de inventar un mapeo o mostrar
                    el UUID crudo. */}
                <td>—</td>
                <td>{INVITATION_STATUS_LABELS[invitation.status]}</td>
                <td>{inviterNames.byId.get(invitation.invitedById) ?? "—"}</td>
                <td>{formatDate(invitation.createdAt)}</td>
                <td>{formatDate(invitation.expiresAt)}</td>
                <td>
                  {invitation.status === "PENDING" ? (
                    <button
                      type="button"
                      onClick={() => handleRevoke(invitation.id)}
                      disabled={revokeInvitationMutation.isPending}
                    >
                      Revocar
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {invitationsQuery.isSuccess ? (
        <div>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </button>
          <span>
            Página {invitationsQuery.data.pagination.page} de{" "}
            {invitationsQuery.data.pagination.totalPages || 1}
          </span>
          <button
            type="button"
            disabled={page >= invitationsQuery.data.pagination.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
