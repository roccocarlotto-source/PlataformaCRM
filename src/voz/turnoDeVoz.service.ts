import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { normalizarTelefono, soloDigitos } from "../lib/telefono";
import { findAgentById } from "../repositories/agent.repository";
import {
  findOrCreateOpenConversation,
  updateConversation,
} from "../repositories/conversation.repository";
import { createMessage } from "../repositories/message.repository";
import {
  cargarAgenteYContacto,
  conLockDeConversacion,
  responderEnLaConversacion,
  type SalidaDeVoz,
} from "../services/agentOrchestration.service";
import { resolverContactoPorTelefono } from "../services/whatsappContact.service";
import { resolveWidgetContact } from "../services/widgetContact.service";
import { CancelacionDelTurno, TurnoCancelado } from "../services/cancelacionDelTurno";
import { AppError } from "../utils/AppError";
import { formatearParaElCanal } from "../utils/formatoPorCanal";
import { LLAMADA_CONTACT_FIRST_NAME, LLAMADA_CONTACT_SOURCE } from "../utils/nombreProvisorio";
import type { AccesoDeVoz } from "./accesos";
import { crearEsperaDeVoz, type EsperaDeVoz } from "./esperaDeVoz";
import { crearSalidaPorOraciones } from "./salidaPorOraciones";
import { comparable, crearRegistroDeTurnos, type TurnoEnCurso } from "./turnosEnCurso";

// ---------------------------------------------------------------------------
// UN TURNO DE UNA LLAMADA. Es el turno de siempre (responderEnLaConversacion:
// mismo prompt, misma base de conocimiento, mismas herramientas validadas por
// el backend), con tres diferencias:
//
//   - Lo que dice sale por el stream a medida que pasa las guardas, con frases
//     de espera si tarda (salidaPorOraciones.ts, esperaDeVoz.ts).
//   - Nada se escribe antes de contestar: lo que dijo el cliente viaja en
//     memoria y se guarda al final del turno, con la hora en que llegó.
//   - Sigue aunque la plataforma corte el pedido: las herramientas no quedan a
//     mitad de camino, y un reintento se engancha (turnosEnCurso.ts).
//
// Limitación conocida: si el cliente interrumpe, el turno interrumpido termina
// igual y el siguiente lo espera, porque los turnos de una conversación van de
// a uno.
// ---------------------------------------------------------------------------

// Mucho menos que los 90 s de WhatsApp: nadie espera tanto en el teléfono.
export const PRESUPUESTO_DEL_TURNO_DE_VOZ_MS = 30_000;

export const FRASE_SIN_RESPUESTA = "Un compañero del equipo está viendo tu caso.";
// Un problema nuestro, no del cliente: no se le dice que no se lo escuchó.
export const FRASE_DE_PROBLEMA = "Perdón, se me trabó el sistema un segundo, ¿me repetís el dato?";
const LARGO_MAXIMO_DEL_AVISO = 1000;
const VIDA_DE_UNA_LLAMADA_MS = 60 * 60 * 1000;

export interface PedidoDeTurnoDeVoz {
  acceso: AccesoDeVoz;
  callId: string;
  llamante: string | null;
  texto: string;
  // Cuántas veces habló el cliente hasta acá: dos "sí" seguidos son dos turnos.
  numeroDeTurno: number;
  // Lo primero que dijo la plataforma (el aviso legal fijo), si vino.
  avisoInicial: string | null;
}

// Lo que se recuerda de una llamada entre turnos. El agente, el contacto y la
// conversación se releen en cada turno: un agente apagado o un nombre recién
// anotado tienen que valer en la misma llamada.
interface Llamada {
  // Las frases de espera del último turno: el siguiente no las repite.
  frasesDelTurnoAnterior: ReadonlySet<string>;
  // Una promesa: dos turnos a la vez (uno que reemplaza a otro) esperan la
  // misma, y el contacto de la llamada se busca o se crea una sola vez.
  datos: Promise<{ contactId: string; branchId: string }> | null;
  avisoGuardado: boolean;
  ultimaVez: number;
}

const llamadas = new Map<string, Llamada>();
const registro = crearRegistroDeTurnos();
// Lo que dijo el cliente en cada turno, cómo cancelarlo y sus frases de espera:
// para reemplazarlo si llega otro pedido del mismo turno con la frase más larga.
interface DatosDelTurno {
  texto: string;
  cancelacion: CancelacionDelTurno;
  espera: EsperaDeVoz | null;
}
const datosDelTurno = new WeakMap<TurnoEnCurso, DatosDelTurno>();

function laLlamada(pedido: PedidoDeTurnoDeVoz): Llamada {
  const ahora = Date.now();
  for (const [clave, llamada] of llamadas) {
    if (ahora - llamada.ultimaVez >= VIDA_DE_UNA_LLAMADA_MS) {
      llamadas.delete(clave);
    }
  }
  const clave = `${pedido.acceso.organizationId}:${pedido.callId}`;
  const llamada = llamadas.get(clave) ?? {
    frasesDelTurnoAnterior: new Set<string>(),
    datos: null,
    avisoGuardado: false,
    ultimaVez: ahora,
  };
  llamada.ultimaVez = ahora;
  llamadas.set(clave, llamada);
  return llamada;
}

// Los dígitos del que llama, o null si el número viene oculto o no es un número.
export function digitosDelLlamante(valor: string | null): string | null {
  if (valor === null) {
    return null;
  }
  const recortado = valor.trim();
  const normalizado = normalizarTelefono(recortado.startsWith("+") ? recortado : `+${recortado}`);
  return normalizado === null ? null : soloDigitos(normalizado);
}

function resolverLaLlamada(
  pedido: PedidoDeTurnoDeVoz,
  llamada: Llamada,
): Promise<{ contactId: string; branchId: string }> {
  llamada.datos ??= buscarLaLlamada(pedido);
  return llamada.datos;
}

async function buscarLaLlamada(
  pedido: PedidoDeTurnoDeVoz,
): Promise<{ contactId: string; branchId: string }> {
  const { organizationId, agentId } = pedido.acceso;
  const agente = await findAgentById(agentId, organizationId);
  if (!agente) {
    throw new AppError("Agente no encontrado", 404);
  }
  const digitos = digitosDelLlamante(pedido.llamante);
  // Con número oculto, el mismo camino que un visitante anónimo del widget: el
  // contacto queda atado a la llamada y el agente pide un dato de contacto.
  const contactId =
    digitos !== null
      ? await resolverContactoPorTelefono(organizationId, digitos, {
          firstName: LLAMADA_CONTACT_FIRST_NAME,
          lastName: `+${digitos}`,
          source: LLAMADA_CONTACT_SOURCE,
        })
      : await resolveWidgetContact(
          organizationId,
          agentId,
          agente.branchId,
          "VOICE",
          pedido.callId,
          agentId,
          LLAMADA_CONTACT_SOURCE,
        );
  return { contactId, branchId: agente.branchId };
}

// Se guarda al final, con la hora de llegada: así queda antes de la respuesta
// en el hilo aunque se escriba después.
async function guardarLoDelCliente(
  pedido: PedidoDeTurnoDeVoz,
  llamada: Llamada,
  conversacion: { id: string; externalThreadId: string | null },
  llegada: Date,
  salienteId: string | null,
): Promise<void> {
  const { organizationId } = pedido.acceso;
  const aviso = llamada.avisoGuardado ? null : pedido.avisoInicial;
  await prisma.$transaction(async (tx) => {
    if (aviso !== null) {
      await createMessage(
        {
          organizationId,
          conversationId: conversacion.id,
          direction: "OUTBOUND",
          senderType: "AGENT",
          content: aviso.slice(0, LARGO_MAXIMO_DEL_AVISO),
          createdAt: new Date(llegada.getTime() - 1),
        },
        tx,
      );
    }
    await createMessage(
      {
        organizationId,
        conversationId: conversacion.id,
        direction: "INBOUND",
        senderType: "CONTACT",
        content: pedido.texto,
        createdAt: llegada,
      },
      tx,
    );
    await updateConversation(
      conversacion.id,
      organizationId,
      {
        ...(salienteId === null ? { lastMessageAt: llegada } : {}),
        ...(conversacion.externalThreadId !== pedido.callId
          ? { externalThreadId: pedido.callId }
          : {}),
      },
      tx,
    );
  });
  llamada.avisoGuardado = true;
}

async function correrElTurno(
  pedido: PedidoDeTurnoDeVoz,
  llamada: Llamada,
  turno: TurnoEnCurso,
  llegada: Date,
  datos: DatosDelTurno,
  // Las frases que ya dijo el turno que este reemplaza: no se repiten.
  yaDichas: readonly string[] = [],
): Promise<void> {
  const { organizationId, agentId } = pedido.acceso;
  const { cancelacion } = datos;
  const espera = crearEsperaDeVoz({
    decir: (frase) => turno.decir(frase, true),
    delTurnoAnterior: new Set([...llamada.frasesDelTurnoAnterior, ...yaDichas]),
  });
  datos.espera = espera;
  const salida = crearSalidaPorOraciones({
    decir: (texto) => {
      espera.huboTexto();
      turno.decir(texto);
    },
    formatear: (texto) => formatearParaElCanal(texto, "VOICE"),
  });
  const cerrar = (texto: string): string => {
    const dicho = salida.cerrar(texto);
    // Lo que falta (derivar, guardar) no necesita a la llamada esperando.
    espera.parar();
    // Acá y no solo al final: el turno siguiente puede arrancar mientras este
    // todavía guarda.
    llamada.frasesDelTurnoAnterior = new Set(espera.dichas());
    turno.terminar();
    return dicho;
  };
  const voz: SalidaDeVoz = {
    entrante: { id: `voz-${pedido.numeroDeTurno}`, direction: "INBOUND", content: pedido.texto },
    empezarRonda: (revisar) => salida.empezarRonda(revisar),
    alEscribir: (fragmento) => salida.agregar(fragmento),
    empezoHerramienta: (nombre) => espera.empezoHerramienta(nombre),
    terminoHerramienta: () => espera.terminoHerramienta(),
    cerrar,
    cancelacion,
  };

  try {
    const { contactId, branchId } = await resolverLaLlamada(pedido, llamada);
    // Cancelado antes del lock: ni lo pide.
    cancelacion.comprobar();
    await conLockDeConversacion(
      { agentId, contactId, channel: "VOICE", organizationId },
      async () => {
        // Si se canceló mientras esperaba el lock, ni siquiera arranca.
        cancelacion.comprobar();
        const [{ agent, contact }, conversation] = await Promise.all([
          cargarAgenteYContacto(organizationId, agentId, contactId, "VOICE"),
          findOrCreateOpenConversation({
            organizationId,
            branchId,
            agentId,
            contactId,
            channel: "VOICE",
            externalThreadId: pedido.callId,
          }),
        ]);
        let salienteId: string | null = null;
        let respuesta: string | null;
        try {
          const turnoDelAgente = await responderEnLaConversacion(
            { agent, contact, conversation, texto: pedido.texto },
            { voz, presupuestoMs: PRESUPUESTO_DEL_TURNO_DE_VOZ_MS },
          );
          salienteId = turnoDelAgente.salienteId;
          respuesta = turnoDelAgente.resultado.respuesta;
        } finally {
          // Un turno cancelado no deja rastro: ni lo que dijo el cliente. Si
          // sigue (también después de un error), desde acá ya no se cancela:
          // si no, otro pedido podía cancelarlo mientras guarda y el mismo
          // turno quedaba guardado dos veces.
          if (cancelacion.seguirSinVuelta()) {
            await guardarLoDelCliente(pedido, llamada, conversation, llegada, salienteId);
          }
        }
        // Las salidas tempranas del turno (una regla, el nivel de IA, una
        // persona atendiendo) no pasan por el cierre del texto.
        if (!salida.cerrada) {
          cerrar(respuesta ?? FRASE_SIN_RESPUESTA);
        }
      },
    );
  } catch (err) {
    // También un cancelado que, antes de enterarse, chocó con otro error.
    if (err instanceof TurnoCancelado || cancelacion.fueCancelado) {
      // Lo reemplazó otro pedido del mismo turno, que ya tiene a los oyentes.
      logger.info(
        { organizationId, agentId, numeroDeTurno: pedido.numeroDeTurno },
        "Turno de voz cancelado sin dejar rastro: lo reemplazó el pedido con la frase más larga",
      );
      return;
    }
    llamada.datos = null;
    logger.error(
      { err, organizationId, agentId, callId: pedido.callId },
      "Falló un turno de voz: se le pide al cliente que repita",
    );
    if (!salida.cerrada) {
      cerrar(FRASE_DE_PROBLEMA);
    }
  } finally {
    espera.parar();
    if (!cancelacion.fueCancelado) {
      llamada.frasesDelTurnoAnterior = new Set(espera.dichas());
    }
    turno.terminar();
  }
}

// Arranca el turno, o devuelve el que ya corre si es un reintento. El turno no
// depende de quién escuche: si la plataforma corta, sigue hasta terminar.
//
// GANA LA FRASE MÁS LARGA MIENTRAS EL TURNO NO HIZO NADA. Si el cliente siguió
// hablando después de una pausa, la plataforma manda otro pedido del mismo
// turno con la frase más larga. Si el turno que corre todavía no dijo nada
// real ni pasó un punto sin vuelta (guardar algo, correr una herramienta), se
// cancela sin dejar rastro y arranca otro con la frase nueva, que se queda con
// los que escuchaban. Si ya hizo algo, el pedido se engancha al que corre.
// Solo con una frase más larga: un reintento atrasado de la frase corta no
// reemplaza a la larga.
export function pedirTurnoDeVoz(pedido: PedidoDeTurnoDeVoz): TurnoEnCurso {
  const llegada = new Date();
  const clave = claveDelTurno(pedido);
  const arrancar =
    (yaDichas: readonly string[] = []) =>
    (nuevo: TurnoEnCurso) => {
      const datos: DatosDelTurno = {
        texto: pedido.texto,
        cancelacion: new CancelacionDelTurno(),
        espera: null,
      };
      datosDelTurno.set(nuevo, datos);
      void correrElTurno(pedido, laLlamada(pedido), nuevo, llegada, datos, yaDichas);
    };

  const existente = registro.obtener(clave);
  const datos = existente ? datosDelTurno.get(existente) : undefined;
  if (
    existente &&
    datos &&
    existente.momentoDeFin === null &&
    !existente.dijoAlgo &&
    comparable(pedido.texto).length > comparable(datos.texto).length &&
    datos.cancelacion.intentarCancelar()
  ) {
    const nuevo = registro.reemplazar(clave, arrancar(datos.espera?.dichas() ?? []));
    existente.pasarOyentesA(nuevo);
    logger.info(
      {
        organizationId: pedido.acceso.organizationId,
        agentId: pedido.acceso.agentId,
        numeroDeTurno: pedido.numeroDeTurno,
        turnoReemplazado: true,
      },
      "Otro pedido del mismo turno de voz con la frase más larga: reemplaza al que no había hecho nada",
    );
    return nuevo;
  }

  const turno = registro.obtenerOArrancar(clave, arrancar());
  avisarSiCambioElTexto(pedido, turno);
  return turno;
}

// El turno que sigue una continuación (la plataforma dejó de esperar y vuelve a
// pedir con lo ya dicho). Nunca arranca uno: correrlo de nuevo repetiría las
// herramientas. null si ya no está (pasó mucho o el proceso se reinició).
export function turnoQueSigue(pedido: PedidoDeTurnoDeVoz): TurnoEnCurso | null {
  const turno = registro.obtener(claveDelTurno(pedido));
  if (turno) {
    avisarSiCambioElTexto(pedido, turno);
  }
  return turno;
}

// UN TURNO, UNA VEZ. La clave es el número de turno de la llamada, sin el
// texto: la plataforma puede mandar dos pedidos del mismo turno con textos
// distintos (por ejemplo, uno durante una pausa del cliente con la frase a
// medias y otro con la frase completa), y correr los dos podía repetir una
// reserva. Nunca corren dos: o el nuevo reemplaza al que no hizo nada
// (pedirTurnoDeVoz), o se engancha y escucha la misma respuesta.
export function claveDelTurno(pedido: PedidoDeTurnoDeVoz): string {
  return `${pedido.acceso.organizationId}:${pedido.callId}:${pedido.numeroDeTurno}`;
}

// Sin el texto en el log: solo la marca, para medir cuántas veces pasa.
function avisarSiCambioElTexto(pedido: PedidoDeTurnoDeVoz, turno: TurnoEnCurso): void {
  const original = datosDelTurno.get(turno)?.texto;
  if (original === undefined || original === pedido.texto) {
    return;
  }
  logger.warn(
    {
      organizationId: pedido.acceso.organizationId,
      agentId: pedido.acceso.agentId,
      numeroDeTurno: pedido.numeroDeTurno,
      textoDistinto: true,
    },
    "Otro pedido del mismo turno de voz con un texto distinto: se engancha al que ya corre",
  );
}
