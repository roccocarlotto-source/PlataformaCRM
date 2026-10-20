import { MODULOS_ACTIVABLES } from "../../auth/useModulo";
import {
  parsearSecciones,
  seccionesDelRubro as seccionesDelRubroDeLaGuia,
  seccionesVisibles as seccionesVisiblesDeLaGuia,
  type Guia,
  type Seccion,
} from "../../../../src/compartido/guia/guia";

// Las secciones de la guía de uso, leídas de docs/guia-de-uso/ EN EL BUILD:
// Vite las mete en el bundle como strings (`?raw`), así que la pantalla de
// Ayuda no le pide nada al backend y la guía se actualiza con cada deploy del
// frontend. Las convenciones (nombres de archivo, anclas) están en
// docs/guia-de-uso/README.md.
//
// Qué ve cada quien (rubro, módulos, rol) lo decide src/compartido/guia/guia.ts,
// el MISMO código que usa el backend para el asistente "¿Cómo se hace?". Acá
// solo se cargan los archivos y se adapta la firma de siempre.
//
// El patrón `[0-9][0-9]-*.md` excluye al README a propósito.
const ARCHIVOS = import.meta.glob<string>("../../../../docs/guia-de-uso/[0-9][0-9]-*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

// La guía de una clínica (docs/rubros.md §1.3, R17): docs/guia-de-uso/clinicas/,
// con los mismos números y slugs que la de la raíz.
const ARCHIVOS_DE_CLINICA = import.meta.glob<string>(
  "../../../../docs/guia-de-uso/clinicas/[0-9][0-9]-*.md",
  { query: "?raw", import: "default", eager: true },
);

export {
  buscarEnTitulos,
  filtrarPorModulos,
  MODULO_DE_ANCLA,
  normalizar,
  parsearSeccion,
  RUTAS_DE_ADMIN,
  RUTAS_DE_PLATAFORMA,
  SOLO_ADMIN_DE_ANCLA,
  SOLO_ADMIN_DE_ANCLA_DE_CLINICA,
  SOLO_SIN_MODULO,
  type Encabezado,
  type ResultadoDeBusqueda,
  type Seccion,
} from "../../../../src/compartido/guia/guia";

export const SECCIONES: Seccion[] = parsearSecciones(ARCHIVOS);
export const SECCIONES_DE_CLINICA: Seccion[] = parsearSecciones(ARCHIVOS_DE_CLINICA);
const GUIA: Guia = { raiz: SECCIONES, clinica: SECCIONES_DE_CLINICA };

/** Las secciones del rubro (seccionesDelRubro de la guía compartida). */
export function seccionesDelRubro(
  esClinica: boolean,
  tiene: (modulo: string) => boolean = () => true,
): Seccion[] {
  return seccionesDelRubroDeLaGuia(GUIA, esClinica, tiene, MODULOS_ACTIVABLES);
}

/** Las secciones que ve quien está en la app: las de su rubro, "Plataforma"
 *  solo el platform admin, los bloques que van con los módulos de la
 *  organización (`tiene`, la regla de useModulo) y, si no es ADMIN, sin los
 *  bloques de administrador. */
export function seccionesVisibles(
  esPlatformAdmin: boolean,
  tiene: (modulo: string) => boolean = () => true,
  esClinica = false,
  esAdmin = true,
): Seccion[] {
  return seccionesVisiblesDeLaGuia(GUIA, {
    esPlatformAdmin,
    esAdmin,
    esClinica,
    tiene,
    modulosActivables: MODULOS_ACTIVABLES,
  });
}

export function seccionPorSlug(slug: string | undefined): Seccion | undefined {
  return SECCIONES.find((seccion) => seccion.slug === slug);
}
