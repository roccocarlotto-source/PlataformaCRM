import { getInitials } from "./initials";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  name: string;
  // sm (24px): dueño de una fila. md (32px): contacto en un listado.
  // lg (40px): cabecera / cuenta. Son los tres tamaños que usa el diseño.
  size?: AvatarSize;
  // true cuando el nombre completo ya está visible al lado del avatar (el
  // caso típico en tablas): se oculta al lector de pantalla para no anunciar
  // "Rocco Carlotto" dos veces. Por defecto el avatar se anuncia solo, con
  // el nombre como etiqueta accesible.
  decorative?: boolean;
}

// ---------------------------------------------------------------------------
// Círculo con iniciales. UN SOLO TONO para todas las personas — se verificó
// en el export "Contactos CRM" leyendo los estilos computados de cada avatar
// (VR, RC, MC, ME, LF, DS, PN, ...): todos comparten fondo #F6F6F3, borde
// #E6E5E0 y texto #57564D. No hay paleta por persona, así que no se inventa
// una: el color semántico queda reservado a los badges.
// ---------------------------------------------------------------------------
export function Avatar({ name, size = "md", decorative = false }: AvatarProps) {
  const initials = getInitials(name);
  return (
    <span
      className={`ds-avatar ds-avatar--${size}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      title={name}
    >
      {initials}
    </span>
  );
}
