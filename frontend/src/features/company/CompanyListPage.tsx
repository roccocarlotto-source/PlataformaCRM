import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { Avatar } from "../../design-system/Avatar";
import { DetailList } from "../../design-system/DetailList";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { useOwnerNames } from "../opportunity/relationResolution";
import { useDeleteCompany } from "./mutations";
import { useCompanies } from "./queries";
import type { CompanySortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

export function CompanyListPage() {
  const { me } = useAuth();
  // Ocultar acciones de escritura para no-ADMIN es cortesía de UX: la
  // autorización real la sigue aplicando authorize("ADMIN") en el backend
  // (POST/PATCH/DELETE /companies). Este chequeo no reemplaza eso.
  //
  // La columna Asignado usa este MISMO booleano, y ahí no es solo cortesía:
  // resolver un ownerId a nombre necesita GET /api/users, que es ADMIN-only.
  const isAdmin = me?.role === "ADMIN";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("");
  const [sortBy, setSortBy] = useState<CompanySortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  // Id de la fila cuyo pop up "Ver detalle" está abierto (§28). Estado local y
  // no una ruta: el detalle no tiene URL propia, decisión tomada en el ítem.
  const [detalleAbierto, setDetalleAbierto] = useState<string | null>(null);

  const companiesQuery = useCompanies({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    industry: industry || undefined,
    sortBy,
    sortOrder,
  });

  // useOwnerNames vive en features/opportunity/relationResolution.ts y se importa
  // desde acá tal cual, sin relocalizarlo a un módulo "compartido": ya existe
  // precedente de import cross-feature en ese mismo archivo, que re-exporta
  // useCompaniesByIds desde features/contact/. Mover el hook sería una
  // refactorización que este cambio no necesita.
  //
  // El booleano gatea el fetch por completo: GET /api/users es ADMIN-only
  // (user.routes.ts), así que para un USER la request nunca se dispara y no hay
  // un 403 que atrapar.
  const ownerNames = useOwnerNames(isAdmin);

  // ownerId es nullable acá (a diferencia de Opportunity), así que el guard
  // no es defensivo de más: sin él, un owner sin asignar entraría a
  // byId.get(null). Sin dueño y dueño que no se pudo resolver muestran lo
  // mismo — "—" —, y es correcto: para quien lee, las dos cosas son "no hay
  // nombre que mostrar acá". Compartido por la columna Asignado y el detalle.
  function nombreDeAsignado(ownerId: string | null): string | null {
    return ownerId ? (ownerNames.byId.get(ownerId) ?? null) : null;
  }

  // La fila del detalle sale del array ya cargado, sin un GET aparte: el
  // listado trae el objeto Company completo (§28). Si la fila desaparece
  // (se eliminó, cambió la página) el pop up se cierra solo.
  const detalle = companiesQuery.data?.data.find((company) => company.id === detalleAbierto);

  const deleteCompanyMutation = useDeleteCompany();

  function handleDelete(id: string) {
    if (!window.confirm("¿Eliminar esta empresa?")) return;
    deleteCompanyMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Empresas</h1>
        {isAdmin ? (
          <Link to="/companies/new" className="ds-link-button">
            {/* Ícono decorativo (16px/1.5, como los del sidebar): el texto
                del link sigue siendo exactamente "Nueva empresa". */}
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Nueva empresa
          </Link>
        ) : null}
      </div>

      {/* Filtros inline, mismo patrón que ContactListPage. El diseño mete la
          búsqueda y un único filtro dentro de la misma tarjeta que la tabla;
          acá hay cuatro controles y el patrón compartido por todos los
          listados es esta barra, así que queda igual. */}
      <div className="ds-list-card">
        <h2 className="ds-filters-title">Filtros</h2>
        <div className="ds-filters">
          <label>
            {/* Solo para lectores de pantalla: el placeholder ya dice "Buscar…" y el
                rótulo visible lo repetía (docs/frontend-cambios-pendientes.md §4.b). */}
            <span className="ds-sr-only">Buscar</span>
            <input
              type="search"
              placeholder="Buscar por nombre"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Industria
            <input
              type="text"
              value={industry}
              onChange={(event) => {
                setIndustry(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Ordenar por
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as CompanySortBy)}
            >
              <option value="createdAt">Fecha de creación</option>
              <option value="name">Nombre</option>
              <option value="industry">Industria</option>
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

        {companiesQuery.isLoading ? <LoadingState /> : null}

        {companiesQuery.isError ? (
          <ErrorState>
            No pudimos cargar las empresas
            {companiesQuery.error instanceof Error ? `: ${companiesQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {/* Reutiliza el estado de la propia mutation (TanStack Query) — sin
          duplicar el error en un useState local. */}
        {deleteCompanyMutation.isError ? (
          <ErrorState>
            No pudimos eliminar la empresa
            {deleteCompanyMutation.error instanceof Error
              ? `: ${deleteCompanyMutation.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {companiesQuery.isSuccess && companiesQuery.data.data.length === 0 ? (
          <EmptyState>No hay empresas para mostrar.</EmptyState>
        ) : null}

        {/* Mismas columnas y mismo orden de siempre (Nombre | Industria |
          Dominio | Asignado | Acciones): CompanyListPage.test.tsx ubica Asignado por
          posición. El diseño muestra otro set de columnas (Teléfono, Ciudad,
          País, sin Dominio ni Acciones); cambiarlo toca datos, no es parte de
          este restyle. */}
        {companiesQuery.isSuccess && companiesQuery.data.data.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Industria</th>
                <th>Dominio</th>
                {isAdmin ? <th>Asignado</th> : null}
                {isAdmin ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {companiesQuery.data.data.map((company) => {
                // Sin nombre no hay avatar: un círculo con "—" adentro no
                // representa a nadie.
                const ownerName = nombreDeAsignado(company.ownerId);
                return (
                  <tr key={company.id}>
                    <td className="ds-cell-primary">{company.name}</td>
                    <td className="ds-cell-muted">{company.industry ?? ""}</td>
                    <td
                      className="ds-cell-muted ds-cell-truncate"
                      title={company.domain ?? undefined}
                    >
                      {company.domain ?? ""}
                    </td>
                    {isAdmin ? (
                      <td>
                        {ownerName ? (
                          <span className="ds-person">
                            {/* decorative: el nombre completo ya está al lado,
                              el avatar no tiene que anunciarse dos veces. */}
                            <Avatar name={ownerName} size="sm" decorative />
                            <span>{ownerName}</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    ) : null}
                    {isAdmin ? (
                      <td>
                        <ActionsMenu
                          actions={[
                            // Primero "Ver detalle": la acción de consulta,
                            // antes que las de escritura (§28).
                            {
                              label: "Ver detalle",
                              onClick: () => setDetalleAbierto(company.id),
                            },
                            { label: "Editar", to: `/companies/${company.id}/edit` },
                            {
                              label: "Eliminar",
                              onClick: () => handleDelete(company.id),
                              destructive: true,
                            },
                          ]}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : null}

        {companiesQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={companiesQuery.data.pagination.totalPages}
            onPrevious={() => setPage((current) => current - 1)}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </div>

      {/* Los mismos campos que CompanyFormPage, en solo lectura, con el
          asignado resuelto igual que en la columna Asignado. */}
      {detalle ? (
        <Modal
          variant="dialog"
          title="Detalle de la empresa"
          onClose={() => setDetalleAbierto(null)}
        >
          <DetailList
            sections={[
              {
                items: [
                  { label: "Nombre", value: detalle.name },
                  { label: "Dominio", value: detalle.domain },
                  { label: "Industria", value: detalle.industry },
                  { label: "Teléfono", value: detalle.phone },
                  { label: "Ciudad", value: detalle.city },
                  { label: "País", value: detalle.country },
                  { label: "Asignado", value: nombreDeAsignado(detalle.ownerId) },
                ],
              },
            ]}
          />
        </Modal>
      ) : null}
    </div>
  );
}
