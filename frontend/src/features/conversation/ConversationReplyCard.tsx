import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { Modal } from "../../design-system/Modal";
import { formatDateTime } from "../../design-system/detailFormat";
import { useReplyToConversation, useReturnConversationToAgent } from "./mutations";
import { puedeAtender } from "./permissions";
import type { ConversationDetail } from "./types";

// ---------------------------------------------------------------------------
// Responder desde el CRM (I-03 de
// docs-privados/auditoria-2026-09-24-punta-a-punta.md, local). Cuando el
// agente deriva, el vendedor contesta desde acá: el mensaje sale por WhatsApp
// desde el número del negocio, y mientras una persona atiende el agente no
// responde. "Devolver al agente" lo reactiva.
//
// ARCHIVO PROPIO, mismo criterio que ConversationBriefCard: tiene estado (el
// borrador) y dos mutaciones.
//
// QUÉ SE MUESTRA, en orden de prioridad:
//   - Cerrada: nada (una cerrada no se atiende; si el cliente vuelve a
//     escribir, se abre una nueva).
//   - Sin permiso: un aviso; responde el vendedor asignado o un ADMIN (el
//     backend lo vuelve a decidir con un 403).
//   - Otro canal que WhatsApp: un aviso (el chat web no recibe mensajes que no
//     sean la respuesta al suyo).
//   - Pasaron 24 h: el cuadro deshabilitado con la explicación de Meta.
//   - Si no: el cuadro para escribir.
// ---------------------------------------------------------------------------

export const AVISO_VENTANA_VENCIDA =
  "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite plantillas aprobadas.";

// "Devolver al agente" sin haberle respondido al cliente: el backend le manda
// el aviso fijo y deja la tarea pendiente (avisoSinRespuesta.service.ts), así
// que antes se confirma. En un Modal del design system con acción principal
// —el mismo patrón que la confirmación de AgentFormPage—, no un confirm()
// nativo: el panel no se cierra con un click afuera ni con Escape, así que
// devolver o no es siempre un click explícito.
export const CONFIRMAR_DEVOLVER_SIN_RESPONDER =
  "No le respondiste al cliente. Se le va a avisar que lo contactan más tarde y la tarea queda pendiente. ¿Devolver igual?";

export interface ConversationReplyCardProps {
  conversation: ConversationDetail;
  // Inyectable para los tests; en la pantalla, la hora real.
  ahora?: () => number;
}

export function ConversationReplyCard({
  conversation,
  ahora = () => Date.now(),
}: ConversationReplyCardProps) {
  const [texto, setTexto] = useState("");
  const [confirmandoDevolver, setConfirmandoDevolver] = useState(false);
  const { me } = useAuth();
  const responder = useReplyToConversation(conversation.id);
  const devolver = useReturnConversationToAgent(conversation.id);

  if (conversation.status === "CLOSED") {
    return null;
  }

  const atiende = puedeAtender(me, conversation);
  const esWhatsapp = conversation.channel === "WHATSAPP";
  const finDeVentana = conversation.replyWindowEndsAt
    ? Date.parse(conversation.replyWindowEndsAt)
    : null;
  const ventanaAbierta = finDeVentana !== null && ahora() < finDeVentana;
  const enCurso = responder.isPending || devolver.isPending;
  const puedeEscribir = atiende && esWhatsapp && ventanaAbierta;

  function enviar() {
    const limpio = texto.trim();
    if (limpio.length === 0) return;
    // El borrador se vacía solo si el request salió: si falló (403, 409, red),
    // lo escrito sigue ahí para no perderlo. Un rechazo de Meta NO es un fallo
    // del request: el mensaje ya está en el hilo con su reintento.
    responder.mutate(limpio, { onSuccess: () => setTexto("") });
  }

  // Derivada y con el agente sin pausar = ninguna persona le escribió desde la
  // derivación (agentPaused es humanoAtiendeLaConversacion, la misma regla que
  // usa el backend para decidir si avisa).
  const sinResponder = conversation.status === "TRANSFERRED_TO_HUMAN" && !conversation.agentPaused;

  function handleDevolver() {
    if (sinResponder) {
      setConfirmandoDevolver(true);
      return;
    }
    devolver.mutate();
  }

  function confirmarDevolver() {
    setConfirmandoDevolver(false);
    devolver.mutate();
  }

  function aviso(): string | null {
    if (!atiende) {
      return "Solo el vendedor asignado a esta conversación o un administrador pueden responderla.";
    }
    if (!esWhatsapp) {
      return "Por ahora solo se puede responder desde el CRM en conversaciones de WhatsApp.";
    }
    if (!ventanaAbierta) {
      return AVISO_VENTANA_VENCIDA;
    }
    return null;
  }
  const motivo = aviso();

  return (
    <Card heading="Responder">
      <div className="ds-stack">
        {conversation.agentPaused ? (
          <p className="ds-hint">
            El agente está en pausa: esta conversación la atiende una persona.
          </p>
        ) : null}

        {atiende && esWhatsapp ? (
          <label>
            <span className="ds-sr-only">Mensaje para el cliente</span>
            <textarea
              rows={3}
              value={texto}
              maxLength={4096}
              placeholder="Escribí tu respuesta…"
              onChange={(event) => setTexto(event.target.value)}
              disabled={!puedeEscribir || enCurso}
            />
          </label>
        ) : null}

        {motivo ? (
          <p className="ds-hint" role="note">
            {motivo}
          </p>
        ) : (
          <p className="ds-hint">
            Sale por WhatsApp desde el número del negocio. Mientras atiendas vos, el agente no
            responde. Podés escribir texto libre hasta el{" "}
            {formatDateTime(conversation.replyWindowEndsAt)}.
          </p>
        )}

        {atiende ? (
          <div className="ds-card-actions">
            {conversation.status === "TRANSFERRED_TO_HUMAN" ? (
              <Button onClick={handleDevolver} disabled={enCurso} loading={devolver.isPending}>
                {devolver.isPending ? "Devolviendo…" : "Devolver al agente"}
              </Button>
            ) : null}
            {esWhatsapp ? (
              <Button
                variant="primary"
                onClick={enviar}
                disabled={!puedeEscribir || enCurso || texto.trim().length === 0}
                loading={responder.isPending}
              >
                {responder.isPending ? "Enviando…" : "Enviar"}
              </Button>
            ) : null}
          </div>
        ) : null}

        {responder.error ? (
          <ErrorState>
            No se pudo enviar
            {responder.error instanceof Error ? `: ${responder.error.message}` : "."}
          </ErrorState>
        ) : null}
        {confirmandoDevolver ? (
          <Modal
            title="Devolver al agente"
            closeLabel="Cancelar"
            onClose={() => setConfirmandoDevolver(false)}
            primaryAction={{ label: "Devolver igual", onClick: confirmarDevolver }}
          >
            <p>{CONFIRMAR_DEVOLVER_SIN_RESPONDER}</p>
          </Modal>
        ) : null}
        {devolver.error ? (
          <ErrorState>
            No pudimos devolverle la conversación al agente
            {devolver.error instanceof Error ? `: ${devolver.error.message}` : "."}
          </ErrorState>
        ) : null}
      </div>
    </Card>
  );
}
