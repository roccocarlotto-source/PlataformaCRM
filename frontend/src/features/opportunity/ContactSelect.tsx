import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { contactKeys, useContact, useContacts } from "../contact/queries";
import { InlineLoading } from "../../design-system/LoadingState";
import { SearchSelect } from "../../design-system/SearchSelect";

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
    <SearchSelect
      id={id}
      label={label}
      placeholder="Buscar por nombre o email…"
      term={term}
      onTermChange={setTerm}
      open={debouncedTerm.length > 0}
      selected={
        value
          ? {
              prefix: "Seleccionado",
              content: selectedContactQuery.data ? (
                `${selectedContactQuery.data.firstName} ${selectedContactQuery.data.lastName}`
              ) : selectedContactQuery.isLoading ? (
                <InlineLoading />
              ) : (
                "No pudimos cargar el contacto seleccionado."
              ),
            }
          : null
      }
      loading={searchQuery.isLoading}
      error={searchQuery.isError ? "No pudimos buscar contactos." : null}
      results={searchQuery.isSuccess ? searchQuery.data.data : undefined}
      getKey={(contact) => contact.id}
      renderItem={(contact) => `${contact.firstName} ${contact.lastName}`}
      onSelect={(contact) => {
        onChange(contact.id);
        setTerm("");
      }}
    />
  );
}
