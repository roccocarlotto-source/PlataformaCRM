import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../design-system/Badge";
import { Card } from "../../design-system/Card";
import { formatDateTime, formatShortDateTime } from "../../design-system/detailFormat";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { PageHeader } from "../../design-system/PageHeader";
import { Select } from "../../design-system/Select";
import { Table } from "../../design-system/Table";
import { AYUDA } from "../guia/anclas";
import { roleLabel } from "../user/roles";
import { ENTEROS, formatoDeCosto } from "./llmUsageFormat";
import { PERIODOS, porcentaje, RESULTADOS, tituloDeTema } from "./preguntasALaAyudaFormat";
import { useInformeDePreguntas } from "./queries";
import type {
  DiasDelInforme,
  FeedbackDeLaPregunta,
  FiltrosDelInforme,
  InformeDePreguntas,
  OrganizationIndustry,
  ResultadoDeLaPregunta,
} from "./types";

// ---------------------------------------------------------------------------
// "Preguntas a la ayuda": qué le preguntan al asistente "¿Cómo se hace?" en
// todas las organizaciones, para mejorar la guía y las pantallas. Solo
// platform admin (PlatformAdminRoute, grupo "Plataforma"). El backend nunca
// manda quién preguntó ni de qué organización. Las preguntas se guardan 90
// días: el período más largo es ese.
// ---------------------------------------------------------------------------

const RUBROS: { value: OrganizationIndustry; label: string }[] = [
  { value: "AUTOMOTORA", label: "Automotora" },
  { value: "CLINICA", label: "Clínica" },
];

const ROLES = ["ADMIN", "USER", "RECEPCION"].map((value) => ({ value, label: roleLabel(value) }));

const OPCIONES_DE_RESULTADO = (Object.keys(RESULTADOS) as ResultadoDeLaPregunta[]).map((value) => ({
  value,
  label: RESULTADOS[value].label,
}));

const OPCIONES_DE_FEEDBACK: { value: FeedbackDeLaPregunta; label: string }[] = [
  { value: "UP", label: "👍 Le sirvió" },
  { value: "DOWN", label: "👎 No le sirvió" },
];

export function PreguntasALaAyudaPage() {
  const [filtros, setFiltros] = useState<FiltrosDelInforme>({ dias: 30 });
  const informeQuery = useInformeDePreguntas(filtros);

  function filtrar<K extends keyof FiltrosDelInforme>(clave: K, valor: FiltrosDelInforme[K] | "") {
    setFiltros((actuales) => ({ ...actuales, [clave]: valor === "" ? undefined : valor }));
  }

  // Las pantallas del filtro salen del informe (las que tienen preguntas). La
  // elegida se conserva mientras carga el informe nuevo, así el filtro no
  // queda en blanco.
  const pantallas = (informeQuery.data?.pantallas ?? []).filter(
    (p): p is { clave: string; titulo: string | null; preguntas: number } => p.clave !== null,
  );
  const opcionesDePantalla = pantallas.map((p) => ({
    value: p.clave,
    label: p.titulo ?? p.clave,
  }));
  if (filtros.screen && !opcionesDePantalla.some((o) => o.value === filtros.screen)) {
    opcionesDePantalla.unshift({ value: filtros.screen, label: filtros.screen });
  }

  return (
    <>
      <PageHeader help={AYUDA.preguntasALaAyuda} title="Preguntas a la ayuda" />
      <div className="ds-stack">
        <div className="ds-list-card">
          <h2 className="ds-filters-title">Filtros</h2>
          <div className="ds-filters">
            <Select
              id="preguntas-periodo"
              label="Período"
              value={`${filtros.dias}`}
              options={PERIODOS}
              onChange={(valor) => {
                if (valor) filtrar("dias", Number(valor) as DiasDelInforme);
              }}
            />
            <Select
              id="preguntas-rubro"
              label="Rubro"
              value={filtros.industry ?? ""}
              options={RUBROS}
              emptyOption={{ label: "Todos" }}
              onChange={(valor) => filtrar("industry", valor)}
            />
            <Select
              id="preguntas-rol"
              label="Rol"
              value={filtros.role ?? ""}
              options={ROLES}
              emptyOption={{ label: "Todos" }}
              onChange={(valor) => filtrar("role", valor)}
            />
            <Select
              id="preguntas-pantalla"
              label="Pantalla"
              value={filtros.screen ?? ""}
              options={opcionesDePantalla}
              emptyOption={{ label: "Todas" }}
              onChange={(valor) => filtrar("screen", valor)}
            />
            <Select
              id="preguntas-resultado"
              label="Resultado"
              value={filtros.outcome ?? ""}
              options={OPCIONES_DE_RESULTADO}
              emptyOption={{ label: "Todos" }}
              onChange={(valor) => filtrar("outcome", valor)}
            />
            <Select
              id="preguntas-feedback"
              label="Opinión"
              value={filtros.feedback ?? ""}
              options={OPCIONES_DE_FEEDBACK}
              emptyOption={{ label: "Todas" }}
              onChange={(valor) => filtrar("feedback", valor)}
            />
          </div>
        </div>

        {informeQuery.isLoading ? <LoadingState variant="rows" /> : null}
        {informeQuery.isError ? (
          <ErrorState>
            No pudimos cargar las preguntas
            {informeQuery.error instanceof Error ? `: ${informeQuery.error.message}` : "."}
          </ErrorState>
        ) : null}
        {informeQuery.isSuccess ? <Informe informe={informeQuery.data} /> : null}
      </div>
    </>
  );
}

function Informe({ informe }: { informe: InformeDePreguntas }) {
  const { resumen } = informe;
  const sinError = resumen.preguntas - resumen.porResultado.ERROR;

  if (resumen.preguntas === 0) {
    return (
      <EmptyState title="No hay preguntas">
        Nadie le preguntó a la ayuda en este período, o ninguna pregunta coincide con los filtros.
      </EmptyState>
    );
  }

  const tarjetas = [
    {
      label: "Preguntas",
      valor: ENTEROS.format(resumen.preguntas),
      // Cuatro tarjetas, una fila en escritorio: las respondidas van acá.
      detalle: `${ENTEROS.format(resumen.porResultado.ANSWERED)} respondidas con la guía (${porcentaje(resumen.porResultado.ANSWERED, resumen.preguntas)}), ${ENTEROS.format(resumen.porResultado.DATA_REDIRECT)} pedían datos, ${ENTEROS.format(resumen.porResultado.OFF_TOPIC)} fuera de tema, ${ENTEROS.format(resumen.porResultado.ERROR)} fallaron`,
    },
    {
      label: "La guía no lo cubre",
      valor: ENTEROS.format(resumen.porResultado.NOT_COVERED),
      detalle: `${porcentaje(resumen.porResultado.NOT_COVERED, resumen.preguntas)} del total`,
    },
    {
      label: "¿Les sirvió?",
      valor: `👍 ${ENTEROS.format(resumen.utiles)} · 👎 ${ENTEROS.format(resumen.noUtiles)}`,
      detalle: `${ENTEROS.format(resumen.utiles + resumen.noUtiles)} respuestas con opinión`,
    },
    {
      label: "Costo (USD)",
      valor: formatoDeCosto(resumen.costoUsd),
      detalle: `Con caché: ${porcentaje(resumen.conCache, sinError)}`,
    },
  ];

  return (
    <>
      <section aria-label="Resumen">
        <dl className="ds-card-grid ds-kpi-row">
          {tarjetas.map((tarjeta) => (
            <Card as="div" key={tarjeta.label} className="ds-kpi">
              <dt className="ds-kpi-label">{tarjeta.label}</dt>
              <dd className="ds-kpi-value">{tarjeta.valor}</dd>
              <dd className="ds-kpi-delta">{tarjeta.detalle}</dd>
            </Card>
          ))}
        </dl>
      </section>

      <Card heading="Preguntas frecuentes">
        {informe.frecuentes.length === 0 ? (
          <EmptyState>Todavía no hay preguntas repetidas en este período.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Pregunta</th>
                <th>Veces</th>
                <th>Última vez</th>
              </tr>
            </thead>
            <tbody>
              {informe.frecuentes.map((frecuente) => (
                <tr key={frecuente.pregunta}>
                  <td>
                    <span
                      className="ds-cell-clamp ds-cell-clamp--principal"
                      title={frecuente.pregunta}
                    >
                      {frecuente.pregunta}
                    </span>
                  </td>
                  <td>{ENTEROS.format(frecuente.veces)}</td>
                  <td title={formatDateTime(frecuente.ultima)}>
                    {formatShortDateTime(frecuente.ultima)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card heading="Por pantalla">
        <Table>
          <thead>
            <tr>
              <th>Pantalla</th>
              <th>Preguntas</th>
            </tr>
          </thead>
          <tbody>
            {informe.pantallas.map((pantalla) => (
              <tr key={pantalla.clave ?? ""}>
                <td>
                  {pantalla.clave === null ? "Sin pantalla" : (pantalla.titulo ?? pantalla.clave)}
                </td>
                <td>{ENTEROS.format(pantalla.preguntas)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card heading="Últimas preguntas">
        <p className="ds-hint">
          Las {ENTEROS.format(informe.recientes.length)} más recientes, sin quién preguntó ni de qué
          organización.
        </p>
        <Table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Pregunta</th>
              <th>Resultado</th>
              <th>Opinión</th>
              <th>Temas citados</th>
              <th>Desde</th>
            </tr>
          </thead>
          <tbody>
            {informe.recientes.map((pregunta) => (
              <tr key={pregunta.id}>
                <td title={formatDateTime(pregunta.createdAt)}>
                  {formatShortDateTime(pregunta.createdAt)}
                </td>
                <td>
                  <span
                    className="ds-cell-clamp ds-cell-clamp--principal"
                    title={pregunta.question}
                  >
                    {pregunta.question}
                  </span>
                </td>
                <td>
                  <Badge variant={RESULTADOS[pregunta.outcome].variant}>
                    {RESULTADOS[pregunta.outcome].label}
                  </Badge>
                </td>
                <td>
                  {pregunta.feedback === "UP" ? (
                    <span aria-label="Le sirvió">👍</span>
                  ) : pregunta.feedback === "DOWN" ? (
                    <span aria-label="No le sirvió">👎</span>
                  ) : null}
                </td>
                <td>
                  {pregunta.sources.map((fuente, indice) => (
                    <span key={fuente}>
                      {indice > 0 ? ", " : null}
                      <Link to={`/ayuda/${fuente}`}>{tituloDeTema(fuente)}</Link>
                    </span>
                  ))}
                </td>
                {/* Pantalla, rubro y rol en una celda: con una columna cada
                    uno, la tabla no entraba ni en escritorio. */}
                <td>
                  {[
                    tituloDePantallaDelInforme(informe, pregunta.screen),
                    RUBROS.find((r) => r.value === pregunta.industry)?.label,
                    roleLabel(pregunta.role),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

function tituloDePantallaDelInforme(informe: InformeDePreguntas, clave: string | null): string {
  if (clave === null) return "";
  return informe.pantallas.find((p) => p.clave === clave)?.titulo ?? clave;
}
