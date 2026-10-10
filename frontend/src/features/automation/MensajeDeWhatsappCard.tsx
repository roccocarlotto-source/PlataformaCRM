import { useRef } from "react";
import { QrCode } from "lucide-react";
import { Badge } from "../../design-system/Badge";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { env } from "../../config/env";
import {
  ACTION_SEND_DISCOUNT_VOUCHER,
  ESTADOS_DE_APROBACION,
  FORMATOS_DE_MENSAJE,
  formatoLlevaImagen,
  mensajeDeLaAccion,
  textoParaFormato,
  type ConfigDraft,
} from "./catalog";
import { useRefreshWhatsappApproval } from "./mutations";
import type { WhatsappApproval } from "./types";
import { EJEMPLO_LINK, insertarToken, previewDePlantilla } from "./whatsappPreview";

// El estado de aprobación de WhatsApp de la regla: UNA línea, el de la versión
// más nueva del mensaje. La plantilla de Meta no aparece por ningún lado: el
// negocio solo necesita saber si ya puede salir.
function AprobacionDeWhatsapp({
  approval,
  automationId,
}: {
  approval: WhatsappApproval | null | undefined;
  automationId: string | undefined;
}) {
  const refresh = useRefreshWhatsappApproval(automationId ?? "");

  // Regla nueva (o una respuesta vieja sin el dato): todavía no hay nada que
  // mostrar más que lo que va a pasar al guardar.
  if (!approval || !automationId) {
    return (
      <p className="ds-hint">
        Al guardar se manda a aprobar a WhatsApp; puede tardar hasta un día.
      </p>
    );
  }

  const estado = ESTADOS_DE_APROBACION[approval.estado];
  return (
    <div className="ds-stack">
      <p>
        Aprobación de WhatsApp: <Badge variant={estado.variant}>{estado.label}</Badge>
        {approval.estado === "RECHAZADA" && approval.motivo ? ` (${approval.motivo})` : null}
      </p>
      {approval.mandaLaAnterior ? (
        <p className="ds-hint">
          Mientras WhatsApp revisa el mensaje nuevo, se sigue mandando el anterior, que ya estaba
          aprobado.
        </p>
      ) : null}
      {approval.estado === "RECHAZADA" ? (
        <p className="ds-hint">Cambiá el texto y guardá la regla para mandarlo de nuevo.</p>
      ) : null}
      {approval.estado === "SIN_PLANTILLA" ? (
        <p className="ds-hint">Se manda a aprobar cuando guardes la regla.</p>
      ) : null}
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
        {previewDePlantilla(values.messageText ?? "", link) || "…"}
      </div>
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
  automationId,
  esClinica = false,
}: {
  actionType: string;
  values: ConfigDraft;
  onChange: (values: ConfigDraft) => void;
  disabled: boolean;
  approval: WhatsappApproval | null | undefined;
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
        <div className="ds-field-grid--full">
          {mensaje.variables.map((variable) => (
            <span key={variable.token}>
              <Button onClick={() => insertar(variable.token)} disabled={disabled}>
                Insertar {variable.token}
              </Button>{" "}
            </span>
          ))}
        </div>
        <p className="ds-hint ds-field-grid--full">
          {mensaje.variables
            .map(
              (variable) =>
                `Escribí ${variable.token} donde va ${variable.ayuda}${variable.obligatoria ? "" : " (opcional)"}`,
            )
            .join("; ")}
          . Ninguna variable puede ir al principio ni al final del texto (regla de WhatsApp).
        </p>

        <div className="ds-field-grid--full">
          <VistaPrevia actionType={actionType} values={values} />
        </div>

        <div className="ds-field-grid--full">
          <AprobacionDeWhatsapp approval={approval} automationId={automationId} />
        </div>
      </div>
    </Card>
  );
}
