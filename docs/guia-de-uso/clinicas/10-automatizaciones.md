# Automatizaciones

## Retomar la consulta {#retomar-la-consulta}

La regla **Consulta sin avance → Retomar la consulta** le escribe a un paciente
que consultó y lleva unos días sin responder. En una clínica funciona igual que
en cualquier organización, con tres diferencias:

- **No le escribe a quien ya tiene un turno.** Si el paciente tiene un turno
  confirmado para más adelante, o fue **atendido** en los últimos días (los mismos
  días de la regla), no recibe el mensaje. Si sacó un turno después de que se
  programó el mensaje, el mensaje se cancela antes de salir. Un turno marcado
  como **No vino** o uno cancelado no lo frenan.
- **Habla de la prestación, no de un vehículo.** En el texto del mensaje usá
  `{prestacion}`: va la prestación que consultó (por ejemplo, "limpieza facial")
  o, si no se sabe, "lo que consultaste". `{saludo}` sigue siendo obligatorio y
  va primero.
- **Siempre sale el mensaje aprobado por WhatsApp**, aunque el asistente esté en
  el nivel Autónomo y el paciente haya escrito hace menos de 24 horas. El
  asistente nunca redacta este mensaje por su cuenta.

| Variable | Qué va | |
|---|---|---|
| `{saludo}` | El saludo con el nombre del paciente ("Hola Ana"), o "Hola" a secas si no lo dio. | Obligatoria. |
| `{prestacion}` | La prestación que consultó, o "lo que consultaste". | Opcional, a lo sumo una vez, después de `{saludo}`. |

El texto con el que arranca una regla nueva es:

> ¡{saludo}! Te escribimos por tu consulta sobre {prestacion}. ¿Querés que te
> ayudemos a coordinar un turno?

Si el seguimiento le toca a una conversación de Messenger, Instagram o la web, o
a una que ya atiende una persona, en lugar del mensaje se crea una tarea, que
dice qué prestación le interesa.

## Recordatorio antes del turno {#recordatorio-de-turno}

Antes de cada turno, el paciente recibe un WhatsApp para **confirmar** o
**cancelar** con un botón. Lo usan solo las clínicas.

### Cómo se activa

1. En [Automatizaciones](/automations), creá una regla con el evento
   **Recordatorio antes del turno** y la acción **Mandar el recordatorio por
   WhatsApp**. Solo puede haber una activa.
2. Revisá el texto. Al guardar la regla, el texto se manda a WhatsApp (Meta)
   para que lo apruebe como mensaje de servicio (categoría UTILITY), con los
   botones **Confirmo** y **Necesito cancelar**. La tarjeta de la regla muestra
   si ya está aprobado. Hasta que lo aprueben, no sale ningún recordatorio.
3. En cada sede ([Sucursales](/branches), sección **Recordatorios**) elegí con
   cuántas horas de anticipación sale (de 1 a 72, por defecto 24) y qué pasa con
   un turno que se da con menos anticipación: **no mandar recordatorio** (por
   defecto), **mandarlo en el momento** o **mandarlo unas horas antes del
   turno**. Cambiarlo no mueve los recordatorios que ya están programados.

El texto con el que arranca la regla:

> Hola {nombre}, te recordamos tu turno en {lugar} el {dia} a las {hora} con
> {profesional}. ¿Nos confirmás si venís?

| Variable | Qué va | |
|---|---|---|
| `{nombre}` | El nombre del paciente. | Obligatoria. |
| `{lugar}` | El nombre de la clínica; si tiene más de una sede, "Clínica (sede Centro)". | Opcional. |
| `{dia}` | El día del turno ("lunes 1 de marzo"). | Obligatoria. |
| `{hora}` | La hora del turno ("10:30"). | Obligatoria. |
| `{profesional}` | El profesional. | Opcional. |

Van en ese orden. **El recordatorio no lleva la prestación ni ningún dato de
salud**: se ve en la pantalla del teléfono.

### Qué pasa con la respuesta

- **Confirmo:** el turno queda **Confirmado por el paciente** (se ve en el
  detalle del turno), con una nota en la ficha. El paciente recibe "¡Gracias!
  Te esperamos."
- **Necesito cancelar:** el turno se cancela y la recepción de la sede recibe
  una tarea para ofrecerle otro horario. Si la sede tiene una **anticipación
  mínima para cambiar un turno** y falta menos que eso, el turno **no** se
  cancela: la recepción recibe una tarea para resolverlo con el paciente.
- **Si escribe un mensaje en vez de tocar un botón**, lo atiende el asistente
  como cualquier otro mensaje, y la tarea de "sin respuesta" sigue su curso.
- **Si no responde**, el turno **no se cancela**: 4 horas después del
  recordatorio (o 2 horas antes del turno, si eso es antes) la recepción de la
  sede recibe una tarea "Confirmar por teléfono el turno de…". Si el turno es a
  menos de 2 horas, no hay tarea. Si después confirma, la tarea se cierra sola.

Los botones funcionan con cualquier nivel del asistente, y también con el
asistente apagado. Si el turno se reprograma, el recordatorio se recalcula
para el horario nuevo; si se cancela, no sale.

## Después del turno: reseña y control {#despues-del-turno}

Con el evento **Cuando se atiende un turno** (cuando lo marcás **Atendido**, o
cuando se cierra solo a las 3 horas) hay tres acciones:

- **Pedir una reseña con un QR:** un WhatsApp con el QR de reseñas que elijas.
  Sale al menos **3 horas** después del turno, para que puedas corregir un "No
  vino". Si el turno **se cerró solo**, sale **24 horas** después del cierre.
- **Recordar el control:** si la prestación tiene **Recordar control a los N
  días** (en [Prestaciones](/clinica/prestaciones), de 1 a 730 días), el paciente
  recibe un WhatsApp para agendar el próximo turno a los N días.
- **Crear actividad de seguimiento:** una tarea para la recepción de la sede del
  turno, con el paciente, que vence a los días que elijas desde que el turno se
  marcó atendido. Es una sola por turno. Si después lo marcás **No vino**, la
  tarea se cierra sola con una nota; si lo volvés a marcar **Atendido**, se
  reabre. No manda nada al paciente.

Texto propuesto del control (sin datos de salud):

> Hola {nombre}, ya pasaron {semanas} semanas desde tu último turno en {lugar}.
> Si querés agendar el próximo, escribinos por acá.

Texto propuesto de la reseña:

> Hola {nombre}, gracias por venir. Si querés contarnos cómo te fue, podés
> dejarnos tu reseña acá: {link} ¡Gracias!

Las dos se dan de alta como las demás: al guardar la regla, el texto se manda a
WhatsApp (Meta) para aprobar, y la tarjeta de la regla muestra el estado.

- Si después marcás **No vino**, lo que no salió se cancela. Lo que ya salió no
  se vuelve a mandar.
- Salen dentro del horario de atención de la sede.
- El control no sale si el paciente ya tiene un turno futuro de esa prestación,
  o si está marcado "sin interés".
