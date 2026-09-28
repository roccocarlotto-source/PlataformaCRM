import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";

// ---------------------------------------------------------------------------
// Shell de una pantalla pensada para el celular que vive FUERA de AppLayout
// (ver app/router.tsx): la sidebar del shell no tiene ningún breakpoint y en
// un teléfono no colapsa. Una columna a pantalla completa con encabezado chico
// —"‹ Volver" al Dashboard para quien la abre desde una compu, el título y el
// ThemeToggle— y el contenido abajo.
//
// Nació como el Layout local del chat del agente interno (ítem 180) y se
// sacó acá con el escáner de cupones (ítem 178), para que las dos pantallas
// mobile de la plataforma se vean iguales por construcción. `className`
// agrega las reglas propias de cada pantalla sobre .ds-mobile-screen.
// ---------------------------------------------------------------------------

export interface MobileScreenProps {
  title: string;
  className?: string;
  children: ReactNode;
}

export function MobileScreen({ title, className, children }: MobileScreenProps) {
  return (
    <div className={className ? `ds-mobile-screen ${className}` : "ds-mobile-screen"}>
      <header className="ds-mobile-screen-header">
        <Link to="/" className="ds-mobile-screen-back">
          ‹ Volver
        </Link>
        <h1 className="ds-mobile-screen-title">{title}</h1>
        <ThemeToggle />
      </header>
      {children}
    </div>
  );
}

// El cuerpo cuando no hay contenido propio que mostrar (cargando, vacío,
// error).
export function MobileScreenNotice({ children }: { children: ReactNode }) {
  return <div className="ds-mobile-screen-notice">{children}</div>;
}
