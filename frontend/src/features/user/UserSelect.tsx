import { useUsers } from "./queries";

interface UserSelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  onChange: (ownerId: string) => void;
  // Texto de la opción vacía del <select>. El default conserva el texto
  // histórico de M5 ("Asignado a quien crea (por defecto)") como red de
  // seguridad para el test de regresión de UserSelect.test.tsx, pero desde el
  // ítem 7 de docs/frontend-cambios-pendientes.md ningún caller lo usa: los
  // cinco formularios pasan "Sin asignar" explícitamente. Company/Contact/
  // Opportunity (ownerId) preseleccionan a quien crea en creación, así que
  // la opción vacía solo les aparece al editar un registro viejo sin dueño;
  // Activity/Vehicle (assigneeId / assignedSalespersonId) nunca autoasignan
  // (activity.service.ts validateAssigneeId) y "Sin asignar" es literal.
  emptyOptionLabel?: string;
  // ¿El campo puede volver a "sin asignar" una vez que tiene un usuario?
  // Refleja lo que el backend acepta en el PATCH, no una preferencia de UI:
  //   - true (default): assigneeId de Activity y assignedSalespersonId de
  //     Vehicle admiten null en update, así que la opción vacía se ofrece
  //     siempre — elegirla es la única forma de desasignar.
  //   - false: ownerId de Company/Contact/Opportunity NO se puede limpiar
  //     (chequeo truthy en los tres services). La opción vacía se renderiza
  //     solo mientras no hay valor; con un usuario ya seleccionado (el creador
  //     preseleccionado, o el dueño real en edición) el <select> muestra
  //     únicamente la lista, sin una entrada vacía que compita con el que ya
  //     está marcado ni prometa un "quitar" que el backend ignoraría.
  clearable?: boolean;
}

// Selector de usuario reutilizado por los formularios de Company, Contact y
// Opportunity (owner), Activity (assignee) y Vehicle (vendedor asignado) —
// siempre montado detrás de AdminRoute, así que GET /api/users (ADMIN-only)
// nunca resulta en 403 acá.
//
// <select> simple, sin búsqueda de texto: a diferencia de CompanySelect,
// GET /api/users no tiene filtro `search` en el contrato real
// (user.controller.ts listQuerySchema) — no se inventa uno del lado del
// frontend. isActive:true explícito: omitirlo traería también usuarios
// desactivados, que resolveOwnerId (ownership.service.ts) rechazaría igual
// al guardar — ofrecerlos acá sería ofrecer una opción que el backend va a
// rechazar. pageSize:100 es el máximo del contrato; una organización con
// más de 100 usuarios activos no ve el resto en este picker (riesgo
// residual documentado, no resuelto acá — requeriría búsqueda server-side
// que el backend no expone).
export function UserSelect({
  id,
  label,
  value,
  onChange,
  emptyOptionLabel = "Asignado a quien crea (por defecto)",
  clearable = true,
}: UserSelectProps) {
  const usersQuery = useUsers({
    pageSize: 100,
    isActive: true,
    sortBy: "fullName",
    sortOrder: "asc",
  });

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {usersQuery.isLoading ? <p>Cargando…</p> : null}
      {usersQuery.isError ? (
        <p role="alert">
          No pudimos cargar los usuarios
          {usersQuery.error instanceof Error ? `: ${usersQuery.error.message}` : "."}
        </p>
      ) : null}
      {usersQuery.isSuccess ? (
        <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
          {clearable || !value ? <option value="">{emptyOptionLabel}</option> : null}
          {usersQuery.data.data.map((user) => (
            <option key={user.id} value={user.id}>
              {user.fullName}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
