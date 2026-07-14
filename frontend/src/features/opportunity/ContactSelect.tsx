import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { contactKeys, useContact, useContacts } from "../contact/queries";

interface ContactSelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  onChange: (contactId: string) => void;
}

const SEARCH_DEBOUNCE_MS = 300;

// Selector de Contact para Opportunity — búsqueda server-side por texto
// (GET /api/contacts?search=..., cubre firstName/lastName/email vía OR, ver
// contact.repository.ts). Mismo patrón que CompanySelect (M2): nunca
// precarga un listado por default, solo busca cuando hay término
// (enabled: debouncedTerm.length > 0).
//
// Deliberadamente SIN companyId como prop: el backend no exige que un
// Contact pertenezca a la Company seleccionada en la misma Opportunity
// (validateCompanyId/validateContactId en opportunity.service.ts son
// completamente independientes, cada una valida su propio id contra la
// organización sin cruzarlas entre sí). GET /api/contacts?companyId=X es un
// filtro EXCLUYENTE real (contact.repository.ts buildWhere, AND implícito),
// no existe ningún parámetro de ranking/bias en el contrato — pasar
// companyId acá excluiría combinaciones válidas (Company A + Contact de
// Company B, o sin Company), así que no se usa.
export function ContactSelect({ id, label, value, onChange }: ContactSelectProps) {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedTerm(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [term]);

  const searchQuery = useContacts(
    {
      search: debouncedTerm || undefined,
      pageSize: 20,
      sortBy: "firstName",
      sortOrder: "asc",
    },
    { enabled: debouncedTerm.length > 0 },
  );

  // Siembra contactKeys.detail(id) con los resultados de la búsqueda —
  // mismo criterio que CompanySelect con companyKeys.detail: si ese mismo
  // Contact hace falta resolver después (ej. useContactNames en
  // OpportunityListPage), useQuery lo encuentra fresco sin repetir el fetch.
  useEffect(() => {
    if (!searchQuery.data) return;
    for (const contact of searchQuery.data.data) {
      queryClient.setQueryData(contactKeys.detail(contact.id), contact);
    }
  }, [searchQuery.data, queryClient]);

  const selectedContactQuery = useContact(value);

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {value ? (
        <p>
          Seleccionado:{" "}
          {selectedContactQuery.data
            ? `${selectedContactQuery.data.firstName} ${selectedContactQuery.data.lastName}`
            : selectedContactQuery.isLoading
              ? "Cargando…"
              : "No pudimos cargar el contacto seleccionado."}
        </p>
      ) : null}
      <input
        id={id}
        type="text"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Buscar contacto por nombre o email…"
      />
      {debouncedTerm ? (
        <ul>
          {searchQuery.isLoading ? <li>Buscando…</li> : null}
          {searchQuery.isError ? <li role="alert">No pudimos buscar contactos.</li> : null}
          {searchQuery.isSuccess && searchQuery.data.data.length === 0 ? (
            <li>Sin resultados.</li>
          ) : null}
          {searchQuery.isSuccess
            ? searchQuery.data.data.map((contact) => (
                <li key={contact.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(contact.id);
                      setTerm("");
                    }}
                  >
                    {contact.firstName} {contact.lastName}
                  </button>
                </li>
              ))
            : null}
        </ul>
      ) : null}
    </div>
  );
}
