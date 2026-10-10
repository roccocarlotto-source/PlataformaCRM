import { useState } from "react";
import { Clock } from "lucide-react";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Modal } from "../../design-system/Modal";
import { PageHeader } from "../../design-system/PageHeader";
import { Table } from "../../design-system/Table";
import { BRANCHES_PARA_SELECT, useBranches } from "../branch/queries";
import { useResources } from "../resource/queries";
import { formatDuracion } from "../serviceType/format";
import { useDefinirProfesionales, usePrestaciones } from "./queries";
import type { PrestacionConProfesionales } from "./types";
import { useVocabularioDeClinica } from "./vocabulario";

const SIN_RESOLVER = "—";

// Prestaciones de una clínica con quién las atiende (docs/rubros.md §4.3, R5).
// Una prestación la pueden hacer varios profesionales: el paciente elige uno o
// "el primero libre". El profesional principal (el de la prestación) queda
// siempre. Crear, editar y borrar la prestación sigue siendo la pantalla de
// tipos de servicio; acá solo se define quién la atiende. Vive dentro de
// AdminRoute, como la de tipos de servicio.
export function PrestacionesPage() {
  const vocabulario = useVocabularioDeClinica();
  const prestacionesQuery = usePrestaciones();
  const branchesQuery = useBranches(BRANCHES_PARA_SELECT);
  const nombreDeSede = new Map((branchesQuery.data?.data ?? []).map((b) => [b.id, b.name]));
  const [editando, setEditando] = useState<PrestacionConProfesionales | null>(null);

  const prestaciones = prestacionesQuery.data?.prestaciones ?? [];
  const profesionales = vocabulario.recurso;
  const prestacion = vocabulario.tipoDeServicio;

  return (
    <div>
      <PageHeader title={prestacion.pluralTitulo} />

      <div className="ds-list-card">
        {prestacionesQuery.isLoading ? <LoadingState variant="rows" /> : null}

        {prestacionesQuery.isError ? (
          <ErrorState>
            No pudimos cargar las {prestacion.plural}
            {prestacionesQuery.error instanceof Error
              ? `: ${prestacionesQuery.error.message}`
              : "."}
          </ErrorState>
        ) : null}

        {prestacionesQuery.isSuccess && prestaciones.length === 0 ? (
          <EmptyState title={`No hay ${prestacion.plural} para mostrar`} icon={Clock} />
        ) : null}

        {prestacionesQuery.isSuccess && prestaciones.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>{prestacion.singularTitulo}</th>
                <th>Sede</th>
                <th>Duración</th>
                <th>{profesionales.pluralTitulo}</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {prestaciones.map((p) => (
                <tr key={p.id}>
                  <td className="ds-cell-primary">{p.name}</td>
                  <td>{nombreDeSede.get(p.branchId) ?? SIN_RESOLVER}</td>
                  <td>{formatDuracion(p.durationMin)}</td>
                  <td>{p.profesionales.map((r) => r.name).join(", ") || SIN_RESOLVER}</td>
                  <td>
                    <ActionsMenu
                      actions={[
                        {
                          label: `Elegir ${profesionales.plural}`,
                          onClick: () => setEditando(p),
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

      {editando ? (
        <ProfesionalesDialog prestacion={editando} onClose={() => setEditando(null)} />
      ) : null}
    </div>
  );
}

function ProfesionalesDialog({
  prestacion,
  onClose,
}: {
  prestacion: PrestacionConProfesionales;
  onClose: () => void;
}) {
  const vocabulario = useVocabularioDeClinica();
  // Solo personas de la sede de la prestación (§4.2): el backend rechaza las
  // demás.
  const recursosQuery = useResources({
    branchId: prestacion.branchId,
    type: "PERSON",
    pageSize: 100,
    sortBy: "name",
    sortOrder: "asc",
  });
  const [elegidos, setElegidos] = useState<Set<string>>(
    () => new Set(prestacion.profesionales.map((r) => r.id)),
  );
  const definir = useDefinirProfesionales();

  function alternar(id: string) {
    setElegidos((actuales) => {
      const nuevos = new Set(actuales);
      if (nuevos.has(id)) nuevos.delete(id);
      else nuevos.add(id);
      return nuevos;
    });
  }

  function guardar() {
    definir.mutate(
      { serviceTypeId: prestacion.id, resourceIds: [...elegidos] },
      { onSuccess: onClose },
    );
  }

  const candidatos = recursosQuery.data?.data ?? [];

  return (
    <Modal
      variant="dialog"
      title={`${vocabulario.recurso.pluralTitulo} de ${prestacion.name}`}
      onClose={onClose}
      closeLabel="Cancelar"
      primaryAction={{ label: "Guardar", onClick: guardar, loading: definir.isPending }}
    >
      <p>
        Elegí quiénes atienden esta {vocabulario.tipoDeServicio.singular}. Al dar un{" "}
        {vocabulario.reserva.singular}, el {vocabulario.contacto.singular} puede elegir uno o tomar
        el primero libre.
      </p>
      {recursosQuery.isLoading ? <LoadingState variant="rows" /> : null}
      {definir.isError ? (
        <ErrorState>
          No pudimos guardar
          {definir.error instanceof Error ? `: ${definir.error.message}` : "."}
        </ErrorState>
      ) : null}
      <fieldset className="ds-check-list">
        <legend className="ds-field-label">{vocabulario.recurso.pluralTitulo}</legend>
        {candidatos.map((r) => {
          const principal = r.id === prestacion.resourceId;
          return (
            <label key={r.id} className="ds-check-option">
              <input
                type="checkbox"
                checked={principal || elegidos.has(r.id)}
                disabled={principal}
                onChange={() => alternar(r.id)}
              />
              <span>{principal ? `${r.name} (principal)` : r.name}</span>
            </label>
          );
        })}
      </fieldset>
    </Modal>
  );
}
