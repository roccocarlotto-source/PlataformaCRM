import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useDeleteCompany } from "./mutations";
import { useCompanies } from "./queries";
import type { CompanySortBy, SortOrder } from "./types";

const PAGE_SIZE = 20;

export function CompanyListPage() {
  const { me } = useAuth();
  // Ocultar acciones de escritura para no-ADMIN es cortesía de UX: la
  // autorización real la sigue aplicando authorize("ADMIN") en el backend
  // (POST/PATCH/DELETE /companies). Este chequeo no reemplaza eso.
  const isAdmin = me?.role === "ADMIN";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("");
  const [sortBy, setSortBy] = useState<CompanySortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const companiesQuery = useCompanies({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    industry: industry || undefined,
    sortBy,
    sortOrder,
  });

  const deleteCompanyMutation = useDeleteCompany();

  function handleDelete(id: string) {
    if (!window.confirm("¿Eliminar esta empresa?")) return;
    deleteCompanyMutation.mutate(id);
  }

  return (
    <div>
      <h1>Empresas</h1>
      {isAdmin ? <Link to="/companies/new">Nueva empresa</Link> : null}

      <div>
        <input
          type="search"
          placeholder="Buscar por nombre"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <input
          type="text"
          placeholder="Filtrar por industria"
          value={industry}
          onChange={(event) => {
            setIndustry(event.target.value);
            setPage(1);
          }}
        />
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
        <select
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value as SortOrder)}
        >
          <option value="desc">Descendente</option>
          <option value="asc">Ascendente</option>
        </select>
      </div>

      {companiesQuery.isLoading ? <p>Cargando…</p> : null}

      {companiesQuery.isError ? (
        <p role="alert">
          No pudimos cargar las empresas
          {companiesQuery.error instanceof Error ? `: ${companiesQuery.error.message}` : "."}
        </p>
      ) : null}

      {/* Reutiliza el estado de la propia mutation (TanStack Query) — sin
          duplicar el error en un useState local. */}
      {deleteCompanyMutation.isError ? (
        <p role="alert">
          No pudimos eliminar la empresa
          {deleteCompanyMutation.error instanceof Error
            ? `: ${deleteCompanyMutation.error.message}`
            : "."}
        </p>
      ) : null}

      {companiesQuery.isSuccess && companiesQuery.data.data.length === 0 ? (
        <p>No hay empresas para mostrar.</p>
      ) : null}

      {companiesQuery.isSuccess && companiesQuery.data.data.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Industria</th>
              <th>Dominio</th>
              {isAdmin ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {companiesQuery.data.data.map((company) => (
              <tr key={company.id}>
                <td>{company.name}</td>
                <td>{company.industry ?? ""}</td>
                <td>{company.domain ?? ""}</td>
                {isAdmin ? (
                  <td>
                    <Link to={`/companies/${company.id}/edit`}>Editar</Link>
                    <button type="button" onClick={() => handleDelete(company.id)}>
                      Eliminar
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {companiesQuery.isSuccess ? (
        <div>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </button>
          <span>
            Página {companiesQuery.data.pagination.page} de{" "}
            {companiesQuery.data.pagination.totalPages || 1}
          </span>
          <button
            type="button"
            disabled={page >= companiesQuery.data.pagination.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
