import { Link } from "react-router-dom";
import { Plus, Users } from "lucide-react";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { PageHeader } from "../../design-system/PageHeader";
import { Table } from "../../design-system/Table";
import { BRANCHES_PARA_SELECT, useBranches } from "../branch/queries";
import { useResources } from "../resource/queries";
import { usePrestaciones } from "./queries";
import { useVocabularioDeClinica } from "./vocabulario";
import { useState } from "react";
import { SobreturnosDelProfesionalDialog } from "./SobreturnosDelProfesionalDialog";
import { CalendarioDelProfesionalDialog } from "./CalendarioDelProfesionalDialog";
import { getAccessToken } from "../../auth/getAccessToken";
import { useConfirm } from "../../design-system/useConfirm";
import { request } from "../../lib/api";
import { useDeleteResource } from "../resource/mutations";
import type { Resource } from "../resource/types";

const SIN_RESOLVER = "—";

// Profesionales de una clínica (docs/rubros.md §4.2, R5). Un profesional es un
// recurso de tipo persona: tiene sede, horario y nombre. Esta pantalla los
// lista con las prestaciones que atiende; darlo de alta, editarlo y cargar su
// horario se hace en la pantalla de recursos, que ya existe. Vive dentro de
// AdminRoute.
export function ProfesionalesPage() {
  const vocabulario = useVocabularioDeClinica();
  const recursosQuery = useResources({
    type: "PERSON",
    pageSize: 100,
    sortBy: "name",
    sortOrder: "asc",
  });
  const prestacionesQuery = usePrestaciones();
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);
  const nombreDeSede = new Map((branchesQuery.data?.data ?? []).map((b) => [b.id, b.name]));

  const prestacionesDe = new Map<string, string[]>();
  for (const p of prestacionesQuery.data?.prestaciones ?? []) {
    for (const r of p.profesionales) {
      prestacionesDe.set(r.id, [...(prestacionesDe.get(r.id) ?? []), p.name]);
    }
  }

  const profesionales = recursosQuery.data?.data ?? [];
  const termino = vocabulario.recurso;
  // R6: el diálogo de sobreturnos de un profesional.
  const [deSobreturnos, setDeSobreturnos] = useState<Resource | null>(null);
  // R8: el diálogo del calendario de Google de un profesional.
  const [deCalendario, setDeCalendario] = useState<Resource | null>(null);
  // R9: archivar avisa antes cuántos turnos futuros tiene el profesional.
  const confirm = useConfirm();
  const archivar = useDeleteResource();
  async function handleArchivar(r: Resource) {
    const { cantidad } = await request<{ cantidad: number }>(
      `/clinica/profesionales/${r.id}/turnos-futuros`,
      { getAccessToken },
    );
    const aviso =
      cantidad > 0
        ? `${r.name} tiene ${cantidad} ${cantidad === 1 ? "turno futuro" : "turnos futuros"}. No se cancelan: a la recepción de la sede le queda una tarea por cada uno para reprogramarlo o cancelarlo.`
        : `${r.name} no tiene turnos futuros.`;
    if (
      !(await confirm(`${aviso} ¿Archivar a ${r.name}?`, {
        confirmLabel: "Archivar",
        danger: true,
      }))
    )
      return;
    archivar.mutate(r.id);
  }

  return (
    <div>
      <PageHeader
        title={termino.pluralTitulo}
        actions={
          <Link to="/resources/new" className="ds-link-button">
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Nuevo {termino.singular}
          </Link>
        }
      />

      <div className="ds-list-card">
        {recursosQuery.isLoading ? <LoadingState variant="rows" /> : null}

        {recursosQuery.isError ? (
          <ErrorState>
            No pudimos cargar los {termino.plural}
            {recursosQuery.error instanceof Error ? `: ${recursosQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {recursosQuery.isSuccess && profesionales.length === 0 ? (
          <EmptyState title={`No hay ${termino.plural} para mostrar`} icon={Users} />
        ) : null}

        {recursosQuery.isSuccess && profesionales.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Sede</th>
                <th>{vocabulario.tipoDeServicio.pluralTitulo}</th>
                <th>Sobreturnos</th>
                <th>Calendario de Google</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {profesionales.map((r) => (
                <tr key={r.id}>
                  <td className="ds-cell-primary">{r.name}</td>
                  <td>{nombreDeSede.get(r.branchId) ?? SIN_RESOLVER}</td>
                  <td>{(prestacionesDe.get(r.id) ?? []).join(", ") || SIN_RESOLVER}</td>
                  <td className="ds-cell-muted">
                    {r.allowsOverbooking
                      ? `Hasta ${String(r.maxOverbookingsPerDay ?? 1)} por día`
                      : "No"}
                  </td>
                  <td className="ds-cell-muted">{r.googleCalendarId ?? SIN_RESOLVER}</td>
                  <td>
                    <ActionsMenu
                      actions={[
                        { label: "Editar y horario", to: `/resources/${r.id}/edit` },
                        { label: "Sobreturnos", onClick: () => setDeSobreturnos(r) },
                        { label: "Calendario de Google", onClick: () => setDeCalendario(r) },
                        {
                          label: "Archivar",
                          onClick: () => void handleArchivar(r),
                          destructive: true,
                          disabled: archivar.isPending,
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
      </div>
      {deCalendario ? (
        <CalendarioDelProfesionalDialog
          profesional={deCalendario}
          onClose={() => setDeCalendario(null)}
        />
      ) : null}
      {deSobreturnos ? (
        <SobreturnosDelProfesionalDialog
          profesional={deSobreturnos}
          onClose={() => setDeSobreturnos(null)}
        />
      ) : null}
    </div>
  );
}
