// ---------------------------------------------------------------------------
// CANCELAR UN TURNO QUE TODAVÍA NO HIZO NADA. Solo el canal de voz: la
// plataforma puede mandar otro pedido del mismo turno con la frase más larga
// (el cliente siguió hablando después de una pausa), y conviene contestarle a
// la frase entera en vez de a la mitad (voz/turnoDeVoz.service.ts).
//
// Un turno se puede cancelar mientras no pasó ningún punto sin vuelta: guardar
// algo, correr una herramienta o cerrar la respuesta. El turno marca cada uno
// con sinVuelta() justo antes, sin esperas en el medio, así que cancelar y
// pasar un punto sin vuelta no se pueden cruzar: o se cancela antes y el turno
// corta ahí sin dejar rastro, o el turno ya pasó y cancelar devuelve false.
//
// WhatsApp, Messenger, Instagram y la web no crean nunca una cancelación
// (cancelacionDelTurno en agentOrchestration.service.ts): para ellos todo
// queda igual.
// ---------------------------------------------------------------------------

export class TurnoCancelado extends Error {
  constructor() {
    super("El turno se canceló: llegó otro pedido del mismo turno con la frase más larga");
    this.name = "TurnoCancelado";
  }
}

export class CancelacionDelTurno {
  private cancelable = true;
  private cancelado = false;
  private readonly control = new AbortController();

  // Corta la llamada al modelo que esté en curso.
  get senal(): AbortSignal {
    return this.control.signal;
  }

  get fueCancelado(): boolean {
    return this.cancelado;
  }

  // true si se canceló; false si el turno ya pasó un punto sin vuelta.
  intentarCancelar(): boolean {
    if (!this.cancelable) {
      return false;
    }
    this.cancelado = true;
    this.control.abort();
    return true;
  }

  // Lanza TurnoCancelado si el turno se canceló.
  comprobar(): void {
    if (this.cancelado) {
      throw new TurnoCancelado();
    }
  }

  // Desde acá el turno ya no se puede cancelar. Lanza si ya se canceló.
  sinVuelta(): void {
    this.comprobar();
    this.cancelable = false;
  }

  // Lo mismo sin lanzar, para un camino que igual tiene que terminar (por
  // ejemplo, después de un error): true si sigue y ya no se puede cancelar,
  // false si se canceló.
  seguirSinVuelta(): boolean {
    if (this.cancelado) {
      return false;
    }
    this.cancelable = false;
    return true;
  }
}
