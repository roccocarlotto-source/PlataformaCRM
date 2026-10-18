import { useEffect, useRef } from "react";
import { Button } from "../../design-system/Button";
import { useConfirm } from "../../design-system/useConfirm";
import { CONFIRMACION_DEL_REINICIO, CONFIRMACION_DEL_REINICIO_DEL_TALLER } from "./clinicaDemo";
import { useReiniciarDatosDeLaDemo } from "./mutations";
import { useEstadoDelReinicioDeLaDemo } from "./queries";
import type { PlatformOrganization, ReinicioDeLaDemo } from "./types";

// ---------------------------------------------------------------------------
// "Reiniciar datos de demo" en la fila de una demo (docs/rubros.md §12.3,
// docs/taller-demo.md §4). El reinicio corre en segundo plano
// (src/services/reinicioDeDemo.service.ts): el botón lo arranca, consulta el
// estado de ESA demo mientras está REINICIANDO y le pasa a la pantalla qué
// mostrar: "Reiniciando…", el resumen al terminar, o el motivo si falló.
//
// El botón queda deshabilitado mientras corre, también si se recarga la
// página en medio (el estado se pide al montar). Si el servidor se reinicia
// en medio, el estado vuelve a NINGUNO y se dice que no sabemos cómo terminó.
// ---------------------------------------------------------------------------

export interface AvisoDelReinicio {
  tipo: "status" | "error";
  texto: string;
}

function resumen(org: PlatformOrganization, cargados: ReinicioDeLaDemo["cargados"]): string {
  return org.industry === "CLINICA"
    ? `Reiniciamos «${org.name}»: ${cargados.pacientes ?? 0} pacientes y ${cargados.turnosProximos ?? 0} turnos próximos de ejemplo, más ${cargados.turnosAtendidos ?? 0} atendidos la semana pasada.`
    : `Reiniciamos «${org.name}»: ${cargados.contactos ?? 0} contactos, ${cargados.unidades ?? 0} unidades, ${cargados.oportunidades ?? 0} oportunidades, ${cargados.vehiculosDeClientes ?? 0} vehículos de clientes y ${cargados.ordenes ?? 0} órdenes de taller de ejemplo.`;
}

export function BotonDeReinicioDeLaDemo({
  org,
  avisar,
  alEmpezar,
}: {
  org: PlatformOrganization;
  avisar: (aviso: AvisoDelReinicio) => void;
  alEmpezar: () => void;
}) {
  const confirm = useConfirm();
  const reiniciar = useReiniciarDatosDeLaDemo();
  const estado = useEstadoDelReinicioDeLaDemo(org.id);
  // true desde que se vio esta demo REINICIANDO: el final (LISTO, FALLO o el
  // estado perdido) se avisa una vez, y no el de un reinicio de otro día.
  const siguiendo = useRef(false);

  useEffect(() => {
    const actual = estado.data;
    if (!actual) return;
    if (actual.estado === "REINICIANDO") {
      siguiendo.current = true;
      avisar({
        tipo: "status",
        texto: `Reiniciando «${org.name}»… Tarda unos tres minutos; podés seguir usando la plataforma.`,
      });
      return;
    }
    if (!siguiendo.current) return;
    siguiendo.current = false;
    if (actual.estado === "LISTO") {
      avisar({ tipo: "status", texto: resumen(org, actual.resultado.cargados) });
    } else if (actual.estado === "FALLO") {
      avisar({ tipo: "error", texto: `No se pudo reiniciar «${org.name}»: ${actual.mensaje}` });
    } else {
      avisar({
        tipo: "error",
        texto: `No sabemos cómo terminó el reinicio de «${org.name}»: el servidor se reinició mientras corría. Revisá los datos o reiniciá de nuevo.`,
      });
    }
  }, [estado.data, org, avisar]);

  async function empezar() {
    alEmpezar();
    const ok = await confirm(
      `¿Reiniciar los datos de «${org.name}»? ${
        org.industry === "CLINICA"
          ? CONFIRMACION_DEL_REINICIO
          : CONFIRMACION_DEL_REINICIO_DEL_TALLER
      }`,
      { confirmLabel: "Reiniciar datos", danger: true },
    );
    if (!ok) return;
    // Antes del POST: el estado puede pasar de REINICIANDO al final sin que se
    // llegue a pintar el paso intermedio, y el final igual tiene que avisarse.
    siguiendo.current = true;
    try {
      await reiniciar.mutateAsync(org.id);
    } catch (err) {
      siguiendo.current = false;
      avisar({
        tipo: "error",
        texto: err instanceof Error ? err.message : "No pudimos reiniciar los datos de la demo",
      });
    }
  }

  return (
    <Button
      type="button"
      variant="danger"
      onClick={() => void empezar()}
      disabled={reiniciar.isPending || estado.data?.estado === "REINICIANDO"}
    >
      Reiniciar datos de demo
    </Button>
  );
}
