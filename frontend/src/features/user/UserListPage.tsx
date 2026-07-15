import { useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useDeleteUser, useUpdateUser } from "./mutations";
import { useUsers } from "./queries";
import type { User, UserSortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

// Sin GET /api/users/:id (ver api.ts) — no hay ruta de edición propia. Cada
// fila edita isActive/role en línea, directo sobre la mutation, sin un
// "Guardar" separado: son los únicos dos campos editables reales
// (UpdateUserInput), proporcional no construir un formulario/ruta aparte
// para eso.
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
      <td>{user.fullName}</td>
      <td>{user.email}</td>
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
      <td>{user.isActive ? "Activo" : "Inactivo"}</td>
      <td>
        {/* Fila propia: sin controles de modificación — refleja
            visualmente el 400 real que el backend ya garantiza
            (targetUserId === actorUserId), mismo criterio que AdminRoute. */}
        {isSelf ? null : (
          <>
            <button type="button" onClick={handleToggleActive} disabled={updateUserMutation.isPending}>
              {user.isActive ? "Desactivar" : "Activar"}
            </button>
            <button type="button" onClick={handleDelete} disabled={deleteUserMutation.isPending}>
              Eliminar
            </button>
          </>
        )}
        {updateUserMutation.isError ? (
          <p role="alert">
            {updateUserMutation.error instanceof Error
              ? updateUserMutation.error.message
              : "No se pudo actualizar el usuario."}
          </p>
        ) : null}
        {deleteUserMutation.isError && deleteUserMutation.variables === user.id ? (
          <p role="alert">
            {deleteUserMutation.error instanceof Error
              ? deleteUserMutation.error.message
              : "No se pudo eliminar el usuario."}
          </p>
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
      <h1>Usuarios</h1>

      <div>
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
        <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)}>
          <option value="asc">Ascendente</option>
          <option value="desc">Descendente</option>
        </select>
      </div>

      {usersQuery.isLoading ? <p>Cargando…</p> : null}

      {usersQuery.isError ? (
        <p role="alert">
          No pudimos cargar los usuarios
          {usersQuery.error instanceof Error ? `: ${usersQuery.error.message}` : "."}
        </p>
      ) : null}

      {usersQuery.isSuccess && rows.length === 0 ? <p>No hay usuarios para mostrar.</p> : null}

      {usersQuery.isSuccess && rows.length > 0 ? (
        <table>
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
        </table>
      ) : null}

      {usersQuery.isSuccess ? (
        <div>
          <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            Anterior
          </button>
          <span>
            Página {usersQuery.data.pagination.page} de {usersQuery.data.pagination.totalPages || 1}
          </span>
          <button
            type="button"
            disabled={page >= usersQuery.data.pagination.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
