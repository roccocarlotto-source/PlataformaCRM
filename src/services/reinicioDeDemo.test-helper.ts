import type { OrgDePrueba, Respuesta } from "../routes/gateDeModulos.test-helper";

// El reinicio de una demo corre en segundo plano (reinicioDeDemo.service.ts):
// el POST responde 202 y el resultado se consulta con el GET del estado. Para
// los tests que necesitan el reinicio TERMINADO, esto hace el POST y espera.
//
// Devuelve la misma forma que devolvía el POST cuando era síncrono: 200 con
// { organizationId, borrados, cargados } si terminó bien; el rechazo del POST
// tal cual (400/404/409) si no arrancó; 500 con el estado si falló a mitad.
//
// Consulta cada 1,5 s: el GET pasa por businessWriteRateLimiter (100 por
// minuto por usuario), y un reinicio de test tarda bastante menos de un minuto.

type Pedir = (org: OrgDePrueba, metodo: string, path: string) => Promise<Respuesta>;

const INTERVALO_MS = 1500;
const TOPE_MS = 5 * 60 * 1000;

export const rutaDeReinicio = (organizationId: string) =>
  `/api/admin/organizations/${organizationId}/demo/reiniciar`;
export const rutaDelEstadoDelReinicio = (organizationId: string) =>
  `/api/admin/organizations/${organizationId}/demo/reinicio`;

/** Espera a que el reinicio en curso de esa demo termine; devuelve el estado. */
export async function esperarReinicio(
  pedir: Pedir,
  plataforma: OrgDePrueba,
  organizationId: string,
): Promise<Record<string, unknown>> {
  const limite = Date.now() + TOPE_MS;
  for (;;) {
    const res = await pedir(plataforma, "GET", rutaDelEstadoDelReinicio(organizationId));
    if (res.status !== 200)
      throw new Error(`GET del estado: ${res.status} ${JSON.stringify(res.json)}`);
    if (res.json.estado !== "REINICIANDO") return res.json;
    if (Date.now() > limite) throw new Error("El reinicio no terminó en 5 minutos");
    await new Promise((r) => setTimeout(r, INTERVALO_MS));
  }
}

export async function reiniciarYEsperar(
  pedir: Pedir,
  plataforma: OrgDePrueba,
  organizationId: string,
): Promise<Respuesta> {
  const res = await pedir(plataforma, "POST", rutaDeReinicio(organizationId));
  if (res.status !== 202) return res;
  const estado = await esperarReinicio(pedir, plataforma, organizationId);
  return estado.estado === "LISTO"
    ? { status: 200, json: estado.resultado as Record<string, unknown> }
    : { status: 500, json: estado };
}
