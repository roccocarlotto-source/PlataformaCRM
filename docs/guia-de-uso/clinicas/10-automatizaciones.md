# Automatizaciones

Una automatización es una regla del tipo "cuando pasa tal cosa, hacé tal
otra": antes de cada turno, mandarle al paciente un recordatorio para que
confirme; cuando se atiende un turno, pedirle una reseña o recordarle el
próximo control; cuando alguien consultó y no volvió a escribir, escribirle de
nuevo. El sistema las ejecuta solo, sin que nadie las dispare.

Esta sección es para administradores: está dentro de **Agentes de IA** en el
menú, y Recepción no la ve.

## Reglas {#reglas}

La pantalla [Automatizaciones](/automations) lista las reglas de la clínica.
Para cada una se ve:

- **Nombre**: el que le pusiste, solo para reconocerla en esta lista.
- **Cuándo**: el evento que la dispara.
- **Qué hace**: la acción.
- **Estado de la regla**: **Activa** o **Inactiva**. Una regla inactiva no se
  ejecuta pero conserva su configuración.
- **Aprobación de WhatsApp**: si WhatsApp ya aprobó el mensaje de la regla
  (ver [Aprobación de WhatsApp](#aprobacion)). Una regla activa cuyo mensaje
  todavía está pendiente no le manda nada a nadie.

Podés buscar por nombre, filtrar por estado y ordenar por fecha de creación o
por nombre. El menú de cada fila ofrece **Editar** y **Eliminar**.

> **Eliminar** una regla la deja de ejecutar de inmediato. Lo que ya generó
> (tareas creadas, mensajes mandados) no se toca. Para pausarla unos días sin
> perder la configuración, editala y desmarcá **Activa**.

## Crear una regla {#nueva-regla}

1. En [Automatizaciones](/automations), tocá **Nueva automatización**.
2. Escribí un **Nombre** (por ejemplo, "Recordatorio de turnos"). Es solo para
   vos: no lo ve el paciente ni nadie más.
3. Dejá **Activa** marcada para que empiece a funcionar al guardar, o
   desmarcala para dejarla preparada.
4. En **Cuándo se ejecuta**, elegí el **Evento** y completá sus datos (ver
   [Eventos](#eventos)).
5. En **Qué hace**, elegí la **Acción** (ver [Acciones](#acciones)). El
   desplegable ofrece solo las acciones que tienen sentido con el evento
   elegido.
6. En la tarjeta **Mensaje de WhatsApp**, revisá o cambiá el texto que le
   llega al paciente (ver [Mensaje de WhatsApp](#mensaje-de-whatsapp)).
7. Tocá **Guardar**. El texto se manda a WhatsApp para que lo apruebe (ver
   [Aprobación de WhatsApp](#aprobacion)).

Al editar una regla se puede cambiar cualquier cosa, incluido el evento o la
acción; al cambiarlos, los datos de la configuración anterior se vacían
porque no significan lo mismo para la nueva.

## Eventos {#eventos}

Estos son los eventos de una clínica:

| Evento | Cuándo se dispara | Acciones que admite |
|---|---|---|
| **Consulta sin avance** | Cuando alguien consultó y lleva varios días sin responder. | **Retomar la consulta** |
| **Recordatorio antes del turno** | Antes de cada turno, con las horas que configura cada sede. | **Mandar el recordatorio por WhatsApp** |
| **Cuando se atiende un turno** | Cuando el turno se marca **Atendido**, o cuando se cierra solo a las 3 horas. | **Pedir una reseña con un QR** y **Recordar el control** |

### Consulta sin avance

Se dispara con los contactos (identificados o no) que escribieron por algún
canal y llevan la cantidad de **Días sin respuesta** que indiques sin volver a
escribir, siempre que no tengan la marca **sin interés** (ver
[Contactos](/ayuda/contactos-y-consultas#sin-interes)) ni un turno que los
frene (ver [Retomar la consulta](#retomar-la-consulta)). Se revisa una vez por
día, y solo puede haber una regla activa con este evento.

**Seguimientos como máximo** es cuántas veces se le vuelve a escribir por cada
vez que el paciente escribió: con 1, un solo seguimiento; con 2, otro más si
sigue sin contestar. Si el paciente responde, la cuenta arranca de cero. Viene
en 3 días y 1 seguimiento.

### Recordatorio antes del turno

No tiene datos propios en la regla: cuántas horas antes sale se configura en
cada sede. Solo puede haber una regla activa con este evento. Ver
[Recordatorio antes del turno](#recordatorio-de-turno).

### Cuando se atiende un turno

No tiene datos propios. Podés tener una regla para la reseña y otra para el
control. Ver [Después del turno](#despues-del-turno).

## Acciones {#acciones}

### Retomar la consulta

Le vuelve a escribir al paciente que consultó y no siguió. Qué pasa depende
del canal por el que escribió:

- **Por WhatsApp**, se le manda el mensaje aprobado de la tarjeta **Mensaje de
  WhatsApp**, dentro del horario de la sede. En una clínica sale siempre ese
  mensaje: el asistente nunca redacta uno por su cuenta.
- **Por Messenger, Instagram o el chat del sitio web**, o si una persona del
  equipo ya está atendiendo la conversación, no se le escribe: se crea una
  tarea, que dice qué prestación le interesa.

Si el paciente responde, el agente de IA sigue la conversación. Los detalles
están en [Retomar la consulta](#retomar-la-consulta).

### Mandar el recordatorio por WhatsApp

Le manda al paciente un WhatsApp antes del turno, con los botones **Confirmo**
y **Necesito cancelar**. No tiene más datos que el mensaje. Ver
[Recordatorio antes del turno](#recordatorio-de-turno).

### Pedir una reseña con un QR

Le manda al paciente un WhatsApp con un [código QR](/ayuda/cupones-y-qr),
típicamente el de reseñas de Google, después del turno atendido.

- **QR a enviar**: uno de los QR de la clínica. Si todavía no hay ninguno, la
  pantalla te manda a crearlo.
- **Esperar** y **Unidad**: cuánto esperar desde que se atiende el turno, en
  minutos, horas o días. Viene en 3 horas, que es también el mínimo: así hay
  tiempo de corregir un **No vino**. Si el turno se cerró solo, sale 24 horas
  después del cierre.

### Recordar el control

Le manda al paciente un WhatsApp para agendar el próximo turno cuando pasan
los días de control de la prestación. No tiene más datos que el mensaje: los
días se configuran en cada prestación (ver
[Recordar control](/ayuda/actividades-y-agenda#recordar-control)).

## Retomar la consulta {#retomar-la-consulta}

La regla **Consulta sin avance → Retomar la consulta** le escribe a un paciente
que consultó y lleva unos días sin responder. En una clínica tiene tres
particularidades:

- **No le escribe a quien ya tiene un turno.** Si el paciente tiene un turno
  confirmado para más adelante, o fue **atendido** en los últimos días (los mismos
  días de la regla), no recibe el mensaje. Si sacó un turno después de que se
  programó el mensaje, el mensaje se cancela antes de salir. Un turno marcado
  como **No vino** o uno cancelado no lo frenan.
- **Habla de la prestación.** En el texto del mensaje usá `{prestacion}`: va la
  prestación que consultó (por ejemplo, "limpieza facial") o, si no se sabe,
  "lo que consultaste". `{saludo}` sigue siendo obligatorio y va primero.
- **Siempre sale el mensaje aprobado por WhatsApp**, aunque el asistente esté en
  el nivel **Responde sola** y el paciente haya escrito hace menos de 24 horas.
  El asistente nunca redacta este mensaje por su cuenta.

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
3. En cada sede ([Sedes](/branches), sección **Recordatorios**) elegí con
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

El recordatorio sale desde el número de WhatsApp de la sede del turno, y sale
a la hora que corresponde aunque la sede esté cerrada. El paciente tiene que
tener un teléfono de WhatsApp cargado.

### Qué pasa con la respuesta

- **Confirmo:** el turno queda **Confirmado por el paciente** (se ve en el
  detalle del turno, ver
  [Confirmado por el paciente](/ayuda/actividades-y-agenda#confirmado-por-el-paciente)),
  con una nota en la ficha. El paciente recibe "¡Gracias! Te esperamos."
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
cuando se cierra solo a las 3 horas; ver
[Atendido y No vino](/ayuda/actividades-y-agenda#atendido-no-vino)) hay dos
acciones:

- **Pedir una reseña con un QR:** un WhatsApp con el QR de reseñas que elijas.
  Sale al menos **3 horas** después del turno, para que puedas corregir un "No
  vino". Si el turno **se cerró solo**, sale **24 horas** después del cierre.
- **Recordar el control:** si la prestación tiene **Recordar control a los N
  días** (en [Prestaciones](/clinica/prestaciones), de 1 a 730 días), el paciente
  recibe un WhatsApp para agendar el próximo turno a los N días.

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

## Mensaje de WhatsApp {#mensaje-de-whatsapp}

Todas las acciones de una clínica mandan un WhatsApp, así que todas muestran
la tarjeta **Mensaje de WhatsApp**, donde escribís lo que le llega al paciente
en **Texto del mensaje**. La regla arranca con un texto sugerido que podés usar
tal cual o cambiar.

### Formato

Solo para **Pedir una reseña con un QR**:

- **Solo link**: el link va dentro del texto.
- **Solo imagen**: la imagen del QR arriba del texto, sin link.
- **Imagen y link**: la imagen arriba y el link en el texto.

Al cambiar de formato, si no tocaste el texto sugerido, se reemplaza por la
versión con o sin link que corresponde; si ya lo escribiste vos, no se toca.

### Variables

Dentro del texto se escriben marcas que el sistema reemplaza por el dato de
cada paciente. Los botones **Insertar** las agregan donde está el cursor.

| Acción | Variables |
|---|---|
| **Retomar la consulta** | `{saludo}` (obligatoria) y `{prestacion}` (opcional). Ver [Retomar la consulta](#retomar-la-consulta). |
| **Mandar el recordatorio por WhatsApp** | `{nombre}`, `{dia}` y `{hora}` (obligatorias), `{lugar}` y `{profesional}` (opcionales). Ver [Recordatorio antes del turno](#recordatorio-de-turno). |
| **Pedir una reseña con un QR** | `{nombre}` (obligatoria, una sola vez) y `{link}` (obligatoria, una sola vez, después de `{nombre}`; con **Solo imagen** no va). |
| **Recordar el control** | `{nombre}` (obligatoria, una sola vez), `{semanas}` y `{lugar}` (opcionales, a lo sumo una vez cada una). |

Cada acción acepta solo sus variables: una que no corresponde (por ejemplo,
`{dia}` en el control) no se puede guardar.

Ninguna variable puede ir al principio ni al final del texto: es una regla de
WhatsApp. "Hola {nombre}, gracias por venir…" está bien; "{nombre}, gracias…"
no.

La **Vista previa** muestra cómo le llega al paciente, con datos de ejemplo
(Ana, limpieza facial, Clínica Ejemplo (sede Centro), lunes 1 de marzo a las
10:30, un link de muestra) y la imagen del QR si el formato la lleva. En el
recordatorio, muestra también los botones.

## Aprobación de WhatsApp {#aprobacion}

WhatsApp no deja escribirle a alguien que no escribió en las últimas 24 horas
con cualquier texto: solo con mensajes que revisó y aprobó de antemano. Por
eso, al guardar una regla, el sistema le manda el texto a WhatsApp para que lo
apruebe. Vos no tenés que hacer nada más que guardar.

- La aprobación suele tardar de unos minutos a un día. Hasta entonces, la
  regla no le manda nada a nadie, aunque esté activa.
- El estado se ve en la tarjeta **Mensaje de WhatsApp** de la regla y en la
  columna **Aprobación de WhatsApp** de la lista:
  - **Sin enviar**: todavía no se mandó a aprobar; se manda al guardar.
  - **Pendiente**: WhatsApp lo está revisando. El botón **Consultar estado**
    pregunta si ya hay novedades.
  - **Aprobada**: el mensaje ya puede salir.
  - **Rechazada**: WhatsApp no lo aceptó, con el motivo entre paréntesis
    cuando lo informa. Cambiá el texto y guardá la regla para mandarlo de
    nuevo.
- Si cambiás el texto de una regla cuyo mensaje ya estaba aprobado, el nuevo
  se manda a aprobar y, mientras WhatsApp lo revisa, se sigue mandando el
  anterior. Guardar la regla sin tocar el texto no pide una aprobación nueva.

> Si al guardar aparece "La regla se guardó, pero el mensaje no se pudo
> mandar a aprobación de WhatsApp", la regla existe pero el mensaje no llegó
> a WhatsApp (por ejemplo, por un problema de conexión o de configuración
> del número). Leé el motivo y tocá **Guardar** de nuevo para reintentar.

### Horario de la sede

La reseña, el control y el seguimiento de una consulta solo se mandan dentro
del horario de atención de la sede, que se configura en [Sedes](/branches).
Si la espera de una regla vence a las 23:00, el mensaje sale cuando la sede
abre. Si no cargaste un horario, se usa el de siempre: lunes a sábado de 9:00
a 20:00. El recordatorio del turno es la excepción: sale a su hora aunque la
sede esté cerrada. Las respuestas del agente de IA a un paciente que escribe
salen a cualquier hora.
