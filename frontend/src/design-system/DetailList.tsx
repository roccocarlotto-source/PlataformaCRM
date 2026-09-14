import type { ReactNode } from "react";
import { EMPTY_VALUE } from "./detailFormat";

// ---------------------------------------------------------------------------
// Lista de pares rótulo/valor, en secciones, para mostrar un registro en solo
// lectura: el contenido del pop up "Ver detalle" de los listados
// (docs/frontend-cambios-pendientes.md §28). Es de presentación pura: los
// diez listados le pasan sus secciones ya resueltas (nombres en vez de ids,
// Badge para los enums, importes formateados) y acá solo se dibuja, así el
// layout es uno y no diez copias.
//
// Marcado: un <dl> por sección (<dt> rótulo, <dd> valor), con un <h3> encima
// cuando la sección tiene título —el formulario de Vehículo agrupa ~40 campos
// en tarjetas y el detalle respeta esos mismos grupos; las entidades chicas
// pasan una sola sección sin título—. La grilla de dos columnas la arma el
// CSS (.ds-detail-list, con display: contents en cada fila para que dt y dd
// entren directo en la grilla).
//
// VALOR VACÍO: null, undefined o "" se muestran como "—" acá, una sola vez,
// para que un dato que falta se vea igual en las diez pantallas y ningún
// consumidor tenga que repetir el fallback campo por campo. Un valor con
// contenido (incluido 0, o un ReactNode como un Badge) se muestra tal cual.
// ---------------------------------------------------------------------------

export interface DetailItem {
  label: ReactNode;
  value: ReactNode;
}

export interface DetailSection {
  heading?: string;
  items: DetailItem[];
}

export interface DetailListProps {
  sections: DetailSection[];
}

function isEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === "";
}

export function DetailList({ sections }: DetailListProps) {
  return (
    <div className="ds-detail">
      {sections.map((section, sectionIndex) => (
        // Índice como key: las secciones y los ítems son listas estáticas que
        // no se reordenan ni se filtran en vivo.
        <div key={sectionIndex} className="ds-detail-section">
          {section.heading ? <h3 className="ds-detail-heading">{section.heading}</h3> : null}
          <dl className="ds-detail-list">
            {section.items.map((item, itemIndex) => (
              <div key={itemIndex} className="ds-detail-row">
                <dt className="ds-detail-label">{item.label}</dt>
                <dd className="ds-detail-value">
                  {isEmpty(item.value) ? EMPTY_VALUE : item.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
