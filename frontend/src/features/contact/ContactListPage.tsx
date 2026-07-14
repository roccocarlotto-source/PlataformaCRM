import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { CompanySelect } from "../company/CompanySelect";
import { useCompaniesByIds } from "./companyResolution";
import { useDeleteContact } from "./mutations";
import { useContacts } from "./queries";
import type { ContactSortBy, LifecycleStage, SortOrder } from "./types";

const PAGE_SIZE = 20;
const LIFECYCLE_STAGES: LifecycleStage[] = ["LEAD", "MQL", "SQL", "CUSTOMER", "CHURNED"];

export function ContactListPage() {
  const { me } = useAuth();
  // Ocultar acciones de escritura para no-ADMIN es cortesía de UX: la
  // autorización real la sigue aplicando authorize("ADMIN") en el backend.
  const isAdmin = me?.role === "ADMIN";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [lifecycleStage, setLifecycleStage] = useState<LifecycleStage | "">("");
  const [companyId, setCompanyId] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<ContactSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const contactsQuery = useContacts({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    lifecycleStage: lifecycleStage || undefined,
    companyId,
    sortBy,
    sortOrder,
  });

  // Solo los companyId de los Contacts visibles en esta página — nunca
  // "todas las Companies". Deduplicado dentro de useCompaniesByIds.
  const visibleCompanyIds = useMemo(() => {
    if (!contactsQuery.data) return [];
    return contactsQuery.data.data
      .map((contact) => contact.companyId)
      .filter((id): id is string => id !== null);
  }, [contactsQuery.data]);

  const companyResolution = useCompaniesByIds(visibleCompanyIds);

  const deleteContactMutation = useDeleteContact();

  function handleDelete(id: string) {
    if (!window.confirm("¿Eliminar este contacto?")) return;
    deleteContactMutation.mutate(id);
  }

  return (
    <div>
      <h1>Contactos</h1>
      {isAdmin ? <Link to="/contacts/new">Nuevo contacto</Link> : null}

      <div>
        <input
          type="search"
          placeholder="Buscar por nombre o email"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <label>
          Etapa
          <select
            value={lifecycleStage}
            onChange={(event) => {
              setLifecycleStage(event.target.value as LifecycleStage | "");
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {LIFECYCLE_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>
        <div>
          <CompanySelect
            id="contact-filter-company"
            label="Filtrar por empresa"
            value={companyId}
            onChange={(id) => {
              setCompanyId(id);
              setPage(1);
            }}
          />
          {/* Limpiar el filtro es seguro acá: es estado local del listado,
              sin ninguna implicancia de "limpiar a null" contra el backend
              (a diferencia de ContactFormPage). */}
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
        <label>
          Ordenar por
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as ContactSortBy)}
          >
            <option value="createdAt">Fecha de creación</option>
            <option value="firstName">Nombre</option>
            <option value="lastName">Apellido</option>
            <option value="lifecycleStage">Etapa</option>
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

      {contactsQuery.isLoading ? <p>Cargando…</p> : null}

      {contactsQuery.isError ? (
        <p role="alert">
          No pudimos cargar los contactos
          {contactsQuery.error instanceof Error ? `: ${contactsQuery.error.message}` : "."}
        </p>
      ) : null}

      {deleteContactMutation.isError ? (
        <p role="alert">
          No pudimos eliminar el contacto
          {deleteContactMutation.error instanceof Error
            ? `: ${deleteContactMutation.error.message}`
            : "."}
        </p>
      ) : null}

      {contactsQuery.isSuccess && contactsQuery.data.data.length === 0 ? (
        <p>No hay contactos para mostrar.</p>
      ) : null}

      {contactsQuery.isSuccess && contactsQuery.data.data.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Etapa</th>
              <th>Empresa</th>
              {isAdmin ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {contactsQuery.data.data.map((contact) => (
              <tr key={contact.id}>
                <td>
                  {contact.firstName} {contact.lastName}
                </td>
                <td>{contact.email ?? ""}</td>
                <td>{contact.lifecycleStage}</td>
                <td>
                  {contact.companyId
                    ? (companyResolution.byId.get(contact.companyId)?.name ?? "—")
                    : ""}
                </td>
                {isAdmin ? (
                  <td>
                    <Link to={`/contacts/${contact.id}/edit`}>Editar</Link>
                    <button type="button" onClick={() => handleDelete(contact.id)}>
                      Eliminar
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {contactsQuery.isSuccess ? (
        <div>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </button>
          <span>
            Página {contactsQuery.data.pagination.page} de{" "}
            {contactsQuery.data.pagination.totalPages || 1}
          </span>
          <button
            type="button"
            disabled={page >= contactsQuery.data.pagination.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
