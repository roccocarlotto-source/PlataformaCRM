import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { EmptyState } from "../../design-system/EmptyState";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "./anclas";
import { renderizarMarkdown } from "./markdown";
import {
  buscarEnTitulos,
  seccionPorSlug,
  seccionesVisibles,
  type Seccion,
  type ResultadoDeBusqueda,
} from "./secciones";

// La guía de uso dentro de la app: /ayuda es el índice (todas las secciones
// con sus temas y un buscador sobre los títulos) y /ayuda/<slug> es una
// sección, renderizada del markdown de docs/guia-de-uso/. El ícono "?" de
// cada pantalla llega a /ayuda/<slug>#<ancla>.
export function GuiaPage() {
  const { seccion: slug } = useParams();
  const { me } = useAuth();
  const secciones = seccionesVisibles(me?.isPlatformAdmin === true);

  if (!slug) return <Indice secciones={secciones} />;

  const seccion = seccionPorSlug(slug);
  if (!seccion || !secciones.includes(seccion)) {
    return (
      <div>
        <PageHeader title="Ayuda" back={{ to: "/ayuda", label: "Ayuda" }} />
        <EmptyState title="Esta sección no existe">
          Volvé al índice de la guía para encontrar lo que buscás.
        </EmptyState>
      </div>
    );
  }
  return <SeccionDeGuia seccion={seccion} />;
}

function Indice({ secciones }: { secciones: Seccion[] }) {
  const [consulta, setConsulta] = useState("");
  const resultados: ResultadoDeBusqueda[] = useMemo(
    () => buscarEnTitulos(secciones, consulta),
    [secciones, consulta],
  );
  const buscando = consulta.trim().length > 0;

  return (
    <div>
      <PageHeader
        title="Ayuda"
        subtitle="Cómo usar cada pantalla de la app, paso a paso."
        help={AYUDA.ayuda}
      />
      <div className="ds-guia">
        <label className="ds-guia-search">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          <span className="ds-sr-only">Buscar en la guía</span>
          <input
            type="search"
            placeholder="Buscar un tema (por ejemplo, cupón, reserva, etapa)"
            value={consulta}
            onChange={(event) => setConsulta(event.target.value)}
          />
        </label>
        {resultados.length === 0 ? (
          <EmptyState title="No encontramos ese tema">
            Probá con otra palabra, o recorré el índice borrando la búsqueda.
          </EmptyState>
        ) : (
          <ul className="ds-guia-index">
            {resultados.map(({ seccion, encabezados }) => {
              // Sin búsqueda, el índice muestra solo los ## de cada sección;
              // con búsqueda, exactamente los títulos que coincidieron.
              const temas = buscando
                ? encabezados
                : seccion.encabezados.filter((e) => e.nivel === 2);
              return (
                <li key={seccion.slug} className="ds-guia-index-section">
                  <Link to={`/ayuda/${seccion.slug}`} className="ds-guia-index-title">
                    {seccion.titulo}
                  </Link>
                  {temas.length > 0 ? (
                    <ul className="ds-guia-index-topics">
                      {temas.map((tema) => (
                        <li key={tema.ancla}>
                          <Link to={`/ayuda/${seccion.slug}#${tema.ancla}`}>{tema.titulo}</Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SeccionDeGuia({ seccion }: { seccion: Seccion }) {
  const { hash } = useLocation();
  const navigate = useNavigate();
  // Sin el `# Título` del archivo: ya lo muestra PageHeader.
  const html = useMemo(
    () => renderizarMarkdown(seccion.markdown.replace(/^# .*\r?\n/, "")),
    [seccion],
  );
  const temas = seccion.encabezados.filter((e) => e.nivel === 2);

  // El "?" de una pantalla llega con #ancla: el navegador no hace scroll solo
  // porque el contenido se renderiza después de la navegación.
  useEffect(() => {
    const id = hash.replace(/^#/, "");
    if (!id) {
      document.documentElement.scrollTop = 0;
      return;
    }
    const destino = document.getElementById(id);
    // jsdom no implementa scrollIntoView; en el navegador siempre está.
    if (destino && typeof destino.scrollIntoView === "function") destino.scrollIntoView();
  }, [hash, html]);

  // Los links del markdown son <a href> comunes; los internos (/contacts,
  // /ayuda/...#ancla) se navegan con el router para no recargar la app.
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest("a");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href || !href.startsWith("/")) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  }

  return (
    <div>
      <PageHeader title={seccion.titulo} back={{ to: "/ayuda", label: "Ayuda" }} />
      <div className="ds-guia">
        {temas.length > 1 ? (
          <nav className="ds-guia-toc" aria-label="En esta sección">
            <ul>
              {temas.map((tema) => (
                <li key={tema.ancla}>
                  <Link to={`/ayuda/${seccion.slug}#${tema.ancla}`}>{tema.titulo}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <article
          className="ds-guia-prose"
          onClick={handleClick}
          // Sanitizado con DOMPurify en renderizarMarkdown; el markdown viene
          // del repo, no de un usuario.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
