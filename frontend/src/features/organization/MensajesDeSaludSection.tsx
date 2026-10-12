import { useState } from "react";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { formatDateTime } from "../../design-system/detailFormat";
import { ErrorState } from "../../design-system/ErrorState";
import { FormField } from "../../design-system/FormField";
import { LoadingState } from "../../design-system/LoadingState";
import { Notice } from "../../design-system/Notice";
import { useToast } from "../../design-system/useToast";
import { useGuardarMensajesDeSalud } from "./mutations";
import { useMensajesDeSalud } from "./queries";
import { TerminosField } from "./TerminosField";
import type { MensajesDeSalud } from "./types";

const MAX_MENSAJE = 500;

// ---------------------------------------------------------------------------
// Mensajes de salud de una clínica (docs/rubros.md §5.3, D11 revisada el
// 2026-10-12). Una sección de Configuración → Organización, solo en una
// clínica (la página la muestra solo con industry CLINICA; la pantalla ya es
// solo ADMIN).
//
// TIENE SU PROPIO GUARDADO: es otra ruta del backend y cada guardado deja una
// fila de historial (quién y cuándo), así que no viaja con el "Guardar" de la
// página. Su botón es type="button" para no enviar el formulario de afuera.
//
// Los textos se muestran precargados con el de la clínica o, si no cargó uno,
// con el por defecto. Mandar el por defecto (o vacío) es lo mismo que null: la
// clínica vuelve a seguir el texto del código.
// ---------------------------------------------------------------------------
export function MensajesDeSaludSection() {
  const query = useMensajesDeSalud();

  return (
    <Card heading="Mensajes de salud">
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState>
          No pudimos cargar los mensajes de salud
          {query.error instanceof Error ? `: ${query.error.message}` : "."}
        </ErrorState>
      ) : null}
      {query.data ? (
        // La key reinicia el formulario con lo que devolvió el backend al
        // guardar (los términos vuelven normalizados).
        <FormularioDeMensajes
          key={JSON.stringify(valoresIniciales(query.data))}
          datos={query.data}
        />
      ) : null}
    </Card>
  );
}

interface Valores {
  urgencia: string;
  consulta: string;
  terminosDeUrgencia: string[];
  terminosClinicos: string[];
}

function valoresIniciales(datos: MensajesDeSalud): Valores {
  return {
    urgencia: datos.urgencyMessageText ?? datos.porDefecto.urgencyMessageText,
    consulta: datos.clinicalMessageText ?? datos.porDefecto.clinicalMessageText,
    terminosDeUrgencia: datos.extraUrgencyTerms,
    terminosClinicos: datos.extraClinicalTerms,
  };
}

function textoAEnviar(texto: string, porDefecto: string): string | null {
  const recortado = texto.trim();
  return recortado === "" || recortado === porDefecto ? null : recortado;
}

function FormularioDeMensajes({ datos }: { datos: MensajesDeSalud }) {
  const guardar = useGuardarMensajesDeSalud();
  const toast = useToast();
  const [valores, setValores] = useState<Valores>(() => valoresIniciales(datos));
  const [error, setError] = useState<string | null>(null);
  const { porDefecto } = datos;

  async function handleGuardar() {
    setError(null);
    try {
      await guardar.mutateAsync({
        urgencyMessageText: textoAEnviar(valores.urgencia, porDefecto.urgencyMessageText),
        clinicalMessageText: textoAEnviar(valores.consulta, porDefecto.clinicalMessageText),
        extraUrgencyTerms: valores.terminosDeUrgencia,
        extraClinicalTerms: valores.terminosClinicos,
      });
      toast.show("Mensajes de salud guardados");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar los mensajes de salud");
    }
  }

  return (
    <div className="ds-stack">
      <p className="ds-hint">
        Cuando un paciente escribe algo que parece una urgencia o una consulta clínica, el agente
        contesta con estos mensajes, sin usar la IA, y le pasa la conversación al equipo. Donde
        escribas {"{clinica}"} va el nombre de la clínica.
      </p>
      <Notice tone="warning" alert={false}>
        El contenido de estos mensajes es responsabilidad de la clínica.
      </Notice>

      <div className="ds-field-grid">
        <div className="ds-field-grid--full">
          <FormField label="Mensaje de urgencia">
            <textarea
              rows={3}
              maxLength={MAX_MENSAJE}
              value={valores.urgencia}
              onChange={(event) => setValores({ ...valores, urgencia: event.target.value })}
            />
          </FormField>
          <p className="ds-hint">Tiene que incluir un teléfono de emergencia (por ejemplo, 911).</p>
          {valores.urgencia !== porDefecto.urgencyMessageText ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setValores({ ...valores, urgencia: porDefecto.urgencyMessageText })}
            >
              Volver al texto por defecto
            </Button>
          ) : null}
        </div>
        <div className="ds-field-grid--full">
          <FormField label="Mensaje de consulta clínica">
            <textarea
              rows={3}
              maxLength={MAX_MENSAJE}
              value={valores.consulta}
              onChange={(event) => setValores({ ...valores, consulta: event.target.value })}
            />
          </FormField>
          {valores.consulta !== porDefecto.clinicalMessageText ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setValores({ ...valores, consulta: porDefecto.clinicalMessageText })}
            >
              Volver al texto por defecto
            </Button>
          ) : null}
        </div>
        <div className="ds-field-grid--full">
          <TerminosField
            label="Palabras que también son urgencia"
            value={valores.terminosDeUrgencia}
            onChange={(terminosDeUrgencia) => setValores({ ...valores, terminosDeUrgencia })}
          />
          <TerminosQueYaDetecta terminos={porDefecto.urgencyTerms} />
        </div>
        <div className="ds-field-grid--full">
          <TerminosField
            label="Palabras que también son consulta clínica"
            value={valores.terminosClinicos}
            onChange={(terminosClinicos) => setValores({ ...valores, terminosClinicos })}
          />
          <TerminosQueYaDetecta terminos={porDefecto.clinicalTerms} />
        </div>
      </div>

      <p className="ds-hint">
        {datos.ultimoCambio
          ? `Último cambio: ${datos.ultimoCambio.changedBy.fullName}, ${formatDateTime(datos.ultimoCambio.createdAt)}.`
          : "Todavía no se cambiaron: son los mensajes y las palabras por defecto."}
      </p>

      {error ? <ErrorState>{error}</ErrorState> : null}

      <div>
        <Button
          type="button"
          variant="primary"
          disabled={guardar.isPending}
          loading={guardar.isPending}
          onClick={() => void handleGuardar()}
        >
          {guardar.isPending ? "Guardando…" : "Guardar mensajes de salud"}
        </Button>
      </div>
    </div>
  );
}

function TerminosQueYaDetecta({ terminos }: { terminos: string[] }) {
  return (
    <details>
      <summary className="ds-hint">
        Ver las {terminos.length} que ya detecta (no se pueden sacar)
      </summary>
      <p className="ds-hint">{terminos.join(" · ")}</p>
    </details>
  );
}
