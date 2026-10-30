import { getOpportunityById } from "./opportunity.service";
import { assertPuedeEditar, type Actor } from "./permisosDelVendedor";

// ---------------------------------------------------------------------------
// COTIZAR Y COBRAR SOBRE UNA OPORTUNIDAD — PR-17 (QA-A-09 de
// docs-privados/auditoria-2026-10-21, local). Decisión de Rocco, 29/10 y
// 30/10/2026: el vendedor (USER) cotiza (crear, editar el borrador, enviar,
// marcar aceptada o rechazada) y registra pagos, pero solo en las
// oportunidades que tiene asignadas. Revertir una aceptación, corregir y
// borrar pagos, y la entrega siguen siendo de ADMIN (esas rutas y ramas
// conservan su chequeo de rol).
//
// Es la misma regla que editar la oportunidad (permisosDelVendedor.ts, D2):
// quien puede editarla puede cotizarla y cobrarla. Un ADMIN no consulta nada:
// las rutas con presupuesto de consultas no cambian para él.
// ---------------------------------------------------------------------------
export async function assertPuedeOperarLaOportunidad(
  actor: Actor,
  organizationId: string,
  opportunityId: string,
): Promise<void> {
  if (actor.role === "ADMIN") {
    return;
  }
  const opportunity = await getOpportunityById(organizationId, opportunityId);
  assertPuedeEditar(actor, opportunity, undefined, "editar_cualquier_oportunidad");
}
