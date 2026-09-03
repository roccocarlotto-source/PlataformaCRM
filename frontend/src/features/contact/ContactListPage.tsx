import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Avatar } from "../../design-system/Avatar";
import { Badge, type BadgeVariant } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Pagination } from "../../design-system/Pagination";
import { Table } from "../../design-system/Table";
import { CompanySelect } from "../company/CompanySelect";
import { useOwnerNames } from "../opportunity/relationResolution";
import { useCompaniesByIds } from "./companyResolution";
import { useDeleteContact } from "./mutations";
import { useContacts } from "./queries";
import type { ContactSortBy, LifecycleStage, SortOrder } from "./types";

const PAGE_SIZE = 20;
const LIFECYCLE_STAGES: LifecycleStage[] = ["LEAD", "MQL", "SQL", "CUSTOMER", "CHURNED"];

// Mapeo cerrado decidido en la Fase 1 del rediseño (ver design-system/Badge.tsx):
// lifecycleStage es un enum fijo sin campo de color en el schema, así que el
// color lo decide este consumidor y no el componente.
const LIFECYCLE_BADGE_VARIANT: Record<LifecycleStage, BadgeVariant> = {
  LEAD: "neutral",
  MQL: "neutral",
  SQL: "info",
  CUSTOMER: "success",
  CHURNED: "danger",
};

export function ContactListPage() {
  const { me } = useAuth();
  // Ocultar acciones de escritura para no-ADMIN es cortesía de UX: la
  // autorización real la sigue aplicando authorize("ADMIN") en el backend.
  //
  // La columna Propietario usa este MISMO booleano, y ahí no es solo cortesía:
  // resolver un ownerId a nombre necesita GET /api/users, que es ADMIN-only.
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

  const deleteContactMutation = useDeleteContact();

  function handleDelete(id: string) {
    if (!window.confirm("¿Eliminar este contacto?")) return;
    deleteContactMutation.mutate(id);
  }

  return (
    <div>
      <div className="ds-page-header">
        <h1>Contactos</h1>
        {isAdmin ? (
          <Link to="/contacts/new" className="ds-link-button">
            Nuevo contacto
          </Link>
        ) : null}
      </div>

      {/* Filtros inline, mismo patrón que CompanyListPage. El diseño los
          colapsa detrás de un botón "Filtrar"; ese panel es un patrón de
          interacción nuevo que no existe en ningún módulo y queda fuera de
          esta migración a propósito. */}
      <div className="ds-filters">
        <label>
          Buscar
          <input
            type="search"
            placeholder="Buscar por nombre o email"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
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
            <Button
              onClick={() => {
                setCompanyId(undefined);
                setPage(1);
              }}
            >
              Quitar filtro de empresa
            </Button>
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

      {contactsQuery.isLoading ? <LoadingState /> : null}

      {contactsQuery.isError ? (
        <ErrorState>
          No pudimos cargar los contactos
          {contactsQuery.error instanceof Error ? `: ${contactsQuery.error.message}` : "."}
        </ErrorState>
      ) : null}

      {deleteContactMutation.isError ? (
        <ErrorState>
          No pudimos eliminar el contacto
          {deleteContactMutation.error instanceof Error
            ? `: ${deleteContactMutation.error.message}`
            : "."}
        </ErrorState>
      ) : null}

      {contactsQuery.isSuccess && contactsQuery.data.data.length === 0 ? (
        <EmptyState>No hay contactos para mostrar.</EmptyState>
      ) : null}

      {/* Columnas en el orden de la pantalla "Contactos" del diseño. Teléfono
          y Origen ya existían en Contact y en el formulario; solo faltaban en
          el listado. Los tests ubican celdas por el texto de su <th>, no por
          índice, así que reordenar no los rompe. */}
      {contactsQuery.isSuccess && contactsQuery.data.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Empresa</th>
              <th>Email</th>
              <th>Teléfono</th>
              <th>Etapa</th>
              <th>Origen</th>
              {isAdmin ? <th>Propietario</th> : null}
              {isAdmin ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {contactsQuery.data.data.map((contact) => {
              const fullName = `${contact.firstName} ${contact.lastName}`;
              // ownerId es nullable acá (a diferencia de Opportunity), así
              // que el guard no es defensivo de más: sin él, un owner sin
              // asignar entraría a byId.get(null). Sin dueño y dueño que no
              // se pudo resolver muestran lo mismo — "—" —, y es correcto:
              // para quien lee la tabla, las dos cosas son "no hay nombre
              // que mostrar acá". Y sin nombre no hay avatar: un círculo
              // con "—" adentro no representa a nadie.
              const ownerName = contact.ownerId
                ? (ownerNames.byId.get(contact.ownerId) ?? null)
                : null;
              return (
                <tr key={contact.id}>
                  <td>
                    {/* decorative: el nombre completo ya está al lado, el
                        avatar no tiene que anunciarse dos veces. */}
                    <span className="ds-person">
                      <Avatar name={fullName} size="sm" decorative />
                      <span>{fullName}</span>
                    </span>
                  </td>
                  <td>
                    {contact.companyId
                      ? (companyResolution.byId.get(contact.companyId)?.name ?? "—")
                      : ""}
                  </td>
                  <td>{contact.email ?? ""}</td>
                  <td>{contact.phone ?? ""}</td>
                  <td>
                    <Badge variant={LIFECYCLE_BADGE_VARIANT[contact.lifecycleStage]}>
                      {contact.lifecycleStage}
                    </Badge>
                  </td>
                  <td>{contact.source ?? ""}</td>
                  {isAdmin ? (
                    <td>
                      {ownerName ? (
                        <span className="ds-person">
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
                      <Link to={`/contacts/${contact.id}/edit`}>Editar</Link>{" "}
                      <Button variant="danger" onClick={() => handleDelete(contact.id)}>
                        Eliminar
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : null}

      {contactsQuery.isSuccess ? (
        <Pagination
          page={page}
          totalPages={contactsQuery.data.pagination.totalPages}
          onPrevious={() => setPage((current) => current - 1)}
          onNext={() => setPage((current) => current + 1)}
        />
      ) : null}
    </div>
  );
}
