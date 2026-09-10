import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MoreVertical } from "lucide-react";
import { Link } from "react-router-dom";

// ---------------------------------------------------------------------------
// Menú de acciones de una fila de tabla: un botón de "3 puntos" (kebab) que
// al abrirse despliega la lista de acciones de esa fila (Editar, Eliminar,
// Ver claves…). Es un primitivo de UI —trigger + menú— y por eso vive acá y
// no en el feature que lo estrenó, igual que Modal y MultiSelect.
//
// POR QUÉ EXISTE: cada listado resolvía la columna "Acciones" a su manera
// —links de texto en unos, Button dentro de .ds-row-actions en otros— y la
// columna se veía distinta en cada pantalla (docs/frontend-cambios-pendientes.md
// §8). Con 2 o más acciones por fila, agruparlas detrás de un solo botón
// deja la columna uniforme y angosta. Con UNA sola acción no se usa: un menú
// de un ítem no aporta nada y suma un clic (decisión explícita de §8).
//
// SE CIERRA con Escape, con un click afuera y al elegir una acción (salvo
// `keepOpen`, ver abajo), al revés que Modal. Ahí un cierre accidental podía
// ser irreversible (el secreto de una API key); acá no se pierde nada al
// cerrar. Es el mismo patrón de apertura/cierre que MultiSelect. Con el menú
// cerrado sus ítems no están en el DOM: no hay nada que ocultar con CSS ni
// que sacar del orden de tabulación.
//
// POSICIÓN: el menú abierto es position: fixed, ubicado desde el rectángulo
// del trigger al abrirse, y NO position: absolute como la lista de
// MultiSelect. La razón es Table.tsx: la tabla vive dentro de .ds-table-wrap
// con overflow-x: auto, y un overflow no-visible en un eje vuelve `auto` al
// otro, así que un menú absoluto colgando de la última fila quedaría
// recortado por el borde de la tarjeta (o le agregaría un scroll vertical).
// Un elemento fixed no lo recorta ningún overflow de sus ancestros —solo un
// transform, y el design system no usa ninguno—. El costo es que si la
// página scrollea con el menú abierto el trigger se mueve y el menú no, así
// que el menú se cierra al primer scroll o resize; es lo que hace un
// <select> nativo. Alineado al borde derecho del trigger (es la última
// columna) y, si no entra debajo, se abre hacia arriba.
//
// ACCESIBILIDAD: sigue el patrón "menu button" de WAI-ARIA. El trigger lleva
// aria-haspopup="menu", aria-expanded y aria-controls; su nombre accesible es
// `label` ("Más acciones" por defecto) porque el ícono solo no es un nombre.
// El menú es role="menu" rotulado por el trigger, cada acción role="menuitem"
// con tabIndex -1: el foco entre ítems se mueve con ArrowUp/ArrowDown (con
// vuelta), Home/End, y desde el trigger ArrowDown/ArrowUp abren el menú
// dejando el foco en el primer/último ítem. Al abrir con click el foco
// también va al primer ítem. Escape cierra y devuelve el foco al trigger;
// Tab cierra y sigue la tabulación normal desde el trigger.
//
// NAVEGACIÓN: una acción con `to` se renderiza como Link de react-router
// (con href real: abrir en pestaña nueva, middle-click y "copiar dirección"
// siguen funcionando, igual que con el <Link>Editar</Link> que reemplaza).
// Es la única dependencia del design system sobre el router; se aceptó
// porque la alternativa —onClick + navigate()— degrada cada "Editar" a un
// botón sin URL.
// ---------------------------------------------------------------------------

export interface ActionsMenuAction {
  label: string;
  // Una de las dos: `to` para una navegación (Link con href real), `onClick`
  // para una acción imperativa (abrir un diálogo, borrar con confirm…). Si
  // vienen las dos, onClick corre antes de navegar.
  to?: string;
  onClick?: () => void;
  // Acción que borra/revoca/desactiva: se pinta en --color-danger para no
  // perder la señal que hoy da el Button variant="danger".
  destructive?: boolean;
  // Solo para acciones con onClick (un Link no se deshabilita). El ítem queda
  // en el menú pero gris y sin responder, como un Button disabled.
  disabled?: boolean;
  // Ícono decorativo delante del rótulo (aria-hidden lo pone el consumidor,
  // igual que en .ds-row-actions).
  icon?: ReactNode;
  // Por defecto elegir una acción cierra el menú. `keepOpen` lo deja abierto
  // para acciones cuyo resultado se muestra en el propio ítem —"Copiar link"
  // que pasa a decir "¡Copiado!"— y cerrarlo escondería la confirmación.
  keepOpen?: boolean;
}

export interface ActionsMenuProps {
  actions: ActionsMenuAction[];
  // Nombre accesible del trigger. Con varias filas conviene distinguirlas
  // ("Más acciones de Acme"), pero no es obligatorio: los tests ubican la
  // fila con within(row).
  label?: string;
}

const ICON = { size: 16, strokeWidth: 1.5, "aria-hidden": true } as const;

// Distancia entre el trigger y el menú, en px (= --space-1).
const GAP = 4;

export function ActionsMenu({ actions, label = "Más acciones" }: ActionsMenuProps) {
  const triggerId = useId();
  const menuId = `${triggerId}-menu`;

  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Qué ítem recibe el foco al abrir: el primero (click, ArrowDown) o el
  // último (ArrowUp), según el patrón de WAI-ARIA.
  const initialFocusRef = useRef<"first" | "last">("first");

  function openMenu(focus: "first" | "last") {
    initialFocusRef.current = focus;
    setOpen(true);
  }

  // Cerrar devolviendo el foco al trigger: el ítem enfocado deja de existir y
  // el foco caería al body. preventScroll para que el focus no dispare el
  // scroll que a su vez cerraría… un menú que ya se está cerrando.
  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function menuItems(): HTMLElement[] {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );
  }

  // Ubicar el menú respecto del trigger ANTES de pintar (useLayoutEffect):
  // pegado al borde derecho del trigger, debajo si entra y arriba si no.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const menu = menuRef.current?.getBoundingClientRect();
    if (!trigger || !menu) return;
    const fitsBelow = trigger.bottom + GAP + menu.height <= window.innerHeight;
    setMenuStyle({
      right: window.innerWidth - trigger.right,
      ...(fitsBelow
        ? { top: trigger.bottom + GAP }
        : { bottom: window.innerHeight - trigger.top + GAP }),
    });
  }, [open]);

  // Foco inicial al abrir, ya con el menú ubicado.
  useEffect(() => {
    if (!open) return;
    const items = menuItems();
    const target = initialFocusRef.current === "last" ? items[items.length - 1] : items[0];
    target?.focus({ preventScroll: true });
  }, [open]);

  // Click afuera: se escucha en document solo mientras está abierto, y
  // pointerdown (no click) para cerrar antes de que el click aterrice en lo
  // que sea que haya afuera. Un click adentro de la raíz no cierra. Scroll
  // (en captura, para atrapar el de .ds-table-wrap y no solo el de la
  // página) y resize también cierran: ver POSICIÓN arriba.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleViewportChange() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) {
      // Desde el trigger cerrado: las flechas abren (Enter/Space ya lo hacen
      // solas, es un <button>).
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openMenu(event.key === "ArrowDown" ? "first" : "last");
      }
      return;
    }
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        closeMenu();
        return;
      case "Tab":
        // Sin preventDefault: el foco vuelve al trigger y el Tab sigue desde
        // ahí al siguiente control de la página (o al anterior con Shift).
        closeMenu();
        return;
      case "ArrowDown":
      case "ArrowUp":
      case "Home":
      case "End": {
        event.preventDefault();
        const items = menuItems();
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement as HTMLElement);
        let next: number;
        if (event.key === "Home") next = 0;
        else if (event.key === "End") next = items.length - 1;
        else if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
        else next = current <= 0 ? items.length - 1 : current - 1;
        items[next]?.focus({ preventScroll: true });
        return;
      }
      default:
        return;
    }
  }

  // Cerrar ANTES de correr la acción: si la acción abre un Modal, ese Modal
  // se lleva el foco al montarse y no hay que pisárselo después; si abre un
  // window.confirm, el foco ya está en el trigger cuando vuelve.
  function handleSelect(action: ActionsMenuAction) {
    if (!action.keepOpen) closeMenu();
    action.onClick?.();
  }

  return (
    <div ref={rootRef} className="ds-actions-menu" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        className="ds-actions-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : openMenu("first"))}
      >
        <MoreVertical {...ICON} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          className="ds-actions-menu-list"
          style={menuStyle}
        >
          {actions.map((action, index) => {
            const className = [
              "ds-actions-menu-item",
              action.destructive ? "ds-actions-menu-item--danger" : null,
            ]
              .filter(Boolean)
              .join(" ");
            const content = (
              <>
                {action.icon}
                {action.label}
              </>
            );
            return action.to ? (
              <Link
                key={index}
                to={action.to}
                role="menuitem"
                tabIndex={-1}
                className={className}
                onClick={() => handleSelect(action)}
              >
                {content}
              </Link>
            ) : (
              <button
                key={index}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={className}
                disabled={action.disabled}
                onClick={() => handleSelect(action)}
              >
                {content}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
