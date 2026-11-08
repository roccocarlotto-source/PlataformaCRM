import { createHash, randomUUID } from "node:crypto";
import type { Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import type { VozRequest } from "../types/vozAuth";
import { AppError } from "../utils/AppError";
import { asyncHandler } from "../utils/asyncHandler";
import {
  chunkDeCierre,
  chunkDeInicio,
  chunkDeTexto,
  FIN_DEL_STREAM,
  type DatosDelStream,
} from "../voz/sse";
import { FRASE_DE_PROBLEMA, pedirTurnoDeVoz, turnoQueSigue } from "../voz/turnoDeVoz.service";

// ---------------------------------------------------------------------------
// El turno de voz, en el formato de OpenAI. La plataforma manda la conversación
// entera; de ahí se usa lo último que dijo el cliente, porque el historial que
// vale es el del CRM. Tampoco se usan su prompt ni sus herramientas: el agente
// es el configurado en el CRM.
//
// Los datos de la llamada llegan en headers que se cargan en la plataforma con
// sus variables dinámicas. Ninguno decide de qué organización es la llamada:
// eso sale del secreto (authenticateVoz).
// ---------------------------------------------------------------------------

export const HEADER_LLAMADA = "x-voz-conversacion";
export const HEADER_LLAMANTE = "x-voz-llamante";
export const LARGO_MAXIMO_DE_LO_DICHO = 4000;
export const FRASE_SIN_AUDIO = "No te escuché bien, ¿me lo repites?";
export const CUERPO_INVALIDO =
  "El cuerpo tiene que ser un pedido de Chat Completions con messages (entre 1 y 1000 mensajes)";
export const SOLO_STREAMING = "Este endpoint responde solo en streaming (stream: true)";

// La marca que se pone en el prompt del sistema de la plataforma para pasar el
// id de la llamada: [llamada:{{system__conversation_id}}]. Sin resolver no
// coincide, porque las llaves no entran en el id.
const MARCA_DE_LLAMADA = /\[llamada:([A-Za-z0-9_-]{1,200})\]/;
const SIN_RESOLVER = /\{\{.*\}\}/;
const LARGO_MAXIMO_DEL_ID = 200;

const contenidoSchema = z.union([
  z.string(),
  z.array(z.looseObject({ text: z.string().optional() })),
  z.null(),
]);

const pedidoSchema = z.looseObject({
  model: z.string().max(200).optional(),
  stream: z.boolean().optional(),
  messages: z
    .array(z.looseObject({ role: z.string(), content: contenidoSchema.optional() }))
    .min(1)
    .max(1000),
});

type Mensaje = z.infer<typeof pedidoSchema>["messages"][number];

function textoDelMensaje(mensaje: Mensaje): string {
  const { content } = mensaje;
  if (typeof content === "string") {
    return content.trim();
  }
  return (content ?? [])
    .map((parte) => parte.text ?? "")
    .join(" ")
    .trim();
}

function indiceDelUltimoDelCliente(mensajes: Mensaje[]): number {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    if (mensajes[i].role === "user") return i;
  }
  return -1;
}

// Lo último que dijo el cliente: su último mensaje, aunque después venga lo que
// la plataforma ya dijo de este turno (ver loQueYaEscucho).
export function loQueDijoElCliente(mensajes: Mensaje[]): string {
  const indice = indiceDelUltimoDelCliente(mensajes);
  return indice === -1 ? "" : textoDelMensaje(mensajes[indice]).slice(0, LARGO_MAXIMO_DE_LO_DICHO);
}

// UNA CONTINUACIÓN. Si un turno tarda, la plataforma deja de esperar y vuelve a
// pedir con lo que alcanzó a decir como último mensaje del asistente (visto en
// la llamada del 2026-11-08: unos 9 s después de empezar un turno largo). No es
// un turno nuevo: es el mismo, y le falta el resto. Devuelve lo que el cliente
// ya escuchó de este turno, o null si el último mensaje es del cliente (lo
// normal) o el cliente todavía no habló.
export function loQueYaEscucho(mensajes: Mensaje[]): string | null {
  const indice = indiceDelUltimoDelCliente(mensajes);
  if (indice === -1 || indice === mensajes.length - 1) {
    return null;
  }
  return mensajes
    .slice(indice + 1)
    .filter((m) => m.role === "assistant")
    .map(textoDelMensaje)
    .join(" ");
}

// El saludo fijo de la plataforma (el aviso legal), si vino antes del cliente.
export function avisoInicial(mensajes: Mensaje[]): string | null {
  for (const mensaje of mensajes) {
    if (mensaje.role === "user") {
      return null;
    }
    if (mensaje.role === "assistant") {
      return textoDelMensaje(mensaje) || null;
    }
  }
  return null;
}

function valorDelHeader(valor: string | string[] | undefined): string | null {
  return typeof valor === "string" ? valor : null;
}

export type OrigenDelIdDeLlamada = "header" | "marca" | "huella";

// ---------------------------------------------------------------------------
// DE DÓNDE SALE EL ID DE LA LLAMADA. Agrupa los turnos de una llamada en una
// conversación del CRM y es parte de la clave anti-duplicado. En orden:
//
//   1. El header x-voz-conversacion, si llega resuelto.
//   2. La marca [llamada:...] del prompt del sistema de la plataforma. SOLO de
//      los mensajes con rol "system", que arma la plataforma: lo que dice el
//      cliente (o lo que el asistente repite) nunca elige la llamada.
//   3. Una huella del comienzo de la llamada: el agente, el saludo, lo primero
//      que dijo el cliente y el número que llama. La plataforma reenvía todo
//      el historial en cada turno, así que ese comienzo no cambia mientras dura
//      la llamada, y sus reintentos dan la misma huella.
//
// RIESGO DE LA HUELLA, aceptado como último recurso: dos llamadas que empiezan
// igual (el mismo "Hola" y número oculto) quedan en la misma conversación, con
// el mismo historial. Por eso cada uso queda en el log como aviso, y la marca
// del punto 2 es lo que hay que cargar en la plataforma.
// ---------------------------------------------------------------------------
export function idDeLaLlamada(
  header: string | string[] | undefined,
  mensajes: Mensaje[],
  agentId: string,
  llamante: string | null,
): { id: string; origen: OrigenDelIdDeLlamada } {
  const delHeader = typeof header === "string" ? header.trim() : "";
  if (
    delHeader.length > 0 &&
    delHeader.length <= LARGO_MAXIMO_DEL_ID &&
    !SIN_RESOLVER.test(delHeader)
  ) {
    return { id: delHeader, origen: "header" };
  }
  for (const mensaje of mensajes) {
    if (mensaje.role !== "system") continue;
    const marca = MARCA_DE_LLAMADA.exec(textoDelMensaje(mensaje));
    if (marca) {
      return { id: marca[1], origen: "marca" };
    }
  }
  const primeroDelCliente = mensajes.find((m) => m.role === "user");
  const huella = createHash("sha256")
    .update(
      JSON.stringify([
        agentId,
        avisoInicial(mensajes) ?? "",
        primeroDelCliente ? textoDelMensaje(primeroDelCliente) : "",
        llamante?.trim() ?? "",
      ]),
      "utf8",
    )
    .digest("hex")
    .slice(0, 32);
  return { id: `huella-${huella}`, origen: "huella" };
}

function leerPedido(cuerpo: unknown): z.infer<typeof pedidoSchema> {
  const pedido = pedidoSchema.safeParse(cuerpo);
  if (!pedido.success) {
    throw new AppError(CUERPO_INVALIDO, 400);
  }
  if (pedido.data.stream === false) {
    throw new AppError(SOLO_STREAMING, 400);
  }
  return pedido.data;
}

function abrirStream(res: Response, datos: DatosDelStream): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(chunkDeInicio(datos));
}

function cerrarStream(res: Response, datos: DatosDelStream): void {
  res.write(chunkDeCierre(datos));
  res.write(FIN_DEL_STREAM);
  res.end();
}

export const pedirTurnoDeVozHandler = asyncHandler<VozRequest>(async (req, res: Response) => {
  const { messages, model, stream } = leerPedido(req.body);
  const llamante = valorDelHeader(req.headers[HEADER_LLAMANTE]);
  const { agentId } = req.vozAcceso;
  const { id: callId, origen } = idDeLaLlamada(
    req.headers[HEADER_LLAMADA],
    messages,
    agentId,
    llamante,
  );
  // Sin texto: ni lo dicho ni el id; solo de dónde salió el id y la forma.
  const yaEscucho = loQueYaEscucho(messages);
  const datosDelLog = {
    agentId,
    origenDelId: origen,
    stream,
    mensajes: messages.length,
    continuacion: yaEscucho !== null,
  };
  if (origen === "huella") {
    logger.warn(
      datosDelLog,
      "Turno de voz sin id de la llamada: se agrupa por el comienzo de la conversación",
    );
  } else {
    logger.info(datosDelLog, "Turno de voz");
  }
  const datos: DatosDelStream = {
    id: `chatcmpl-${randomUUID()}`,
    modelo: model ?? "agente",
    creado: Math.floor(Date.now() / 1000),
  };

  abrirStream(res, datos);

  const texto = loQueDijoElCliente(messages);
  if (texto.length === 0) {
    res.write(chunkDeTexto(datos, FRASE_SIN_AUDIO));
    cerrarStream(res, datos);
    return;
  }

  const pedido = {
    acceso: req.vozAcceso,
    callId,
    llamante,
    texto,
    numeroDeTurno: messages.filter((m) => m.role === "user").length,
    avisoInicial: avisoInicial(messages),
  };
  const turno = yaEscucho === null ? pedirTurnoDeVoz(pedido) : turnoQueSigue(pedido);
  if (turno === null) {
    logger.warn(
      datosDelLog,
      "Continuación de un turno de voz que ya no está: se pide repetir, sin correrlo de nuevo",
    );
    res.write(chunkDeTexto(datos, FRASE_DE_PROBLEMA));
    cerrarStream(res, datos);
    return;
  }

  // Si la plataforma corta, se deja de escribir pero el turno sigue. A una
  // continuación no se le repite lo que el cliente ya escuchó.
  const dejarDeEscuchar = turno.escuchar((parte) => {
    if (parte === null) {
      cerrarStream(res, datos);
    } else {
      res.write(chunkDeTexto(datos, parte));
    }
  }, yaEscucho ?? "");
  res.on("close", dejarDeEscuchar);
});
