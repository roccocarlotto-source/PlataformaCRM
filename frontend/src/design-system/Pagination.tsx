import { Button } from "./Button";

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
}

// R1.1 — consolida el bloque que las 8 ListPage tenían copiado-pegado casi
// idéntico (ver auditoría Post-M8, Parte 3). Mismo texto exacto
// ("Anterior"/"Página X de Y"/"Siguiente") y misma condición de
// deshabilitado (page<=1 / page>=totalPages, con totalPages||1 para el
// caso de 0 resultados) que ya usaba cada pantalla — los tests existentes
// que buscan estos botones por nombre siguen encontrándolos igual.
export function Pagination({ page, totalPages, onPrevious, onNext }: PaginationProps) {
  return (
    <div className="ds-pagination">
      <Button type="button" disabled={page <= 1} onClick={onPrevious}>
        Anterior
      </Button>
      <span>
        Página {page} de {totalPages || 1}
      </span>
      <Button type="button" disabled={page >= totalPages} onClick={onNext}>
        Siguiente
      </Button>
    </div>
  );
}
