import { useState } from "react";

// ---------------------------------------------------------------------------
// Selección múltiple de elementos para una acción en lote — el patrón "galería
// de un celular" del ítem 64 de docs/frontend-cambios-pendientes.md: casillas
// para marcar varios y una sola acción que los borra a todos.
//
// LO ÚNICO QUE NO ES OBVIO ACÁ: la selección se DERIVA contra los ids que hoy
// están a la vista, en vez de guardarse tal cual. El estado interno es el
// conjunto de ids que el usuario marcó; `selectedIds` es ese conjunto
// intersecado con `visibleIds`, en el orden de la lista.
//
// Eso resuelve solo los dos casos molestos, sin un useEffect que sincronice
// nada:
//
//   - una foto que se borró (o una fila que ya no entra en el filtro) deja de
//     contar apenas desaparece de la lista, aunque su id siga en el conjunto;
//   - la lista entera cambia de identidad (recarga de la ficha, otra página de
//     resultados) y la barra de acciones se apaga sola.
//
// Los consumidores igual llaman a `clear()` cuando la navegación es explícita
// (cambiar de página o de filtro): ahí el usuario dejó atrás lo que había
// marcado a propósito, y volver a esa página con todo todavía tildado
// sorprendería.
// ---------------------------------------------------------------------------

export interface BulkSelection {
  // Ids marcados Y visibles, en el orden en que aparecen en la lista.
  selectedIds: string[];
  isSelected: (id: string) => boolean;
  // Para la casilla del encabezado de una tabla: todas las visibles marcadas,
  // o solo algunas (estado indeterminado).
  allSelected: boolean;
  someSelected: boolean;
  toggle: (id: string) => void;
  // Marca o desmarca de una vez todo lo que está a la vista.
  toggleAll: (selected: boolean) => void;
  // Reemplaza la selección entera. Lo usa el borrado en lote para dejar
  // marcadas solo las que fallaron.
  select: (ids: string[]) => void;
  clear: () => void;
}

export function useBulkSelection(visibleIds: string[]): BulkSelection {
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => new Set<string>());

  const selectedIds = visibleIds.filter((id) => marked.has(id));
  const selected = new Set(selectedIds);

  return {
    selectedIds,
    isSelected: (id) => selected.has(id),
    allSelected: visibleIds.length > 0 && selectedIds.length === visibleIds.length,
    someSelected: selectedIds.length > 0 && selectedIds.length < visibleIds.length,
    toggle: (id) =>
      setMarked((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    toggleAll: (value) =>
      setMarked((current) => {
        const next = new Set(current);
        for (const id of visibleIds) {
          if (value) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
    select: (ids) => setMarked(new Set(ids)),
    clear: () => setMarked(new Set<string>()),
  };
}
