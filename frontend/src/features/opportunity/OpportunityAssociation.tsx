// "Asociado" de una oportunidad: a qué Empresa y/o Contacto está vinculada.
// Antes vivía inline en la columna Asociado de OpportunityListPage; se
// extrae porque la tarjeta del embudo (OpportunityBoardView) muestra el
// mismo dato con el mismo criterio, y ese criterio no es trivial:
//
// Empresa y Contacto son independientes en el backend y pueden coexistir;
// el diseño solo muestra uno pero acá no se descarta ninguno: con ambos,
// dos líneas apiladas; con uno, ese; sin ninguno, "—". Un id que no se pudo
// resolver muestra "—" en su línea, nunca el UUID.

interface OpportunityAssociationProps {
  // null = la oportunidad no tiene ese vínculo. "—" = lo tiene pero no se
  // pudo resolver el nombre. Quien llama ya hizo esa distinción con los
  // mapas de relationResolution.ts.
  companyName: string | null;
  contactName: string | null;
}

// Íconos (edificio = empresa, persona = contacto). Son puramente cosméticos
// —el nombre al lado es el dato—, por eso van aria-hidden y viven acá y no
// en design-system/: único consumidor.
function BuildingIcon() {
  return (
    <svg className="ds-cell-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 14V3.5A1.5 1.5 0 0 1 4.5 2h4A1.5 1.5 0 0 1 10 3.5V14M10 6h2.5A1.5 1.5 0 0 1 14 7.5V14M2 14h13M5.5 5h2M5.5 8h2M5.5 11h2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg className="ds-cell-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="5" r="2.75" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2.75 14a5.25 5.25 0 0 1 10.5 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function OpportunityAssociation({ companyName, contactName }: OpportunityAssociationProps) {
  if (companyName === null && contactName === null) {
    return <>—</>;
  }
  return (
    <span className="ds-cell-stack">
      {companyName !== null ? (
        <span className="ds-cell-with-icon">
          <BuildingIcon />
          <span>{companyName}</span>
        </span>
      ) : null}
      {contactName !== null ? (
        <span className="ds-cell-with-icon">
          <PersonIcon />
          <span>{contactName}</span>
        </span>
      ) : null}
    </span>
  );
}
