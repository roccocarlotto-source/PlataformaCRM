import { Link } from "react-router-dom";
import { PageHeader } from "../../design-system/PageHeader";
import { Badge } from "../../design-system/Badge";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Table } from "../../design-system/Table";
import { useAutomations } from "../automation/queries";
import type { Automation } from "../automation/types";
import { accionConPlantilla, TRIGGER_DE_LAS_ACCIONES_CON_PLANTILLA } from "./acciones";
import { ESTADOS } from "./estados";
import { useWhatsappTemplatesOf } from "./queries";

// El tope del backend para pageSize. Una organización con más de 100 reglas de
// "oportunidad ganada" no es un caso real hoy; si pasa, la pantalla lo dice.
const TOPE = 100;

function PlantillaDeLaRegla({
  query,
}: {
  query: ReturnType<typeof useWhatsappTemplatesOf>[number] | undefined;
}) {
  if (!query || query.isLoading) {
    return <span className="ds-hint">Cargando…</span>;
  }
  if (query.isError) {
    return <span className="ds-hint">No se pudo cargar</span>;
  }
  if (!query.data) {
    return <Badge variant="neutral">Sin plantilla</Badge>;
  }
  const estado = ESTADOS[query.data.status];
  return <Badge variant={estado.variant}>{estado.label}</Badge>;
}

// Las plantillas de WhatsApp de la organización, una por regla (ítem 181 de
// docs/frontend-cambios-pendientes.md; en el 160 era una sola por
// organización y esta ruta mostraba directo el formulario). Lista las
// automatizaciones cuya acción manda WhatsApp, cada una con el estado de su
// plantilla, y lleva a la pantalla de esa regla para crearla, verla o
// borrarla. Incluye las reglas inactivas: aprobar la plantilla ANTES de
// activar la regla es el orden razonable, porque Meta tarda en revisarla.
export function WhatsappTemplateListPage() {
  const reglasQuery = useAutomations({
    triggerType: TRIGGER_DE_LAS_ACCIONES_CON_PLANTILLA,
    pageSize: TOPE,
    sortBy: "name",
    sortOrder: "asc",
  });
  const reglas: Automation[] = (reglasQuery.data?.data ?? []).filter(
    (regla) => accionConPlantilla(regla.actionType) !== undefined,
  );
  const plantillas = useWhatsappTemplatesOf(reglas.map((regla) => regla.id));

  return (
    <div>
      <PageHeader title="Plantillas de WhatsApp" />

      <div className="ds-list-card">
        <p className="ds-hint">
          Cada automatización que manda WhatsApp tiene su propia plantilla, aprobada por Meta. Sin
          una plantilla aprobada, esa automatización no manda ningún mensaje.
        </p>

        {reglasQuery.isLoading ? <LoadingState variant="rows" /> : null}

        {reglasQuery.isError ? (
          <ErrorState>
            No pudimos cargar las automatizaciones
            {reglasQuery.error instanceof Error ? `: ${reglasQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {reglasQuery.isSuccess && reglas.length === 0 ? (
          <EmptyState>
            Ninguna automatización manda WhatsApp todavía. Creá una en{" "}
            <Link to="/automations">Automatizaciones</Link> y volvé acá para cargar su plantilla.
          </EmptyState>
        ) : null}

        {reglasQuery.isSuccess && reglas.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Automatización</th>
                <th>Qué hace</th>
                <th>Plantilla</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {reglas.map((regla, indice) => (
                <tr key={regla.id}>
                  <td className="ds-cell-primary">
                    {regla.name}
                    {regla.isActive ? null : (
                      <>
                        {" "}
                        <Badge variant="neutral">Inactiva</Badge>
                      </>
                    )}
                  </td>
                  <td>{accionConPlantilla(regla.actionType)?.label}</td>
                  <td>
                    <PlantillaDeLaRegla query={plantillas[indice]} />
                  </td>
                  <td>
                    <Link
                      to={`/whatsapp-template/${regla.id}`}
                      aria-label={`Plantilla de ${regla.name}`}
                    >
                      {plantillas[indice]?.data ? "Ver plantilla" : "Cargar plantilla"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}

        {reglasQuery.isSuccess && reglasQuery.data.pagination.totalPages > 1 ? (
          <p className="ds-hint">
            Se muestran las automatizaciones de las primeras {TOPE} reglas de &quot;oportunidad
            ganada&quot;.
          </p>
        ) : null}
      </div>
    </div>
  );
}
