import { useState } from "react";
import { Button } from "../../design-system/Button";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { Modal } from "../../design-system/Modal";
import { buildPublicResolutionUrl } from "../../lib/publicUrl";
import {
  buildEmailMessageForCopy,
  buildMailtoLink,
  buildWhatsAppLink,
  normalizeWhatsAppNumber,
  openPreparedMessage,
} from "../../lib/sendQr";
import type { QrCode } from "./types";

// ---------------------------------------------------------------------------
// "Enviar QR" (Cycle 16/23 del original, DEC-049..052): mensaje preparado
// que se abre en el dispositivo del dueño — sin llamada de red en ningún
// punto de este componente, y el dato de contacto nunca se persiste
// (DEC-051): solo vive en `contacto`, y desaparece al cerrar el diálogo.
//
// El mensaje custom del QR (si existe) viaja junto con el link PÚBLICO de
// resolución — nunca con destinationUrl, que sendQr.ts ni siquiera recibe.
// ---------------------------------------------------------------------------

type Canal = "whatsapp" | "email";

export interface QrSendDialogProps {
  qr: QrCode;
  onClose: () => void;
}

export function QrSendDialog({ qr, onClose }: QrSendDialogProps) {
  const [canal, setCanal] = useState<Canal>("whatsapp");
  const [contacto, setContacto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  function cambiarCanal(nuevo: Canal) {
    setCanal(nuevo);
    setCopiado(false);
    setError(null);
  }

  function urlPublica(): string | null {
    try {
      return buildPublicResolutionUrl(qr.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo construir el link.");
      return null;
    }
  }

  function handleSend() {
    setError(null);
    const url = urlPublica();
    if (url === null) return;

    if (canal === "whatsapp") {
      if (!normalizeWhatsAppNumber(contacto)) {
        setError("Ingresá un número de WhatsApp.");
        return;
      }
      openPreparedMessage(buildWhatsAppLink(contacto, url, qr.message));
      onClose();
      return;
    }

    if (!contacto.trim()) {
      setError("Ingresá un email.");
      return;
    }
    openPreparedMessage(buildMailtoLink(contacto.trim(), url, qr.message));
    // A diferencia de WhatsApp, mailto: falla en silencio si el dispositivo
    // no tiene cliente de correo por defecto (Hallazgo 2, Cycle 23) — el
    // diálogo queda abierto para que "Copiar mensaje" siga a mano como
    // respaldo, en vez de cerrarse tras una acción que quizás no funcionó.
  }

  // Respaldo cliente-only para cuando mailto: no abre nada: copia exactamente
  // el mismo mensaje que buildMailtoLink mandaría, como texto plano.
  async function handleCopyMessage() {
    setError(null);
    const url = urlPublica();
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(buildEmailMessageForCopy(url, qr.message));
      setCopiado(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo copiar el mensaje.");
    }
  }

  const titulo = `Enviar QR ${qr.displayNumber ?? "—"}${qr.name ? ` — ${qr.name}` : ""}`;

  return (
    <Modal title={titulo} onClose={onClose} closeLabel="Cancelar">
      {/* Radios en tarjeta (.ds-radio-card, mismo trato que "Tipo de QR" en
          QrFormDialog). La línea de ayuda va como HERMANA del <label>, nunca
          adentro: si no, entraría en el nombre accesible del radio y
          getByRole("radio", { name: "Email" }) dejaría de encontrarlo. Cada
          ayuda describe lo que handleSend hace de verdad con ese canal. */}
      <div className="ds-field">
        <span className="ds-field-label">Canal</span>
        <div className="ds-radio-cards" role="radiogroup" aria-label="Canal de envío">
          <div className="ds-radio-card">
            <label>
              <input
                type="radio"
                name="qr-send-channel"
                checked={canal === "whatsapp"}
                onChange={() => cambiarCanal("whatsapp")}
              />{" "}
              WhatsApp
            </label>
            <p className="ds-radio-card-hint">Se abre WhatsApp con el mensaje ya armado.</p>
          </div>
          <div className="ds-radio-card">
            <label>
              <input
                type="radio"
                name="qr-send-channel"
                checked={canal === "email"}
                onChange={() => cambiarCanal("email")}
              />{" "}
              Email
            </label>
            <p className="ds-radio-card-hint">
              Se abre tu cliente de correo con el mensaje ya armado.
            </p>
          </div>
        </div>
      </div>
      <FormField label={canal === "whatsapp" ? "Número de WhatsApp (con código de país)" : "Email"}>
        <input
          type={canal === "whatsapp" ? "tel" : "email"}
          value={contacto}
          onChange={(event) => setContacto(event.target.value)}
          placeholder={canal === "whatsapp" ? "096468788" : "cliente@ejemplo.com"}
        />
      </FormField>
      {error ? <ErrorState>{error}</ErrorState> : null}
      <Button variant="primary" onClick={handleSend}>
        {canal === "whatsapp" ? "Abrir WhatsApp" : "Abrir email"}
      </Button>{" "}
      {canal === "email" ? (
        <Button onClick={() => void handleCopyMessage()}>
          {copiado ? "¡Copiado!" : "Copiar mensaje"}
        </Button>
      ) : null}
    </Modal>
  );
}
