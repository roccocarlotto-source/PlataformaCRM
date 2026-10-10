import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../design-system/PageHeader";
import { AYUDA } from "../guia/anclas";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { RequiredFieldsHint } from "../../design-system/RequiredFieldsHint";
import { Select } from "../../design-system/Select";
import { useCreateInvitation } from "./mutations";
import type { CreateInvitationInput } from "./types";
import { useAuth, type RoleName } from "../../auth/AuthContext";
import { roleLabel, rolesAsignables, rolOperativo } from "../user/roles";
import { SedesSelect } from "../clinica/SedesSelect";

interface InvitationFormValues {
  email: string;
  role: RoleName;
}

// Únicamente create — sin edit (Invitation no se edita, ver informe de
// diseño). email + role son los dos únicos campos reales de
// CreateInvitationInput; organizationId nunca es un campo de este form.
//
// Restyle con criterio propio (sin export): el esqueleto de los formularios
// migrados (.ds-form + Card + .ds-field-grid), como PipelineFormPage. El "*"
// va en Email porque el input lleva `required`; los rótulos ("Email",
// "Rol"), el texto del botón y los mensajes de error del backend no cambian.
export function InvitationFormPage() {
  const navigate = useNavigate();
  const createInvitationMutation = useCreateInvitation();
  // Los roles del rubro (R12, docs/rubros.md §11.1): en una automotora Usuario
  // y Administrador, como siempre; en una clínica Recepción y Administrador.
  // Preseleccionado, el que no es ADMIN.
  const { me } = useAuth();
  const roles = rolesAsignables(me);

  const [values, setValues] = useState<InvitationFormValues>({
    email: "",
    role: rolOperativo(roles),
  });
  const [error, setError] = useState<string | null>(null);
  // R20: las sedes de una Recepción de clínica (obligatorias). En una
  // automotora el campo no existe.
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const pideSedes = me?.industry === "CLINICA" && values.role === "RECEPCION";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const input: CreateInvitationInput = {
        email: values.email,
        role: values.role,
        ...(pideSedes ? { branchIds } : {}),
      };
      await createInvitationMutation.mutateAsync(input);
      navigate("/invitations");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear la invitación");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <PageHeader help={AYUDA.invitar} title="Invitar" />
      <div className="ds-stack">
        <Card heading="Datos de la invitación">
          <div className="ds-field-grid">
            <div className="ds-field-grid--full">
              <FormField label={<span className="ds-required">Email</span>}>
                <input
                  type="email"
                  value={values.email}
                  onChange={(event) => setValues({ ...values, email: event.target.value })}
                  required
                />
              </FormField>
            </div>
            <div className="ds-field-grid--full">
              {/* Suelto, sin FormField: Select trae su propio <label htmlFor>
                  y FormField ES un <label>. */}
              <Select
                label="Rol"
                value={values.role}
                options={[...roles.filter((rol) => rol !== "ADMIN"), "ADMIN" as const].map(
                  (rol) => ({ value: rol, label: roleLabel(rol) }),
                )}
                onChange={(role) => {
                  if (role) setValues({ ...values, role });
                }}
              />
            </div>
            {pideSedes ? (
              <div className="ds-field-grid--full">
                <SedesSelect id="invitation-sedes" value={branchIds} onChange={setBranchIds} />
              </div>
            ) : null}
          </div>
        </Card>
        {error ? <ErrorState>{error}</ErrorState> : null}
        <div>
          <RequiredFieldsHint />
          <Button
            type="submit"
            variant="primary"
            disabled={createInvitationMutation.isPending || (pideSedes && branchIds.length === 0)}
            loading={createInvitationMutation.isPending}
          >
            {createInvitationMutation.isPending ? "Enviando…" : "Enviar invitación"}
          </Button>
        </div>
      </div>
    </form>
  );
}
