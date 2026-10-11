import { useId, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronRight, type LucideIcon } from "lucide-react";

// Las piezas de la sidebar (AppLayout), compartidas por el menú de cada rubro
// (docs/rubros.md §1.3): MenuDeAutomotora y MenuDeClinica.

// Ícono + href + label de cada link, para no repetir el patrón de NavLink
// (className por isActive) en cada ítem. Los labels son EXACTAMENTE los que
// ya cubre AppLayout.test.tsx — el restyle no toca ningún texto.
export function SidebarLink({
  to,
  end,
  icon: Icon,
  children,
}: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  children: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `ds-sidebar-link${isActive ? " is-active" : ""}`}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      {children}
    </NavLink>
  );
}

// Mismo criterio que el `isActive` de NavLink sin `end`: la ruta exacta o
// cualquier subruta (/agents/:id/playground cuenta como /agents).
function isInside(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

// Estado plegado/desplegado de una sección (ítem 79). Arranca desplegada
// solo si la ruta activa es uno de sus `paths`, y se vuelve a desplegar
// cuando se navega hacia adentro desde afuera (un link del contenido, el
// botón atrás) — el usuario siempre ve dónde está parado. Plegarla a mano
// estando adentro se respeta: solo reacciona a un CAMBIO de pathname.
// Ajuste de estado durante el render, no useEffect: es el patrón que
// recomienda React para derivar estado de un cambio de props/contexto.
function useSectionOpen(paths: readonly string[]) {
  const { pathname } = useLocation();
  const containsActive = paths.some((to) => isInside(pathname, to));
  const [open, setOpen] = useState(containsActive);
  const [seenPathname, setSeenPathname] = useState(pathname);
  if (pathname !== seenPathname) {
    setSeenPathname(pathname);
    if (containsActive) setOpen(true);
  }
  return [open, () => setOpen((value) => !value)] as const;
}

// Sección colapsable de la sidebar (ítem 79). Dos formas de título:
// - sin `link`: el título es solo un toggle, con la tipografía de
//   .ds-sidebar-group-label de siempre (CRM, Actividades, Administración);
// - con `link`: el título es un link real con la forma de .ds-sidebar-link,
//   que navega Y pliega/despliega con el mismo click (Contactos, Agentes de
//   IA); sus hijos van con sangría porque cuelgan de esa pantalla.
// `paths` son las rutas de los hijos, para saber si arranca desplegada; la
// del propio título no cuenta — el link del título ya se ve siempre, y
// contarla haría que plegarlo desde un hijo se deshiciera al navegar.
// Plegada, los hijos siguen montados (para poder animar el alto, ítem 80)
// pero con `inert`: fuera del tab order y del árbol de accesibilidad, la
// misma garantía que daba desmontarlos.
export function SidebarSection({
  label,
  paths,
  link,
  nested,
  children,
}: {
  label: string;
  paths: readonly string[];
  link?: { to: string; icon: LucideIcon };
  nested?: boolean;
  children: ReactNode;
}) {
  const [open, toggle] = useSectionOpen(paths);
  const itemsId = useId();
  const chevron = (
    <ChevronRight
      className={`ds-sidebar-chevron${open ? " is-open" : ""}`}
      size={14}
      strokeWidth={1.5}
      aria-hidden="true"
    />
  );

  let header: ReactNode;
  if (link) {
    const Icon = link.icon;
    header = (
      <NavLink
        to={link.to}
        onClick={toggle}
        aria-expanded={open}
        aria-controls={itemsId}
        className={({ isActive }) => `ds-sidebar-link${isActive ? " is-active" : ""}`}
      >
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
        {label}
        {chevron}
      </NavLink>
    );
  } else {
    header = (
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={itemsId}
        className="ds-sidebar-group-label ds-sidebar-group-toggle"
      >
        {label}
        {chevron}
      </button>
    );
  }

  return (
    <div className={`ds-sidebar-group${link && !nested ? " ds-sidebar-group--link-header" : ""}`}>
      {header}
      <div
        id={itemsId}
        inert={!open}
        className={`ds-sidebar-group-collapse${open ? " is-open" : ""}`}
      >
        <div className="ds-sidebar-group-collapse-inner">
          <div
            className={`ds-sidebar-group-items${link ? " ds-sidebar-group-items--indented" : ""}`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
