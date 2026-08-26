import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
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
    <form onSubmit={handleSubmit}>
      <h1>Invitar</h1>
      <label>
        Email
        <input
          type="email"
          value={values.email}
          onChange={(event) => setValues({ ...values, email: event.target.value })}
          required
        />
      </label>
      <label>
        Rol
        <select
          value={values.role}
          onChange={(event) =>
            setValues({ ...values, role: event.target.value as "ADMIN" | "USER" })
          }
        >
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={createInvitationMutation.isPending}>
        {createInvitationMutation.isPending ? "Enviando…" : "Enviar invitación"}
      </button>
    </form>
  );
}
