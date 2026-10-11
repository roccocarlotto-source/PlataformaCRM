# Agentes de IA

## Lo que el asistente no responde {#consultas-de-salud}

El asistente de la clínica ayuda con turnos, horarios, precios y lo que esté
cargado en la información de la clínica. **No responde consultas de salud.**
Esto no se puede cambiar desde la configuración: vale para todos los canales
(WhatsApp, Messenger, Instagram y el chat de la web) y para cualquier nivel del
asistente.

Cuando un paciente escribe algo de salud, el asistente no le contesta con sus
palabras: le manda un mensaje fijo y te pasa la conversación.

| Qué escribió el paciente | Qué le contesta el asistente | Qué te llega a vos |
|---|---|---|
| Una posible urgencia: "no puedo respirar", "se me hinchó la cara", "me duele el pecho", "me desmayé" | Que llame ya al 911 o a su emergencia móvil, y que ya le avisaron al equipo | Una tarea que empieza con **URGENTE**, vencida desde el primer minuto |
| Una consulta clínica: un síntoma o una reacción ("me arde", "me salieron granitos"), medicación, embarazo o lactancia, "¿es normal que…?" | Que esa consulta la tiene que ver un profesional y que ya le pasaron el mensaje al equipo | Una tarea "Consulta clínica: ver la conversación" |

> Ante la duda, el asistente deriva. Puede pasar que una pregunta común
> ("¿la depilación duele?") llegue como consulta clínica: es a propósito.
> Es preferible que la vea una persona de más a que el asistente conteste algo
> de salud.

### Qué hacer cuando te llega una {#atender-una-derivacion}

1. Abrí la tarea o la conversación desde [Conversaciones](/conversations).
2. Leé lo que escribió el paciente **en la conversación**. La tarea no copia
   lo que contó: los datos de salud quedan solo ahí.
3. Respondé vos o pasale el caso al profesional que corresponda.

Después de una derivación por salud, **el asistente no vuelve a escribir en esa
conversación**, aunque el paciente siga mandando mensajes. Cuando termines,
tocá **Devolver al agente** si querés que el asistente siga atendiendo ese
chat (por ejemplo, para agendar el turno). Si el paciente escribe una
urgencia, el asistente igual le manda el mensaje del 911, aunque estés vos
atendiendo.

> Si el asistente estaba por responder algo que parecía una indicación médica
> (una dosis, un "aplicate…", un "parece ser…"), esa respuesta no sale: el
> paciente recibe el mensaje de consulta clínica y la conversación te llega a
> vos.

## Cambiar o cancelar turnos por chat {#cambiar-o-cancelar-turnos}

Si el asistente está en el nivel **Autónomo**, puede ver, reprogramar y
cancelar los turnos del paciente con el que está hablando. Para eso, en
**Acciones habilitadas** del asistente activá **Ver turnos del paciente**,
**Reprogramar turno** y **Cancelar turno**. En el nivel **Primer contacto** el
asistente no cambia turnos: toma los datos y lo hace la recepción.

- Antes de cambiar o cancelar, el asistente le confirma al paciente qué turno
  es y, si lo reprograma, el día, la hora y el profesional nuevos.
- Solo ofrece horarios libres de la agenda: **nunca carga un sobreturno**.
- Solo toca turnos de ese paciente y de la sede de la conversación.
- Un turno que ya empezó o ya pasó no lo cambia.
- Si la sede tiene una **anticipación mínima**, con menos tiempo que ese el
  asistente no cambia ni cancela el turno: se lo dice al paciente y te pasa la
  conversación.
- Si algo no se puede (no hay horarios, el turno ya pasó, hay dudas), te pasa
  la conversación.
- Cada cambio queda en la ficha del paciente con **Asistente** como autor.
- Si en el mismo mensaje el paciente cuenta un síntoma o una urgencia, eso va
  primero: el asistente responde con el mensaje fijo de salud y no toca el
  turno.

### Anticipación mínima para cambiar un turno {#anticipacion-minima}

Lo configura un administrador, por sede:

1. Entrá a [Sucursales](/branches) y abrí la sede.
2. En **Turnos por chat**, completá **Anticipación mínima para cambiar un turno
   (horas)**. Por ejemplo, con 24 el asistente no reprograma ni cancela un turno
   que empieza en menos de 24 horas: le pasa la conversación a la recepción.
3. Tocá **Guardar plazo**.

Si lo dejás vacío no hay plazo, y el asistente puede cambiar un turno hasta que
empieza. Es lo que tiene una sede nueva. Con 0 tampoco hay plazo.

## Aviso de privacidad {#aviso-de-privacidad}

Antes de activar un agente, la clínica tiene que cargar su **aviso de
privacidad** y el **link a su política de privacidad**. Se cargan en
**Configuración → Organización**, en la tarjeta **Aviso de privacidad**. Sin
los dos, el agente se puede guardar pero no activar.

- El agente manda el aviso **una sola vez a cada contacto**, como mensaje
  aparte, justo antes de su primera respuesta. El link va abajo del texto.
- Queda registrado cuándo se le mandó. Si unís dos contactos, queda la fecha
  más vieja y el aviso no se repite.
- Si el primer mensaje es una **urgencia**, sale primero el mensaje de urgencia
  y el aviso va con la primera respuesta del agente que siga.
- En el chat del sitio web, el aviso aparece como primer mensaje de esa
  respuesta.
- Mientras haya agentes activos, el aviso y el link no se pueden borrar.

El botón **Usar el texto de ejemplo** carga un borrador para empezar. **No es
asesoramiento legal**: revisalo con un profesional antes de usarlo.

**Pendiente:** antes del primer paciente real, un profesional tiene que revisar
el texto y los puntos de privacidad de la ley 18.331 (si alcanza con informar o
hace falta un consentimiento expreso, plazos, transferencias, y el resto de la
lista de verificación del diseño). Hasta entonces, el aviso solo informa.
