import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { matchesSearch } from "./searchText";

// ---------------------------------------------------------------------------
// Selector de un solo valor con buscador (combobox): un control con aspecto
// de input que, al tomar el foco o recibir un click, despliega un panel
// flotante con las opciones y se puede tipear para filtrarlas. Reemplaza al
// <select> nativo en los selectores compartidos (Fase 1: UserSelect y
// BranchSelect; docs/frontend-cambios-pendientes.md §44). No confundir con
// MultiSelect, que elige varios valores con checkboxes.
//
// POR QUÉ EXISTE: el popup del <select> nativo no se puede estilar (ni filtrar,
// ni mostrar una segunda línea) y en modo oscuro hizo falta un parche (PR #236)
// para que sus opciones fueran legibles. Una lista de 30 usuarios sin buscador
// obliga a scrollear; con el email como subtítulo, además, se distinguen dos
// homónimos.
//
// MARKUP: raíz div > label[for] + input, el mismo patrón que MultiSelect,
// BranchSelect y CompanySelect, así la píldora de .ds-filters (div:has(>
// label[for]) en design-system.css) lo detecta sola. El panel es un hermano
// posicionado (absolute) y es un <div>, no un <ul>/<p>: la píldora baja esos
// a su propia línea y le cambiaría el alto a la fila al abrirse.
//
// SE CIERRA sin cambiar el valor con Escape, con un click afuera (pointerdown
// en document, solo mientras está abierto, igual que MultiSelect) y al perder
// el foco (Tab). Con el panel cerrado sus opciones no están en el DOM. Elegir
// (Enter o click) también cierra. En los tres cierres sin elección el input
// vuelve a mostrar el rótulo de lo ya elegido: nunca queda con una búsqueda
// a medio escribir que parezca un valor.
//
// EL FOCO NUNCA SALE DEL INPUT mientras se navega: las opciones no son
// focuseables y el resaltado se comunica con aria-activedescendant (patrón
// combobox de WAI-ARIA 1.2). Por eso el panel cancela el mousedown: sin eso,
// clickear una opción le sacaría el foco al input, el blur cerraría el panel
// y el click aterrizaría en una opción que ya no existe.
//
// EL VALOR es controlado por el consumidor; lo que se tipea es estado local
// (`query`) y no toca `value` hasta que se elige una opción. El input muestra
// `query` mientras está abierto y el rótulo de la opción elegida cerrado.
// ---------------------------------------------------------------------------

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  // Segunda línea, en --color-text-muted. Ausente en selects sin ese dato
  // (sucursal, pipeline...). Presente en selects de persona (nombre + email).
  subtitle?: string;
}

export interface SelectProps<T extends string> {
  id?: string;
  label: string;
  options: SelectOption<T>[];
  // "" y undefined son "sin valor", igual que la <option value=""> de un
  // <select>. Por eso value y onChange admiten "" aunque T no lo incluya: es
  // lo que produce elegir la fila de emptyOption.
  value: T | "" | undefined;
  onChange: (value: T | "") => void;
  // Fila especial sin subtítulo, siempre primera en la lista si está presente
  // (mismo rol que la <option value=""> vacía de hoy: "Sin asignar", "Elegir
  // sucursal…"). value "" para esa fila. Con el panel cerrado y sin valor, su
  // texto es el placeholder del input: se lee igual que la opción vacía de un
  // <select>, pero el input queda vacío y `required` sigue bloqueando el
  // submit como con el <select>.
  emptyOption?: { label: string };
  // "*" de .ds-required en el rótulo Y `required` en el input, siempre juntos
  // (mismo contrato que BranchSelect/PipelineSelect).
  required?: boolean;
  disabled?: boolean;
  // El rótulo existe pero no se ve: se oculta con .ds-sr-only, la misma
  // utilidad que ya usan los buscadores de los listados. Para los selectores
  // que viven dentro de una celda de tabla, donde la columna YA dice qué es
  // (§46: el rol de cada fila en UserListPage) y un rótulo por fila sería
  // ruido. El nombre accesible NO cambia: el <label> sigue en el DOM y sigue
  // asociado por for/id, así que getByLabelText y los lectores de pantalla lo
  // ven igual — por eso se oculta en vez de no renderizarlo.
  labelHidden?: boolean;
}

interface Row<T extends string> {
  value: T | "";
  label: string;
  subtitle?: string;
}

export function Select<T extends string>({
  id,
  label,
  options,
  value,
  onChange,
  emptyOption,
  required = false,
  disabled = false,
  labelHidden = false,
}: SelectProps<T>) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelId = `${inputId}-label`;
  const listboxId = `${inputId}-listbox`;
  const optionId = (index: number) => `${inputId}-option-${index}`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentValue = value ?? "";
  const allRows: Row<T>[] = emptyOption
    ? [{ value: "", label: emptyOption.label }, ...options]
    : options;
  // La fila vacía también se filtra: si siempre quedara, "Sin resultados."
  // no aparecería nunca en un selector con emptyOption.
  const rows = allRows.filter((row) => matchesSearch(query, [row.label, row.subtitle]));
  // Si las opciones cambian con el panel abierto (una query que se resuelve),
  // un índice viejo puede quedar fuera de rango: se trata como "ninguno".
  const active = activeIndex < rows.length ? activeIndex : -1;
  const selectedLabel = options.find((option) => option.value === currentValue)?.label ?? "";

  function openPanel() {
    if (open || disabled) return;
    setOpen(true);
    setQuery("");
    // Al abrir se resalta lo ya elegido (flecha abajo sigue desde ahí, como en
    // un <select>) o, sin elección, la primera fila.
    const selectedIndex = allRows.findIndex((row) => row.value === currentValue);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : allRows.length > 0 ? 0 : -1);
  }

  function close() {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }

  function choose(row: Row<T>) {
    // Como el onChange de un <select>: solo si el valor cambia.
    if (row.value !== currentValue) onChange(row.value);
    close();
    inputRef.current?.focus();
  }

  // Click afuera: mismo criterio que MultiSelect (pointerdown, solo abierto).
  // El blur ya cierra cuando el foco se va, pero un pointerdown sobre algo no
  // focuseable no siempre lo mueve; esto cubre ese caso sin depender de él.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setQuery("");
      setActiveIndex(-1);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // La fila resaltada con flechas se mantiene a la vista si la lista scrollea.
  // scrollIntoView es opcional porque jsdom no lo implementa.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${inputId}-option-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, inputId]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) {
          openPanel();
          return;
        }
        if (rows.length === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        const from = active < 0 ? (step === 1 ? -1 : rows.length) : active;
        setActiveIndex(Math.min(rows.length - 1, Math.max(0, from + step)));
        return;
      }
      case "Enter":
        // Cerrado, Enter se comporta como en cualquier input (envía el form).
        // Abierto, nunca envía: elige la fila resaltada o no hace nada.
        if (!open) return;
        event.preventDefault();
        if (active >= 0) choose(rows[active]);
        return;
      case "Escape":
        if (!open) return;
        event.preventDefault();
        // Que el Escape que cierra el panel no cierre también un Modal
        // descartable que lo contenga (escucha keydown en document).
        event.stopPropagation();
        close();
        return;
    }
  }

  return (
    <div ref={rootRef} className="ds-select">
      <label id={labelId} htmlFor={inputId} className={labelHidden ? "ds-sr-only" : undefined}>
        {required ? <span className="ds-required">{label}</span> : label}
      </label>
      {/*
        ACCESIBILIDAD: el rótulo se asocia por label[for] y, a diferencia del
        botón de MultiSelect, no hace falta aria-labelledby para anunciar el
        valor: un input anuncia su contenido, que cerrado es el rótulo de la
        opción elegida. role="combobox" + aria-autocomplete="list": el texto
        tipeado filtra una lista, no se autocompleta en el input.
        aria-expanded dice si el panel está abierto; aria-controls y
        aria-activedescendant solo existen mientras está abierto, porque
        apuntan a nodos que cerrado no están en el DOM. autoComplete="off"
        para que el navegador no superponga su propio desplegable de
        sugerencias al nuestro.
      */}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        className="ds-select-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        value={open ? query : selectedLabel}
        // Abierto y sin tipear, el placeholder recuerda lo que está elegido
        // (el input se vació para buscar); cerrado y sin valor, es la fila
        // vacía, como la <option value=""> de un <select>.
        placeholder={open ? selectedLabel || emptyOption?.label : emptyOption?.label}
        required={required}
        disabled={disabled}
        onFocus={openPanel}
        // El foco puede seguir en el input con el panel cerrado (después de
        // elegir o de Escape): el click lo vuelve a abrir.
        onClick={openPanel}
        onBlur={close}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setOpen(true);
          // Tipear resalta la primera coincidencia: Enter la elige directo.
          const matches = allRows.filter((row) =>
            matchesSearch(nextQuery, [row.label, row.subtitle]),
          );
          setActiveIndex(matches.length > 0 ? 0 : -1);
        }}
        onKeyDown={handleKeyDown}
      />
      {open ? (
        // Ver EL FOCO NUNCA SALE DEL INPUT arriba: el mousedown se cancela en
        // todo el panel (opciones, "Sin resultados." y la barra de scroll).
        <div className="ds-select-menu" onMouseDown={(event) => event.preventDefault()}>
          {/*
            role="listbox" con el mismo rótulo que el input. Cada fila es
            role="option" con aria-selected en la que coincide con el valor
            (la del check), no en la resaltada: el resaltado ya lo anuncia
            aria-activedescendant. El nombre accesible de la fila es solo su
            rótulo (aria-labelledby) y el subtítulo va como descripción
            (aria-describedby): sin eso el nombre sería "Ana Pérezana@…",
            pegados, porque los dos <span> son inline.
          */}
          <div id={listboxId} role="listbox" aria-labelledby={labelId}>
            {rows.map((row, index) => {
              const selected = row.value === currentValue;
              const className = [
                "ds-select-option",
                index === active ? "ds-select-option-active" : "",
                selected ? "ds-select-option-selected" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={row.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  aria-labelledby={`${optionId(index)}-label`}
                  aria-describedby={row.subtitle ? `${optionId(index)}-subtitle` : undefined}
                  className={className}
                  // onMouseMove y no onMouseEnter: si la lista scrollea con
                  // flechas bajo un mouse quieto, el resaltado no salta a la
                  // fila que quedó debajo del puntero.
                  onMouseMove={() => {
                    if (index !== active) setActiveIndex(index);
                  }}
                  onClick={() => choose(row)}
                >
                  <span className="ds-select-option-text">
                    <span id={`${optionId(index)}-label`}>{row.label}</span>
                    {row.subtitle ? (
                      <span
                        id={`${optionId(index)}-subtitle`}
                        className="ds-select-option-subtitle"
                      >
                        {row.subtitle}
                      </span>
                    ) : null}
                  </span>
                  {selected ? (
                    <Check
                      className="ds-select-check"
                      size={16}
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          {/* Texto simple, fuera del listbox (no es una opción ni se puede
              elegir), mismo criterio que el "Sin resultados." de CompanySelect. */}
          {rows.length === 0 ? <div className="ds-select-empty">Sin resultados.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
