import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { z } from "zod";
import type { VozRequest } from "../types/vozAuth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";
import {
  chunkDeCierre,
  chunkDeInicio,
  chunkDeTexto,
  FIN_DEL_STREAM,
  type DatosDelStream,
} from "../voz/sse";
import { pedirTurnoDeVoz } from "../voz/turnoDeVoz.service";

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

const contenidoSchema = z.union([
  z.string(),
  z.array(z.looseObject({ text: z.string().optional() })),
  z.null(),
]);

const pedidoSchema = z.looseObject({
  model: z.string().max(200).optional(),
  messages: z
    .array(z.looseObject({ role: z.string(), content: contenidoSchema.optional() }))
    .min(1)
    .max(1000),
});

const llamadaSchema = z.string().trim().min(1, "Falta el id de la llamada").max(200);

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

// Lo que dijo el cliente en este turno: el último mensaje, si es suyo.
export function loQueDijoElCliente(mensajes: Mensaje[]): string {
  const ultimo = mensajes.at(-1);
  return ultimo?.role === "user" ? textoDelMensaje(ultimo).slice(0, LARGO_MAXIMO_DE_LO_DICHO) : "";
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
  const { messages, model } = parseOrThrow(pedidoSchema, req.body);
  const callId = parseOrThrow(llamadaSchema, req.headers[HEADER_LLAMADA]);
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

  const turno = pedirTurnoDeVoz({
    acceso: req.vozAcceso,
    callId,
    llamante: valorDelHeader(req.headers[HEADER_LLAMANTE]),
    texto,
    numeroDeTurno: messages.filter((m) => m.role === "user").length,
    avisoInicial: avisoInicial(messages),
  });

  // Si la plataforma corta, se deja de escribir pero el turno sigue.
  const dejarDeEscuchar = turno.escuchar((parte) => {
    if (parte === null) {
      cerrarStream(res, datos);
    } else {
      res.write(chunkDeTexto(datos, parte));
    }
  });
  res.on("close", dejarDeEscuchar);
});
