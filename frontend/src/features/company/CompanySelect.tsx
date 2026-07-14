import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { companyKeys, useCompanies, useCompany } from "./queries";

interface CompanySelectProps {
  id?: string;
  label: string;
  value: string | undefined;
  onChange: (companyId: string) => void;
}

const SEARCH_DEBOUNCE_MS = 300;

// Selector/filtro de Company con búsqueda server-side (GET /api/companies?search=...,
// ya real — ver company.repository.ts: contains sobre `name`, insensitive).
// Nunca precarga todas las Companies ni asume un máximo — funciona igual
// con 10 o con miles de Companies en la organización, porque solo trae
// resultados acotados por lo que el usuario efectivamente tipeó.
//
// Sin botón de "quitar" deliberadamente: limpiar la selección es una
// decisión de cada caller, no de este componente (ver ContactListPage para
// el filtro, que sí puede limpiarse libremente porque es estado local, y
// ContactFormPage, que NO ofrece esa opción porque el backend no soporta
// limpiar companyId a null vía PATCH — ver docs/project-overview.md).
export function CompanySelect({ id, label, value, onChange }: CompanySelectProps) {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedTerm(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [term]);

  // enabled: solo busca cuando hay término — nunca precarga un listado por
  // default. Sin esto, este componente dispararía un GET /api/companies
  // (aunque acotado a pageSize) apenas se monta, sin que el usuario haya
  // pedido nada todavía.
  const searchQuery = useCompanies(
    {
      search: debouncedTerm || undefined,
      pageSize: 20,
      sortBy: "name",
      sortOrder: "asc",
    },
    { enabled: debouncedTerm.length > 0 },
  );

  // list cache (companyKeys.list) y detail cache (companyKeys.detail) son
  // independientes en TanStack Query — no hay normalización automática de
  // entidades entre queryKeys distintas. Se siembra explícitamente
  // companyKeys.detail(id) con lo que ya trajo la búsqueda: si esa misma
  // Company hace falta resolver después (ej. useCompaniesByIds en
  // ContactListPage), useQuery la encuentra fresca y no repite el fetch —
  // comportamiento estándar de TanStack Query ante una queryKey ya
  // poblada, sin lógica adicional del lado que la consume.
  useEffect(() => {
    if (!searchQuery.data) return;
    for (const company of searchQuery.data.data) {
      queryClient.setQueryData(companyKeys.detail(company.id), company);
    }
  }, [searchQuery.data, queryClient]);

  const selectedCompanyQuery = useCompany(value);

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {value ? (
        <p>
          Seleccionada:{" "}
          {selectedCompanyQuery.data
            ? selectedCompanyQuery.data.name
            : selectedCompanyQuery.isLoading
              ? "Cargando…"
              : "No pudimos cargar la empresa seleccionada."}
        </p>
      ) : null}
      <input
        id={id}
        type="text"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Buscar empresa por nombre…"
      />
      {debouncedTerm ? (
        <ul>
          {searchQuery.isLoading ? <li>Buscando…</li> : null}
          {searchQuery.isError ? <li role="alert">No pudimos buscar empresas.</li> : null}
          {searchQuery.isSuccess && searchQuery.data.data.length === 0 ? (
            <li>Sin resultados.</li>
          ) : null}
          {searchQuery.isSuccess
            ? searchQuery.data.data.map((company) => (
                <li key={company.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(company.id);
                      setTerm("");
                    }}
                  >
                    {company.name}
                  </button>
                </li>
              ))
            : null}
        </ul>
      ) : null}
    </div>
  );
}
