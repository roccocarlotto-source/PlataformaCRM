// ---------------------------------------------------------------------------
// Cuándo hay INICIATIVA DEL CLIENTE (decisión de Rocco, 08/10/2026).
//
// El agente creaba una oportunidad porque el cliente preguntó por un vehículo
// —precio, kilómetros, fotos—, y el pipeline se llenaba de "interés" que nadie
// había pedido atender. Una oportunidad o una reserva se justifican SOLO cuando
// el cliente toma la iniciativa de avanzar, y eso es exactamente una de las
// seis cosas de abajo.
//
// ESTA ES LA ÚNICA LISTA. De acá salen el enum `motivo` de create_opportunity
// (lo que el backend exige), la instrucción fija del system prompt (lo que el
// modelo lee) y la nota que queda en la oportunidad (lo que el vendedor ve).
// Agregar o sacar una iniciativa es tocar este archivo y nada más.
//
// Las etiquetas están en tercera persona del presente porque sirven en las
// tres frases: "el cliente pide un test drive" en el prompt y en la nota.
// ---------------------------------------------------------------------------

export const INICIATIVAS_DEL_CLIENTE = {
  TEST_DRIVE: "pide un test drive",
  RESERVA_O_SENA: "quiere reservar o señar",
  FINANCIACION_O_COTIZACION: "pide financiación o una cotización formal",
  VISITA: "quiere coordinar una visita para ver la unidad",
  PERMUTA: "ofrece su auto en permuta para tasar",
  CONTACTO_CON_VENDEDOR: "pide que lo contacte un vendedor",
} as const;

export type IniciativaDelCliente = keyof typeof INICIATIVAS_DEL_CLIENTE;

// Los valores del enum, en el orden de la lista. Tipado como tupla no vacía
// para z.enum().
export const MOTIVOS_DE_OPORTUNIDAD = Object.keys(INICIATIVAS_DEL_CLIENTE) as [
  IniciativaDelCliente,
  ...IniciativaDelCliente[],
];

// Lo que NO es iniciativa, dicho con las mismas palabras en la tool y en el
// prompt: ahí el agente contesta y el interés queda en la ficha (search_vehicles
// guarda la intención, #355; la unidad de interés se anota con update_lead,
// #421), sin crear nada.
export const CONSULTAS_QUE_NO_SON_INICIATIVA =
  "preguntar el precio, los kilómetros, las fotos, la disponibilidad o las características de un vehículo";

// "pide un test drive; quiere reservar o señar; ..." para leerla en una frase.
export function enumerarIniciativas(): string {
  return Object.values(INICIATIVAS_DEL_CLIENTE).join("; ");
}

export function esIniciativaDelCliente(valor: unknown): valor is IniciativaDelCliente {
  return typeof valor === "string" && valor in INICIATIVAS_DEL_CLIENTE;
}

// La nota que queda en la oportunidad (una Activity NOTE: sin migración, y es
// lo que el vendedor ve en Actividades junto al contacto y la oportunidad).
export const PREFIJO_NOTA_DE_MOTIVO = "Motivo de la oportunidad: el cliente ";

export function asuntoDeLaNotaDeMotivo(motivo: IniciativaDelCliente): string {
  return `${PREFIJO_NOTA_DE_MOTIVO}${INICIATIVAS_DEL_CLIENTE[motivo]}`;
}
