import { Link } from "react-router-dom";
import { ListChecks, Plus } from "lucide-react";
import { useConfirm } from "../../design-system/useConfirm";
import { PageHeader } from "../../design-system/PageHeader";
import { ActionsMenu } from "../../design-system/ActionsMenu";
import { Badge } from "../../design-system/Badge";
import { EmptyState } from "../../design-system/EmptyState";
import { ErrorState } from "../../design-system/ErrorState";
import { LoadingState } from "../../design-system/LoadingState";
import { Table } from "../../design-system/Table";
import { MAX_CAMPOS_POR_ORGANIZACION, TIPO_DE_CAMPO_LABEL } from "./labels";
import { tieneOpciones } from "./types";
import { useDeleteContactCustomField } from "./mutations";
import { useContactCustomFields } from "./queries";

// Campos personalizados de contactos, v1 (B6): las definiciones de la
// organización. Sin gate `isAdmin`, mismo criterio que ServiceTypeListPage:
// la pantalla vive entera dentro de AdminRoute. Sin paginación ni filtros:
// son a lo sumo 30.
export function ContactCustomFieldListPage() {
  const confirm = useConfirm();
  const fieldsQuery = useContactCustomFields();
  const deleteMutation = useDeleteContactCustomField();

  async function handleDelete(id: string) {
    if (
      !(await confirm(
        "¿Eliminar este campo? Deja de verse en las fichas; los valores que los contactos ya tienen no se borran.",
        { confirmLabel: "Eliminar", danger: true },
      ))
    )
      return;
    deleteMutation.mutate(id);
  }

  const campos = fieldsQuery.data ?? [];
  const alTope = campos.length >= MAX_CAMPOS_POR_ORGANIZACION;

  return (
    <div>
      <PageHeader
        title="Campos de contacto"
        actions={
          alTope ? null : (
            <Link to="/contact-custom-fields/new" className="ds-link-button">
              <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
              Nuevo campo
            </Link>
          )
        }
      />

      <div className="ds-list-card">
        <p className="ds-hint">
          Datos propios del negocio que se cargan en la ficha de cada contacto. El agente de IA los
          lee todos y escribe solo los marcados «editable por el agente». Hasta{" "}
          {MAX_CAMPOS_POR_ORGANIZACION} campos
          {fieldsQuery.isSuccess ? ` (${String(campos.length)} en uso)` : ""}.
        </p>

        {fieldsQuery.isLoading ? <LoadingState variant="rows" /> : null}

        {fieldsQuery.isError ? (
          <ErrorState>
            No pudimos cargar los campos
            {fieldsQuery.error instanceof Error ? `: ${fieldsQuery.error.message}` : "."}
          </ErrorState>
        ) : null}

        {deleteMutation.isError ? (
          <ErrorState>
            No pudimos eliminar el campo
            {deleteMutation.error instanceof Error ? `: ${deleteMutation.error.message}` : "."}
          </ErrorState>
        ) : null}

        {fieldsQuery.isSuccess && campos.length === 0 ? (
          <EmptyState title="Todavía no hay campos personalizados" icon={ListChecks} />
        ) : null}

        {fieldsQuery.isSuccess && campos.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>Etiqueta</th>
                <th>Clave</th>
                <th>Tipo</th>
                <th>Opciones</th>
                <th>Agente</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {campos.map((campo) => (
                <tr key={campo.id}>
                  <td className="ds-cell-primary">{campo.label}</td>
                  <td>
                    <code>{campo.key}</code>
                  </td>
                  <td>{TIPO_DE_CAMPO_LABEL[campo.type]}</td>
                  <td>{tieneOpciones(campo.type) ? campo.options.join(", ") : "—"}</td>
                  <td>
                    {campo.agentEditable ? (
                      <Badge variant="success">Puede editar</Badge>
                    ) : (
                      <Badge variant="neutral">Solo lee</Badge>
                    )}
                  </td>
                  <td>
                    <ActionsMenu
                      actions={[
                        { label: "Editar", to: `/contact-custom-fields/${campo.id}/edit` },
                        {
                          label: "Eliminar",
                          onClick: () => handleDelete(campo.id),
                          destructive: true,
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
    </div>
  );
}
