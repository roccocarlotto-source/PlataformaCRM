import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { InlineLoading } from "./LoadingState";

export interface SearchSelectSelected {
  /** "Seleccionada" / "Seleccionado", según el género de la entidad. */
  prefix: string;
  content: ReactNode;
  /** Una acción sobre la selección ("Quitar vínculo"), al lado del valor. */
  action?: ReactNode;
}

export interface SearchSelectProps<T> {
  id?: string;
  label: string;
  placeholder: string;
  /** Lo que el usuario tipeó: el estado vive en el selector de cada entidad,
   *  que es el que hace la búsqueda con debounce. */
  term: string;
  onTermChange: (term: string) => void;
  /** Si se muestra el panel de resultados (hay un término ya debounceado). */
  open: boolean;
  /** El valor elegido, o null si no hay. */
  selected: SearchSelectSelected | null;
  loading: boolean;
  /** Mensaje si la búsqueda falló. */
  error: string | null;
  /** undefined mientras no hay respuesta; [] es "sin resultados". */
  results: readonly T[] | undefined;
  emptyText?: string;
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  /** Presentación de filtro: con valor elegido, la selección se muestra en
   *  la misma línea que el rótulo, con una ✕ para quitarla, en vez del
   *  "Seleccionada: …" arriba del input. Sin esto (formularios) no cambia
   *  nada. */
  onClear?: () => void;
  /** Nombre accesible de la ✕ ("Quitar filtro de empresa"). */
  clearLabel?: string;
}

// Selector con búsqueda del lado del servidor — la parte VISUAL que
// compartían, copiada, CompanySelect, ContactSelect, OpportunitySelect y
// VehicleSelect: rótulo, "Seleccionada: …", el input y la lista de
// resultados. La búsqueda (debounce, query, cache) sigue siendo de cada uno,
// porque cada entidad tiene su endpoint y sus reglas.
//
// Hasta acá el markup era <ul><li><button> sin clases, y solo dentro de la
// barra de filtros tenía estilo: en un formulario los resultados salían como
// una lista con viñetas de botones nativos. Ahora el panel de resultados se
// ve como el de Select (.ds-select-menu) en cualquier contexto.
//
// La estructura es la misma de antes a propósito (div > label[for] + input,
// resultados como botones): la píldora de .ds-filters la sigue detectando sin
// cambios, y elegir un resultado sigue siendo un click en un botón con el
// nombre de la entidad.
export function SearchSelect<T>({
  id,
  label,
  placeholder,
  term,
  onTermChange,
  open,
  selected,
  loading,
  error,
  results,
  emptyText = "Sin resultados.",
  getKey,
  renderItem,
  onSelect,
  onClear,
  clearLabel,
}: SearchSelectProps<T>) {
  const labelId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // Al quitar con la ✕, el botón desaparece: el foco pasa al input que lo
  // reemplaza, listo para buscar otro valor, en vez de caer en <body>.
  const focusInputRef = useRef(false);
  useEffect(() => {
    if (focusInputRef.current && !selected) {
      focusInputRef.current = false;
      inputRef.current?.focus();
    }
  });

  // En la barra de filtros cada control es una píldora de UNA línea (rótulo +
  // valor). El "Seleccionada: …" encima del input la volvía de dos o tres
  // líneas, con el botón de quitar debajo. Acá el valor ocupa el lugar del
  // input y la ✕ lo vacía; para cambiar de valor se quita y se busca otro.
  // Sin input no hay label[for]: el rótulo nombra al grupo.
  if (onClear && selected) {
    return (
      <div
        className="ds-search-select ds-search-select--value"
        role="group"
        aria-labelledby={labelId}
      >
        <span id={labelId} className="ds-search-select-label">
          {label}
        </span>
        <span className="ds-search-select-value">
          <span className="ds-sr-only">{selected.prefix}: </span>
          {selected.content}
        </span>
        <button
          type="button"
          className="ds-search-select-clear"
          aria-label={clearLabel ?? `Quitar ${label.toLowerCase()}`}
          onClick={() => {
            focusInputRef.current = true;
            onClear();
          }}
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="ds-search-select">
      <label htmlFor={id}>{label}</label>
      {selected ? (
        <p className="ds-search-select-selected">
          {selected.prefix}: {selected.content}
          {selected.action ? <> {selected.action}</> : null}
        </p>
      ) : null}
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={term}
        onChange={(event) => onTermChange(event.target.value)}
        placeholder={placeholder}
      />
      {open ? (
        <ul className="ds-search-select-results">
          {loading ? (
            <li className="ds-select-empty">
              <InlineLoading>Buscando…</InlineLoading>
            </li>
          ) : null}
          {error ? (
            <li className="ds-select-empty ds-search-select-error" role="alert">
              {error}
            </li>
          ) : null}
          {results && results.length === 0 ? (
            <li className="ds-select-empty">{emptyText}</li>
          ) : null}
          {results
            ? results.map((item) => (
                <li key={getKey(item)}>
                  <button
                    type="button"
                    className="ds-select-option ds-search-select-option"
                    onClick={() => onSelect(item)}
                  >
                    {renderItem(item)}
                  </button>
                </li>
              ))
            : null}
        </ul>
      ) : null}
    </div>
  );
}
