import { useRef } from "react";
import { QrCode } from "lucide-react";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { env } from "../../config/env";
import {
  ACTION_BOOKING_SEND_REMINDER,
  ACTION_SEND_DISCOUNT_VOUCHER,
  ACTION_SEND_NEXT_SERVICE_REMINDER,
  BOTONES_DEL_RECORDATORIO,
  ESTADOS_DE_APROBACION,
  FORMATOS_DE_MENSAJE,
  formatoLlevaImagen,
  mensajeDeLaAccion,
  textoParaFormato,
  type ConfigDraft,
} from "./catalog";
import { useRefreshWhatsappApproval, useRetryWhatsappTemplate } from "./mutations";
import type { WhatsappApproval, WhatsappSync } from "./types";
import {
  EJEMPLO_LINK,
  EJEMPLO_LUGAR_DEL_TALLER,
  EJEMPLO_VEHICULO_DEL_TALLER,
  insertarToken,
  previewDePlantilla,
} from "./whatsappPreview";

// H-1: el día y la hora del próximo intento, en la hora del navegador.
function cuando(iso: string): string {
  return new Date(iso).toLocaleString("es-UY", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// H-1: el último intento de mandar el mensaje a aprobación falló. Si WhatsApp
// no respondió, se reintenta solo; si lo rechazó, no. En los dos casos se
// puede reintentar a mano.
function SincronizacionDeWhatsapp({
  sync,
  automationId,
}: {
  sync: WhatsappSync;
  automationId: string;
}) {
  const retry = useRetryWhatsappTemplate(automationId);
  const texto =
    sync.estado === "REINTENTANDO"
      ? `No se pudo mandar a aprobación de WhatsApp: ${sync.motivo} Se reintenta solo${
          sync.proximoIntento ? ` (próximo intento: ${cuando(sync.proximoIntento)})` : ""
        }.`
      : sync.estado === "DETENIDO"
        ? `No se pudo mandar a aprobación de WhatsApp después de varios intentos: ${sync.motivo}`
        : `WhatsApp rechazó el mensaje: ${sync.motivo} Revisá el texto y guardá la regla, o reintentá.`;
  return (
    <div className="ds-stack">
      <ErrorState>{texto}</ErrorState>
      <div>
        <Button onClick={() => retry.mutate()} disabled={retry.isPending} loading={retry.isPending}>
          Reintentar
        </Button>
      </div>
      {retry.isError ? (
        <ErrorState>
          {retry.error instanceof Error ? retry.error.message : "No pudimos reintentar."}
        </ErrorState>
      ) : null}
    </div>
  );
}

// El estado de aprobación de WhatsApp de la regla: UNA línea, el de la versión
// más nueva del mensaje. La plantilla de Meta no aparece por ningún lado: el
// negocio solo necesita saber si ya puede salir.
function AprobacionDeWhatsapp({
  approval,
  sync,
  automationId,
}: {
  approval: WhatsappApproval | null | undefined;
  sync: WhatsappSync | null | undefined;
  automationId: string | undefined;
}) {
  const refresh = useRefreshWhatsappApproval(automationId ?? "");

  // Regla nueva (o una respuesta vieja sin el dato): todavía no hay nada que
  // mostrar más que el aviso de que no sale hasta que WhatsApp lo apruebe.
  if (!approval || !automationId) {
    return <p className="ds-hint">No se manda hasta que WhatsApp lo apruebe.</p>;
  }

  const estado = ESTADOS_DE_APROBACION[approval.estado];
  return (
    <div className="ds-stack">
      <p>
        Aprobación de WhatsApp: <Badge variant={estado.variant}>{estado.label}</Badge>
        {approval.estado === "RECHAZADA" && approval.motivo ? ` (${approval.motivo})` : null}
      </p>
      {approval.mandaLaAnterior ? (
        <p className="ds-hint">Mientras tanto se sigue mandando el mensaje anterior.</p>
      ) : null}
      {sync ? <SincronizacionDeWhatsapp sync={sync} automationId={automationId} /> : null}
      {approval.estado === "PENDIENTE" ? (
        <div>
          <Button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            loading={refresh.isPending}
          >
            Consultar estado
          </Button>
        </div>
      ) : null}
      {refresh.isError ? (
        <ErrorState>
          {refresh.error instanceof Error
            ? refresh.error.message
            : "No pudimos consultar el estado."}
        </ErrorState>
      ) : null}
    </div>
  );
}

// Cómo le llega al cliente: la imagen del QR arriba (si el formato la lleva)
// y el texto con un nombre y un link de ejemplo.
function VistaPrevia({ actionType, values }: { actionType: string; values: ConfigDraft }) {
  const formato = values.whatsappFormat ?? "LINK";
  const link =
    actionType === ACTION_SEND_DISCOUNT_VOUCHER ? `${env.qrPublicBaseUrl}/v/…` : EJEMPLO_LINK;
  return (
    <div className="ds-stack">
      <span className="ds-field-label">Vista previa</span>
      <div className="ds-chat-bubble" aria-label="Vista previa del mensaje">
        {formatoLlevaImagen(formato) ? (
          <div className="ds-chat-bubble-image">
            <QrCode size={40} strokeWidth={1.5} aria-hidden="true" />
            <span>
              {actionType === ACTION_SEND_DISCOUNT_VOUCHER
                ? "Imagen del QR del cupón"
                : "Imagen del QR"}
            </span>
          </div>
        ) : null}
        {previewDePlantilla(
          values.messageText ?? "",
          link,
          // S7: los ejemplos de un taller.
          actionType === ACTION_SEND_NEXT_SERVICE_REMINDER
            ? { lugar: EJEMPLO_LUGAR_DEL_TALLER, vehiculo: EJEMPLO_VEHICULO_DEL_TALLER }
            : {},
        ) || "…"}
      </div>
      {/* R13: los botones que agrega la plantilla del recordatorio. */}
      {actionType === ACTION_BOOKING_SEND_REMINDER ? (
        <p className="ds-hint">
          Con los botones: {BOTONES_DEL_RECORDATORIO.map((b) => `«${b}»`).join(" y ")}.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// El mensaje de WhatsApp de una regla que manda uno (el QR y el cupón):
// formato, texto, vista previa y estado de aprobación. Es lo único que el
// negocio ve de la plantilla de Meta: al guardar la regla, el backend la crea
// o la reemplaza solo (automationWhatsapp.service.ts). Hasta acá eso vivía en
// una pantalla aparte, "Plantillas de WhatsApp", que se retiró.
// ---------------------------------------------------------------------------
export function MensajeDeWhatsappCard({
  actionType,
  values,
  onChange,
  disabled,
  approval,
  sync,
  automationId,
  esClinica = false,
}: {
  actionType: string;
  values: ConfigDraft;
  onChange: (values: ConfigDraft) => void;
  disabled: boolean;
  approval: WhatsappApproval | null | undefined;
  // H-1: el último intento de mandarlo a aprobación, si falló.
  sync?: WhatsappSync | null;
  automationId: string | undefined;
  // R15: en una clínica, {prestacion} en lugar de {vehiculo}.
  esClinica?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formato = values.whatsappFormat ?? "LINK";
  // Qué variables lleva este mensaje y si elige formato (ítem 185: el
  // seguimiento de una consulta es solo texto, con {saludo} y {vehiculo}).
  const mensaje = mensajeDeLaAccion(actionType, formato, esClinica);

  function insertar(token: string) {
    const textarea = textareaRef.current;
    const texto = values.messageText ?? "";
    const seleccion = textarea
      ? { inicio: textarea.selectionStart, fin: textarea.selectionEnd }
      : { inicio: texto.length, fin: texto.length };
    const resultado = insertarToken(texto, token, seleccion);
    onChange({ ...values, messageText: resultado.texto });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(resultado.cursor, resultado.cursor);
    });
  }

  return (
    <Card heading="Mensaje de WhatsApp">
      <div className="ds-field-grid">
        {/* Radios en tarjeta, como el canal de QrSendDialog: la ayuda va como
            HERMANA del <label> para no entrar en el nombre accesible. Solo en
            las acciones que eligen formato. */}
        {mensaje.conFormato ? (
          <div className="ds-field ds-field-grid--full">
            <span className="ds-field-label">Formato</span>
            <div className="ds-radio-cards" role="radiogroup" aria-label="Formato del mensaje">
              {FORMATOS_DE_MENSAJE.map((opcion) => (
                <div className="ds-radio-card" key={opcion.value}>
                  <label>
                    <input
                      type="radio"
                      name="automation-whatsapp-format"
                      checked={formato === opcion.value}
                      onChange={() =>
                        onChange({
                          ...values,
                          whatsappFormat: opcion.value,
                          messageText: textoParaFormato(
                            actionType,
                            values.messageText ?? "",
                            opcion.value,
                          ),
                        })
                      }
                      disabled={disabled}
                    />{" "}
                    {opcion.label}
                  </label>
                  <p className="ds-radio-card-hint">{opcion.subtitle}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="ds-field-grid--full">
          <FormField label={<span className="ds-required">Texto del mensaje</span>}>
            <textarea
              ref={textareaRef}
              value={values.messageText ?? ""}
              rows={5}
              onChange={(event) => onChange({ ...values, messageText: event.target.value })}
              disabled={disabled}
              required
            />
          </FormField>
        </div>
        <div className="ds-field-grid--full ds-card-actions">
          {mensaje.variables.map((variable) => (
            <Button
              key={variable.token}
              onClick={() => insertar(variable.token)}
              disabled={disabled}
            >
              Insertar {variable.token}
            </Button>
          ))}
        </div>
        <p className="ds-hint ds-field-grid--full">
          Ninguna variable puede ir al principio ni al final del texto.
        </p>

        <div className="ds-field-grid--full">
          <VistaPrevia actionType={actionType} values={values} />
        </div>

        <div className="ds-field-grid--full">
          <AprobacionDeWhatsapp approval={approval} sync={sync} automationId={automationId} />
        </div>
      </div>
    </Card>
  );
}
