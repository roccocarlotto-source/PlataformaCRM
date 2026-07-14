import { useUsers } from "./queries";

interface UserSelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  onChange: (ownerId: string) => void;
}

// Selector de owner para OpportunityFormPage — siempre montado detrás de
// AdminRoute (ver opportunity/OpportunityFormPage.tsx), así que GET
// /api/users (ADMIN-only) nunca resulta en 403 acá.
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
export function UserSelect({ id, label, value, onChange }: UserSelectProps) {
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
          <option value="">Asignado a quien crea (por defecto)</option>
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
