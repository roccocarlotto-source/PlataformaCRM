import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { looksLikeUrl } from "../../lib/validation";
import { BranchSelect } from "../branch/BranchSelect";
import { useClaimQrCode } from "./mutations";
import type { QrCode } from "./types";

// ---------------------------------------------------------------------------
// Reclamar un QR físico — la página a la que lleva el link "¿Sos el dueño...?"
// de la landing pública (src/utils/qrLanding.ts arma
// `${QR_CLAIM_APP_URL}/claim/${qrId}`; la ruta es fija, decisión 3 de Fase 3).
//
// Ya no es "confirmar con un botón" como Claim.tsx del original (decisión 4):
// POST /api/qr/claim pide branchId + name + destinationUrl explícitos, así
// que es un formulario completo, el mismo shape que crear un QR digital pero
// sin tipo (un físico es siempre REUSABLE).
//
// CÓMO SOBREVIVE /claim/:qrId AL LOGIN (decisión 7, verificada en el código):
// ProtectedRoute redirige con `state={{ from: location }}` y LoginPage vuelve
// a `from.pathname` en cuanto la sesión existe — el qrId viaja en la URL, así
// que no hace falta sessionStorage ni nada extra. Por eso esta página vive
// dentro de ProtectedRoute.
//
// EL CHEQUEO DE ROL ES INTERNO, NO DE RUTA (decisión 8): AdminRoute redirige
// a /companies y perdería el qrId. Un USER ve el mensaje de abajo en vez de
// un formulario que el backend rechazaría con 403 igual.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ClaimFormValues {
  branchId: string | undefined;
  name: string;
  destinationUrl: string;
  message: string;
}

const EMPTY_FORM: ClaimFormValues = {
  branchId: undefined,
  name: "",
  destinationUrl: "",
  message: "",
};

function validar(values: ClaimFormValues): string | null {
  if (!values.branchId) return "Elegí la sucursal a la que va a pertenecer este QR.";
  if (!values.name.trim()) return "El nombre del QR es obligatorio.";
  if (!looksLikeUrl(values.destinationUrl.trim())) {
    return "Pegá una URL de destino válida (tiene que empezar con http:// o https://).";
  }
  return null;
}

export function ClaimPage() {
  const { qrId } = useParams<{ qrId: string }>();
  const { me } = useAuth();
  const claimMutation = useClaimQrCode();

  const [values, setValues] = useState<ClaimFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [reclamado, setReclamado] = useState<QrCode | null>(null);

  if (me?.role !== "ADMIN") {
    return (
      <div>
        <h1>Reclamar código QR</h1>
        <p>Necesitás iniciar sesión como administrador de tu cuenta para reclamar este QR.</p>
      </div>
    );
  }

  // Un id que no es uuid no puede ser un sticker real: el backend contestaría
  // 400 ("qrId inválido"); se corta antes con el MISMO copy genérico que un
  // id ya reclamado — nunca se distingue "malformado" de "ya reclamado" de
  // "no existe" (DEC-007, mismo criterio que el backend).
  if (!qrId || !UUID_RE.test(qrId)) {
    return (
      <div>
        <h1>Reclamar código QR</h1>
        <ErrorState>QR ya reclamado o no existe</ErrorState>
      </div>
    );
  }

  if (reclamado) {
    return (
      <div>
        <h1>¡Listo!</h1>
        <p>
          El código QR ya está vinculado a tu cuenta como{" "}
          <strong>
            QR {reclamado.displayNumber ?? "—"}
            {reclamado.name ? ` — ${reclamado.name}` : ""}
          </strong>
          .
        </p>
        <p>
          <Link to="/qr" className="ds-link-button">
            Ir a mis códigos QR
          </Link>
        </p>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validar(values);
    setError(validationError);
    if (validationError || !qrId) return;
    try {
      const qr = await claimMutation.mutateAsync({
        qrId,
        branchId: values.branchId ?? "",
        name: values.name.trim(),
        destinationUrl: values.destinationUrl.trim(),
        message: values.message.trim() || null,
      });
      setReclamado(qr);
    } catch (err) {
      // El 409 del backend ya trae el mensaje genérico ("QR ya reclamado o no
      // existe"); se muestra tal cual, sin reinterpretarlo.
      setError(err instanceof Error ? err.message : "No se pudo reclamar el QR.");
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1>Reclamar código QR</h1>
      <p>
        Vas a vincular este código QR a una sucursal de tu cuenta. Elegí la sucursal y a dónde tiene
        que llevar cuando alguien lo escanee.
      </p>
      <BranchSelect
        id="claim-branch"
        label="Sucursal"
        value={values.branchId}
        onChange={(branchId) => setValues({ ...values, branchId: branchId || undefined })}
      />
      <FormField label="Nombre">
        <input
          type="text"
          value={values.name}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
          placeholder="Reseñas Google"
          maxLength={80}
        />
      </FormField>
      <FormField label="Enlace de destino">
        <input
          type="url"
          value={values.destinationUrl}
          onChange={(event) => setValues({ ...values, destinationUrl: event.target.value })}
          placeholder="https://search.google.com/local/writereview?placeid=..."
          maxLength={2048}
        />
      </FormField>
      <FormField label="Mensaje (opcional)">
        <textarea
          value={values.message}
          onChange={(event) => setValues({ ...values, message: event.target.value })}
          placeholder="¡Gracias por elegirnos! Nos ayudaría mucho conocer tu opinión."
          maxLength={500}
        />
      </FormField>
      {error ? <ErrorState>{error}</ErrorState> : null}
      <Button type="submit" variant="primary" disabled={claimMutation.isPending}>
        {claimMutation.isPending ? "Reclamando…" : "Reclamar QR"}
      </Button>
    </form>
  );
}
