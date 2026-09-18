import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, type BadgeVariant } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Select } from "../../design-system/Select";
import { SortOrderSelect } from "../../design-system/SortOrderSelect";
import { Table } from "../../design-system/Table";
import { useOwnerNames } from "../opportunity/relationResolution";
import { useRevokeInvitation } from "./mutations";
import { useInvitations } from "./queries";
import { INVITATION_STATUSES, INVITATION_STATUS_LABELS } from "./types";
import type { InvitationSortBy, InvitationStatus, SortOrder } from "./types";

const PAGE_SIZE = 20;

// Color del badge de estado, decidido acá y no en Badge (ver Badge.tsx):
// Pendiente espera una acción (info, el acento), Aceptada salió bien
// (success), Revocada fue cortada a propósito (danger), Vencida es un estado
// inerte, no un error activo (neutral).
const STATUS_BADGE: Record<InvitationStatus, BadgeVariant> = {
  PENDING: "info",
  ACCEPTED: "success",
  REVOKED: "danger",
  EXPIRED: "neutral",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

// Esta página es siempre ADMIN (AdminRoute la envuelve, ver router.tsx) —
// GET /invitations es ADMIN-only en el propio contrato, a diferencia de
// Activity. useOwnerNames(true) es seguro sin gating condicional acá.
//
// Restyle con criterio propio (sin export de referencia): mismas piezas que
// PipelineListPage. Textos, rótulos y condiciones (Revocar solo en PENDING,
// "—" para el rol, nombre resuelto del invitador) no cambian.
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
      <div className="ds-page-header">
        <h1>Invitaciones</h1>
        <Link to="/invitations/new" className="ds-link-button">
          Invitar
        </Link>
      </div>

      <h2 className="ds-filters-title">Filtros</h2>
      <div className="ds-filters">
        <Select
          label="Estado"
          value={status}
          options={INVITATION_STATUSES.map((s) => ({
            value: s,
            label: INVITATION_STATUS_LABELS[s],
          }))}
          emptyOption={{ label: "Todos" }}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <Select
          label="Ordenar por"
          value={sortBy}
          options={[
            { value: "createdAt", label: "Fecha de creación" },
            { value: "expiresAt", label: "Vencimiento" },
          ]}
          onChange={(value) => {
            if (value) setSortBy(value);
          }}
        />
        {/* Antes era un desplegable suelto sin rótulo; ahora lleva "Orden" como
            en el resto de los listados. */}
        <SortOrderSelect value={sortOrder} onChange={setSortOrder} />
      </div>

      {invitationsQuery.isLoading ? <LoadingState /> : null}

      {invitationsQuery.isError ? (
        <ErrorState>
          No pudimos cargar las invitaciones
          {invitationsQuery.error instanceof Error ? `: ${invitationsQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {revokeInvitationMutation.isError ? (
        <ErrorState>
          No pudimos revocar la invitación
          {revokeInvitationMutation.error instanceof Error
            ? `: ${revokeInvitationMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      {invitationsQuery.isSuccess && rows.length === 0 ? (
        <EmptyState>No hay invitaciones para mostrar.</EmptyState>
      ) : null}

      {invitationsQuery.isSuccess && rows.length > 0 ? (
        <Table>
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
                <td className="ds-cell-primary">{invitation.email}</td>
                {/* roleId nunca se resuelve a nombre: no existe GET
                    /api/roles ni include en el contrato real (ver
                    types.ts) — "—" en vez de inventar un mapeo o mostrar
                    el UUID crudo. */}
                <td className="ds-cell-muted">—</td>
                <td>
                  <Badge variant={STATUS_BADGE[invitation.status]}>
                    {INVITATION_STATUS_LABELS[invitation.status]}
                  </Badge>
                </td>
                <td>{inviterNames.byId.get(invitation.invitedById) ?? "—"}</td>
                <td className="ds-cell-muted">{formatDate(invitation.createdAt)}</td>
                <td className="ds-cell-muted">{formatDate(invitation.expiresAt)}</td>
                <td>
                  {invitation.status === "PENDING" ? (
                    <Button
                      variant="danger"
                      onClick={() => handleRevoke(invitation.id)}
                      disabled={revokeInvitationMutation.isPending}
                    >
                      Revocar
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      {/* Pagination renderiza los mismos textos ("Anterior", "Página X de
          Y" con el mismo `|| 1`, "Siguiente") y el mismo disabled en los
          extremos que la paginación a mano que había acá; el número de
          página sale del estado local en vez de la respuesta, que es el
          mismo valor porque la query se pide con ese `page`. */}
      {invitationsQuery.isSuccess ? (
        <Pagination
          page={page}
          totalPages={invitationsQuery.data.pagination.totalPages}
          onPrevious={() => setPage((current) => current - 1)}
          onNext={() => setPage((current) => current + 1)}
        />
      ) : null}
    </div>
  );
}
