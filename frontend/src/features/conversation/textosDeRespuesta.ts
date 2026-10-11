// Los textos de ConversationReplyCard que nombran al contacto, con el término
// del rubro (cliente o paciente, docs/rubros.md §3.1). Las constantes son los
// de una automotora. Aparte del componente para no romper el fast refresh.

// La ventana de 24 h de Meta vencida.
export function avisoVentanaVencida(contacto = "cliente"): string {
  return `Pasaron más de 24 h desde el último mensaje del ${contacto}: WhatsApp solo permite plantillas aprobadas.`;
}
export function avisoVentanaVencidaMeta(contacto = "cliente"): string {
  return `Pasaron más de 24 h desde el último mensaje del ${contacto}: Messenger e Instagram no dejan escribirle hasta que vuelva a escribir.`;
}
export const AVISO_VENTANA_VENCIDA = avisoVentanaVencida();
export const AVISO_VENTANA_VENCIDA_META = avisoVentanaVencidaMeta();

// "Devolver al agente" sin haberle respondido al contacto.
export function confirmarDevolverSinResponder(contacto = "cliente"): string {
  return `No le respondiste al ${contacto}. Se le va a avisar que lo contactan más tarde y la tarea queda pendiente. ¿Devolver igual?`;
}
export const CONFIRMAR_DEVOLVER_SIN_RESPONDER = confirmarDevolverSinResponder();
