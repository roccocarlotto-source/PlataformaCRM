import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { useCreateInvitation } from "./mutations";
import type { CreateInvitationInput } from "./types";

interface InvitationFormValues {
  email: string;
  role: "ADMIN" | "USER";
}

const EMPTY_FORM: InvitationFormValues = { email: "", role: "USER" };

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

  const [values, setValues] = useState<InvitationFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const input: CreateInvitationInput = { email: values.email, role: values.role };
      await createInvitationMutation.mutateAsync(input);
      navigate("/invitations");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la invitación");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="ds-form">
      <h1>Invitar</h1>
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
              <FormField label="Rol">
                <select
                  value={values.role}
                  onChange={(event) =>
                    setValues({ ...values, role: event.target.value as "ADMIN" | "USER" })
                  }
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </FormField>
            </div>
          </div>
        </Card>
        {error ? <ErrorState>{error}</ErrorState> : null}
        <div>
          <Button type="submit" variant="primary" disabled={createInvitationMutation.isPending}>
            {createInvitationMutation.isPending ? "Enviando…" : "Enviar invitación"}
          </Button>
        </div>
      </div>
    </form>
  );
}
