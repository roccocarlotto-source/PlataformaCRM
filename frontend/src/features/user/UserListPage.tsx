import { useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { useDeleteUser, useUpdateUser } from "./mutations";
import { useUsers } from "./queries";
import type { User, UserSortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

// Sin GET /api/users/:id (ver api.ts) — no hay ruta de edición propia. Cada
// fila edita isActive/role en línea, directo sobre la mutation, sin un
// "Guardar" separado: son los únicos dos campos editables reales
// (UpdateUserInput), proporcional no construir un formulario/ruta aparte
// para eso.
//
// Restyle con criterio propio (sin export de referencia para esta pantalla):
// mismas piezas que PipelineListPage y QrListPage — Badge para el estado,
// Button en .ds-row-actions para las acciones, ErrorState para los errores
// por fila. Los textos, los nombres accesibles y las condiciones (fila
// propia sin controles, errores scopeados por fila) no cambian.
function UserRow({ user, isSelf }: { user: User; isSelf: boolean }) {
  const updateUserMutation = useUpdateUser(user.id);
  const deleteUserMutation = useDeleteUser();

  function handleRoleChange(role: "ADMIN" | "USER") {
    if (role === user.role.name) return;
    updateUserMutation.mutate({ role });
  }

  function handleToggleActive() {
    updateUserMutation.mutate({ isActive: !user.isActive });
  }

  function handleDelete() {
    if (!window.confirm(`¿Eliminar a ${user.fullName} de la organización?`)) return;
    deleteUserMutation.mutate(user.id);
  }

  return (
    <tr>
      <td className="ds-cell-primary">{user.fullName}</td>
      <td className="ds-cell-muted">{user.email}</td>
      <td>
        {isSelf ? (
          user.role.name
        ) : (
          <select
            aria-label={`Rol de ${user.fullName}`}
            value={user.role.name}
            onChange={(event) => handleRoleChange(event.target.value as "ADMIN" | "USER")}
            disabled={updateUserMutation.isPending}
          >
            <option value="ADMIN">ADMIN</option>
            <option value="USER">USER</option>
          </select>
        )}
      </td>
      <td>
        {/* Mapeo explícito, como en el resto de los listados: Inactivo no es
            un error ni un peligro, solo un estado neutro. */}
        {user.isActive ? (
          <Badge variant="success">Activo</Badge>
        ) : (
          <Badge variant="neutral">Inactivo</Badge>
        )}
      </td>
      <td>
        {/* Fila propia: sin controles de modificación — refleja
            visualmente el 400 real que el backend ya garantiza
            (targetUserId === actorUserId), mismo criterio que AdminRoute. */}
        {isSelf ? null : (
          <div className="ds-row-actions">
            <Button onClick={handleToggleActive} disabled={updateUserMutation.isPending}>
              {user.isActive ? "Desactivar" : "Activar"}
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleteUserMutation.isPending}>
              Eliminar
            </Button>
          </div>
        )}
        {updateUserMutation.isError ? (
          <ErrorState>
            {updateUserMutation.error instanceof Error
              ? updateUserMutation.error.message
              : "No se pudo actualizar el usuario."}
          </ErrorState>
        ) : null}
        {deleteUserMutation.isError && deleteUserMutation.variables === user.id ? (
          <ErrorState>
            {deleteUserMutation.error instanceof Error
              ? deleteUserMutation.error.message
              : "No se pudo eliminar el usuario."}
          </ErrorState>
        ) : null}
      </td>
    </tr>
  );
}

export function UserListPage() {
  const { me } = useAuth();

  const [page, setPage] = useState(1);
  const [role, setRole] = useState<"ADMIN" | "USER" | "">("");
  const [isActive, setIsActive] = useState<"true" | "false" | "">("");
  const [sortBy, setSortBy] = useState<UserSortBy>("fullName");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  const usersQuery = useUsers({
    page,
    pageSize: PAGE_SIZE,
    role: role || undefined,
    isActive: isActive === "" ? undefined : isActive === "true",
    sortBy,
    sortOrder,
  });

  const rows = useMemo(() => usersQuery.data?.data ?? [], [usersQuery.data]);

  return (
    <div>
      {/* Sin acción a la derecha: no hay ruta de creación de usuarios (entran
          por invitación). */}
      <div className="ds-page-header">
        <h1>Usuarios</h1>
      </div>

      <h2 className="ds-filters-title">Filtros</h2>
      <div className="ds-filters">
        <label>
          Rol
          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value as "ADMIN" | "USER" | "");
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="ADMIN">ADMIN</option>
            <option value="USER">USER</option>
          </select>
        </label>
        <label>
          Estado
          <select
            value={isActive}
            onChange={(event) => {
              setIsActive(event.target.value as "true" | "false" | "");
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="true">Activo</option>
            <option value="false">Inactivo</option>
          </select>
        </label>
        <label>
          Ordenar por
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as UserSortBy)}>
            <option value="fullName">Nombre</option>
            <option value="createdAt">Fecha de alta</option>
          </select>
        </label>
        {/* Antes era un <select> suelto sin rótulo; ahora lleva "Orden" como
            en el resto de los listados. */}
        <label>
          Orden
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as SortOrder)}
          >
            <option value="asc">Ascendente</option>
            <option value="desc">Descendente</option>
          </select>
        </label>
      </div>

      {usersQuery.isLoading ? <LoadingState /> : null}

      {usersQuery.isError ? (
        <ErrorState>
          No pudimos cargar los usuarios
          {usersQuery.error instanceof Error ? `: ${usersQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {usersQuery.isSuccess && rows.length === 0 ? (
        <EmptyState>No hay usuarios para mostrar.</EmptyState>
      ) : null}

      {usersQuery.isSuccess && rows.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <UserRow key={user.id} user={user} isSelf={user.id === me?.id} />
            ))}
          </tbody>
        </Table>
      ) : null}

      {/* Pagination renderiza exactamente los mismos textos ("Anterior",
          "Página X de Y", "Siguiente") y el mismo disabled en los extremos
          que la paginación armada a mano que había acá. La única diferencia
          es que el número de página sale del estado local en vez de la
          respuesta; son el mismo valor porque la query se pide con ese
          `page`. */}
      {usersQuery.isSuccess ? (
        <Pagination
          page={page}
          totalPages={usersQuery.data.pagination.totalPages}
          onPrevious={() => setPage((current) => current - 1)}
          onNext={() => setPage((current) => current + 1)}
        />
      ) : null}
    </div>
  );
}
