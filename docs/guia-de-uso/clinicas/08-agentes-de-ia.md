# Agentes de IA

Un agente de IA es el asistente automático de la clínica: atiende a los
pacientes por WhatsApp, por el chat del sitio web, por Messenger o por
Instagram. Contesta consultas sobre turnos, horarios, precios y lo que esté
cargado en la información de la clínica, busca horarios libres en la agenda,
agenda turnos y, cuando hace falta, le pasa la conversación a una persona de
recepción. **No responde consultas de salud** (ver
[Lo que el asistente no responde](#consultas-de-salud)). Todo lo que hace
queda registrado en [Conversaciones](/ayuda/conversaciones#bandeja).

Toda la configuración de esta sección es para administradores: Recepción no
ve la sección **Agentes de IA** del menú. Esa sección incluye también la
[Base de conocimiento](/ayuda/base-de-conocimiento#entradas), las
[Automatizaciones](/automations) y la configuración del
[agente interno](#agente-interno).

## Los agentes {#agentes}

La pantalla [Agentes de IA](/agents) lista los agentes de la clínica. Cada
agente pertenece a una sede: atiende con los datos, el horario y la agenda de
esa sede. Lo habitual es un agente por sede.

Para cada agente se ve:

- **Nombre**.
- **Sede**.
- **Estado**: **Activo** o **Inactivo**. Un agente inactivo no responde ningún
  mensaje.
- **Canales**: por dónde atiende. Si no tiene ninguno, aparece un guion: el
  agente no atiende por ningún lado.
- **Modelo**: el modelo de inteligencia artificial que usa. Lo elige el
  equipo de la plataforma.

Podés buscar por nombre, filtrar por **Sede** y por **Estado**, y ordenar por
fecha de creación o por nombre. El menú de cada fila ofrece:

- **Editar**: la configuración completa (ver abajo).
- **Instalar en un sitio**: el código para poner el chat en la página web de
  la clínica (ver [Instalar el chat en un sitio web](#instalar-en-un-sitio)).
- **Probar agente**: una pantalla para conversar con él como si fueras el
  paciente (ver [Probar el agente](#probar)).
- **Eliminar**.

> **Eliminar** un agente lo deja de responder de inmediato y desactiva el
> chat de los sitios web donde esté instalado. Las conversaciones que ya
> atendió quedan en el historial. Si solo querés pausarlo, desmarcá
> **Activo** en su configuración.

### Días y horarios en que responde {#dias-y-horarios}

Un agente activo responde a cualquier hora, todos los días. El
[horario de atención](/ayuda/organizacion-y-sucursales#horario) de la sede
no lo limita, y no hay una opción para que no responda ciertos días (por
ejemplo, los domingos) o en cierto horario. Las alternativas:

- **Pausarlo a mano**: desmarcá **Activo** en su configuración y volvé a
  marcarlo cuando quieras que responda de nuevo.
- **Primer contacto, solo fuera del horario**: si tu clínica tiene la tarjeta
  [Cuánto hace la IA](#nuevo-agente), con el nivel **Primer contacto** podés
  marcar **Solo fuera del horario de la sede**. Dentro del horario
  atiende recepción y el agente no responde; fuera del horario, el agente toma el
  primer contacto. Ojo: un día sin franjas en el horario (un domingo en que no
  abren, por ejemplo) cuenta como fuera del horario, así que ese día el agente
  sí responde.

## Crear o editar un agente {#nuevo-agente}

En [Agentes de IA](/agents), tocá **Nuevo agente**, o **Editar** en la fila de
uno existente. La configuración está repartida en tarjetas; estas son las de
**Datos del agente**:

- **Nombre**: cómo lo ves en la lista. También es el nombre con el que se
  presenta en el probador.
- **Sede**: la sede a la que pertenece. Se elige al crearlo y no se puede
  cambiar después, porque las conversaciones que ya atendió quedaron
  registradas con esa sede. Si necesitás un agente en otra sede, creá uno
  nuevo.
- **Objetivo**: un resumen corto, para vos, de para qué está este agente (por
  ejemplo, "Atender consultas y agendar turnos en Sede Centro"). El agente no
  lo lee: lo que lo guía son las [Instrucciones](#instrucciones).
- **Tono**: una o dos palabras ("formal", "cercano"). Es solo informativo; el
  tono real se lo das escribiéndolo en las instrucciones.
- **Avisar al paciente si nadie responde en (minutos)** y **Mensaje cuando no
  hay nadie disponible**: qué pasa cuando el agente le pasa la conversación a
  una persona y nadie contesta. Ver [Derivar a una persona](#derivar).
- **Activo**: si está desmarcado, el agente no responde.

> Para poder activar un agente, la clínica tiene que tener cargado su
> [aviso de privacidad](#aviso-de-privacidad). Sin eso, el agente se guarda
> pero no se activa.

### Cuánto hace la IA

Si tu clínica tiene la tarjeta **Cuánto hace la IA**, ahí elegís el **Nivel**
del agente. Es obligatorio: hasta que no elijas uno, no se puede marcar
**Activo**.

| Nivel | Qué hace en una clínica |
|---|---|
| **Responde sola** | Conversa con el paciente y usa las [acciones habilitadas](#acciones): busca horarios, agenda turnos y, si las activaste, ve, reprograma y cancela los turnos del paciente. |
| **Primer contacto** | Responde hasta 2 veces, toma los datos y le pasa la conversación a recepción. No agenda ni cambia turnos: eso lo hace recepción. Podés marcar que atienda así solo fuera del horario de la sede. |
| **Solo seguimiento** | No conversa con el paciente: todo lo atiende una persona. Los [recordatorios de turno](/ayuda/automatizaciones#recordatorio-de-turno) y sus botones siguen funcionando, y si un paciente escribe una urgencia igual recibe el mensaje del 911. |

En cualquier nivel valen las reglas de salud: el asistente no responde
consultas de salud.

### Modelo y guardado

La tarjeta **Modelo** es de solo lectura: el proveedor y el modelo de
inteligencia artificial los elige el equipo de la plataforma. Si este agente
necesita otro, pedíselo.

Para guardar, tocá **Guardar** al pie. Si escribiste o cambiaste las
[Reglas del agente](#reglas), antes de guardar se te muestra qué entendió el
sistema para que lo confirmes.

## Instrucciones {#instrucciones}

Es el campo más importante: el texto que el agente lee antes de cada
conversación. Es obligatorio y no tiene límite de largo. Escribilo como le
explicarías el trabajo a alguien que entra a atender la recepción:

- **Qué es la clínica**: qué prestaciones ofrece, en qué zona, qué la
  distingue.
- **Qué tiene que lograr**: por ejemplo, responder consultas sobre
  prestaciones y precios, conseguir el nombre y el teléfono del paciente,
  ofrecerle un turno.
- **Cómo tiene que hablar**: formal o cercano, corto o detallado, si usa
  emojis. Si no decís nada, el asistente trata de vos, en español
  rioplatense; si preferís otro trato (de usted, por ejemplo), escribilo acá.
- **De qué temas no puede hablar**: por ejemplo, de otras clínicas o de
  promociones que no estén vigentes.
- **Qué promesas no puede hacer**: descuentos, resultados de una prestación,
  horarios que no confirmó en la agenda.
- **Cuándo tiene que pasarle la conversación a una persona**: reclamos, un
  paciente enojado, cualquier cosa que preferís que maneje recepción.

Cosas que no hace falta escribir acá:

- Que no responda consultas de salud: eso el sistema lo hace cumplir siempre,
  con o sin instrucciones (ver [Lo que el asistente no responde](#consultas-de-salud)).
- Los horarios, los precios, las formas de pago y las preguntas frecuentes de
  la sede van mejor en la
  [Base de conocimiento](/ayuda/base-de-conocimiento#nueva-entrada): el agente
  la lee junto con las instrucciones, y se puede mantener sin tocar al agente.
  Las indicaciones antes y después de una prestación también van ahí (ver
  [Indicaciones](#indicaciones)).
- Las prestaciones y los horarios libres: el agente los consulta en la agenda
  si tiene habilitadas **Ver prestaciones** y **Consultar disponibilidad** (ver
  [Acciones habilitadas](#acciones)).
- Las prohibiciones que querés que se cumplan sí o sí sobre lo que el agente
  *hace* (no lo que dice) van en [Reglas del agente](#reglas).

> Todo lo que está en las instrucciones puede terminar, de una u otra forma,
> en lo que el agente le dice al paciente. No pongas datos internos ni datos
> de pacientes.

## Canales {#canales}

En la tarjeta **Capacidades**, el campo **Canales** define por dónde atiende
el agente. Sin canales, no atiende por ningún lado. Cada canal necesita algo
más para funcionar:

| Canal | Qué hace falta |
|---|---|
| **WhatsApp** | Un número de WhatsApp asignado a este agente. Lo configura el equipo de la plataforma: el campo **ID del número de WhatsApp** es de solo lectura y muestra si ya lo tiene. Si este agente tiene que atender por WhatsApp y el campo está vacío, pedíselo a la plataforma. Ese número es también el que usan los recordatorios de turno y las automatizaciones de esa sede. |
| **Web** | Instalar el chat en el sitio: ver [Instalar el chat en un sitio web](#instalar-en-un-sitio). |
| **Messenger** e **Instagram** | La página de Facebook de la clínica conectada por el equipo de la plataforma, y asignada a este agente. Instagram requiere que la página tenga una cuenta de Instagram vinculada. |

Un paciente puede escribir por más de un canal: cada canal es una
conversación distinta en [Conversaciones](/ayuda/conversaciones#bandeja).

## Acciones habilitadas {#acciones}

Además de conversar, el agente puede *hacer* cosas en el sistema. Cada una es
una acción que habilitás o no en **Acciones habilitadas**, en la tarjeta
**Capacidades**. Un agente sin acciones solo conversa (y aun así puede pasarle
la conversación a una persona: eso está siempre disponible).

> Habilitar una acción es necesario pero no alcanza: antes de ejecutar
> cualquiera, el sistema la vuelve a revisar contra las
> [Reglas del agente](#reglas). Si una regla la prohíbe, no se ejecuta aunque
> esté habilitada.

Estas son las acciones que ve una clínica:

**Ver prestaciones.** Lista las prestaciones de la sede, con su duración y los
profesionales que las atienden. La usa antes de consultar disponibilidad, para
saber qué prestación pide el paciente. Solo ofrece las prestaciones que están
en esa lista.

**Consultar disponibilidad.** Busca los horarios libres de una prestación en
un rango de fechas. Si el paciente pidió un profesional, mira solo el de ese
profesional; si le da lo mismo, mira los de todos los profesionales de la
prestación. La usa antes de agendar, y también cuando el paciente pregunta
cuándo puede ir.

**La acción de agendar el turno.** En la lista aparece justo después de
**Consultar disponibilidad**. Agenda el turno para el paciente en uno de los
horarios que encontró libres. Si el paciente eligió un profesional, va con
ese; si no, con el primero libre en ese horario. La duración la define la
prestación. Le confirma el turno al paciente recién cuando quedó agendado. Un
paciente puede tener como mucho dos turnos futuros agendados por el agente.

> El asistente **nunca le confirma al paciente un turno que no agendó,
> cambió o canceló en ese mismo momento**. Si llega a escribir algo como "Ya
> te reservé el turno" sin haberlo hecho, ese mensaje no sale: el paciente
> recibe "Perdón, me expresé mal y no quiero confirmarte algo que no hice…" y
> la conversación sigue con el asistente.

**Ver turnos del paciente.** Lista los próximos turnos del paciente de la
conversación.

**Reprogramar turno.** Cambia el día, la hora o el profesional de un turno del
paciente.

**Cancelar turno.** Cancela un turno del paciente, respetando la
[anticipación mínima](#anticipacion-minima) de la sede.

Las tres últimas funcionan solo en el nivel **Responde sola**; cómo las usa el
agente está en [Cambiar o cancelar turnos por chat](#cambiar-o-cancelar-turnos).

**Calificar el lead.** Registra la calificación inicial del paciente: puntaje,
intención, prestación de interés, urgencia, presupuesto y zona. La usa la
primera vez que reúne esos datos en la conversación. Todos los datos son
opcionales: guarda los que conoce. En una clínica el agente no escribe notas
sobre el paciente.

**Actualizar la calificación.** Actualiza esa calificación cuando aparece
información nueva o cambia algo. También es la acción con la que guarda el
nombre y el apellido del paciente.

**Guardar campos personalizados.** Completa en la ficha del paciente los
[campos personalizados](/ayuda/campos-personalizados) que marcaste como
editables por el agente, en el momento en que el paciente le da ese dato. Los
campos que no son editables por el agente los lee pero no los toca.

**Ver datos del contacto.** Consulta los datos que el sistema ya tiene del
paciente (nombre, apellido, email, teléfono). La usa para no preguntar el
nombre dos veces, y antes de pasar la conversación, para que quien la retome
tenga contexto.

**Ver tareas pendientes del contacto.** Lista las tareas que el equipo ya
tiene agendadas para ese paciente (llamados, recordatorios). La usa antes de
prometer un llamado o de pasar la conversación, para no duplicar algo que ya
está agendado.

**Marcar sin interés.** Marca al paciente como "sin interés" cuando dice
claramente que no quiere seguir ("no gracias", "ya me atendí en otro lado",
"no me escribas más"). Desde ese momento ningún seguimiento automático le
vuelve a escribir, y recepción lo ve en la
[ficha](/ayuda/contactos-y-consultas#sin-interes). No la usa por un "lo voy a
pensar", un "después te aviso" o un silencio. Ningún agente la trae
habilitada.

> Para agendar un turno, el agente necesita el nombre y el apellido del
> paciente (y, por el chat del sitio web, un teléfono o un email), y los
> guarda con **Actualizar la calificación** o **Calificar el lead**. Si
> habilitás la acción de agendar sin ninguna de esas dos, el agente va a pedir
> el nombre pero no va a poder guardarlo, y el turno nunca se va a agendar. La
> pantalla te lo avisa.

**Lo que el agente ya sabe del paciente.** En cada mensaje, el agente ve los
datos que el sistema tiene del paciente (nombre, apellido y, salvo en el chat
del sitio web, email y teléfono) y sus turnos en la sede de la conversación
que todavía no pasaron. Por eso no vuelve a pedir el nombre y el apellido si
ya están cargados, y si el paciente pregunta por un turno que agendó en un
mensaje anterior, se lo confirma en vez de agendarlo de nuevo. Los turnos los
ve solo cuando el paciente está identificado: con nombre y apellido y, por el
chat del sitio web, también un teléfono o un email. Hasta entonces, si el
paciente pregunta por ellos, primero le pide esos datos.

## Reglas del agente {#reglas}

La tarjeta **Reglas del agente** es para las prohibiciones que el sistema
hace cumplir sí o sí, con un control propio, antes de dejar pasar cada
acción. El agente no puede saltearlas. Se escriben en tus palabras, y sirven
para tres cosas:

- **Qué acciones no puede ejecutar nunca**, aunque estén habilitadas arriba.
  Por ejemplo: "No marques a ningún paciente como sin interés."
- **Qué datos no puede modificar.** Por ejemplo: "No modifiques el email ni el
  teléfono de un paciente."
- **Qué tiene que saber antes de ejecutar una acción.** Por ejemplo: "Antes de
  agendar un turno, asegurate de tener el nombre y el teléfono del paciente."

Lo demás (los temas de los que no querés que hable, las promesas que no puede
hacer y cuándo tiene que pasar la conversación a una persona) va en
[Instrucciones](#instrucciones): son indicaciones que el agente sigue, no
candados que el sistema verifica.

Si dejás el campo vacío, el agente no tiene ninguna restricción además de las
acciones que habilitaste y de las reglas de salud, que valen siempre.

> **Ver turnos del paciente**, **Reprogramar turno** y **Cancelar turno**
> todavía no se pueden prohibir con una regla. Si no querés que el agente las
> use, no las habilites.

### Confirmar lo que se entendió

Como las reglas se escriben en lenguaje natural, al tocar **Guardar** el
sistema las interpreta y te muestra, en un panel llamado **Esto es lo que
entendimos**, la lista de reglas tal como van a regir. Por ejemplo:

- No puede ejecutar estas acciones: Marcar sin interés.
- No puede modificar estos datos: email, teléfono.

Revisala. Si coincide con lo que quisiste decir, tocá **Confirmar y
guardar**. Si no, tocá **Volver a editar**, corregí el texto y guardá de
nuevo. El panel no se cierra tocando afuera: hay que elegir una de las dos.

Si escribiste algo que el sistema no puede hacer cumplir (una acción que no
existe, un dato que ninguna acción toca, una frase demasiado larga), aparece
en rojo bajo **Esto no se puede aplicar y no va a quedar configurado**. No se
descarta nada en silencio: si te importa, reescribilo o pasalo a las
instrucciones.

El panel tiene al final un desplegable **Ver JSON** con el detalle técnico de
lo mismo que se lista arriba. Podés ignorarlo.

Si la interpretación falla (por ejemplo, por un problema de conexión), el
agente no se guarda: aparece el error y un botón **Reintentar**. Nunca queda
guardado con las reglas vacías por accidente. Si guardás sin haber tocado el
texto de las reglas, no se vuelve a interpretar nada.

## Derivar a una persona {#derivar}

Pasarle la conversación a una persona ("derivar") siempre está disponible,
con o sin acciones habilitadas. El agente deriva cuando el paciente lo pide,
cuando las instrucciones se lo indican, cuando no puede resolver algo y,
siempre, ante una [consulta de salud](#consultas-de-salud). Al derivar:

1. La conversación queda marcada como derivada en
   [Conversaciones](/ayuda/conversaciones#atender), y se crea una tarea para
   recepción de la sede de la conversación. Va al **Responsable por defecto**
   de la sede si es de Recepción y tiene esa sede; si no, a la persona de
   Recepción de esa sede con menos tareas abiertas. Si la sede no tiene nadie
   de Recepción, va al responsable por defecto o, si tampoco hay, al
   administrador más antiguo: la tarea y la conversación nunca quedan sin
   nadie asignado. Cualquier
   persona de Recepción de la sede ve esa tarea y la puede tomar (ver
   [Sedes de cada persona de recepción](/ayuda/usuarios-y-permisos#sedes)).
2. Mientras nadie del equipo escribe, el agente sigue contestando al paciente
   para no dejarlo sin respuesta. Las excepciones son las consultas de salud
   y los cambios de turno fuera de la
   [anticipación mínima](#anticipacion-minima): después de una de esas
   derivaciones, el agente no vuelve a escribir en esa conversación hasta que
   alguien toque **Devolver al agente**.
3. Cuando una persona responde en la conversación, el agente se calla: esa
   conversación la atiende la persona hasta que toque **Devolver al agente**.

El agente también deriva solo, con un mensaje fijo, cuando algo técnico le
impide contestar: el servicio del modelo no responde, el turno tarda demasiado,
o la respuesta le sale tan larga que se corta dos veces seguidas (la primera
vez lo vuelve a intentar pidiéndose una respuesta más corta). La tarea dice
cuál de esas fue.

Dos campos del agente definen qué pasa si nadie responde:

- **Avisar al paciente si nadie responde en (minutos)**: si pasan esos
  minutos sin que nadie del equipo le escriba, el paciente recibe un único
  aviso de que no hay nadie disponible, la conversación vuelve al agente y la
  tarea para contactarlo queda pendiente. Viene en 15. Vacío o 0: no se
  avisa. El máximo es un día (1440 minutos).
- **Mensaje cuando no hay nadie disponible**: el texto de ese aviso. Es
  también lo que recibe el paciente si alguien toca **Devolver al agente** sin
  haberle respondido. Si lo dejás vacío se usa el de siempre: "Por el momento
  no hay nadie del equipo disponible. Te vamos a contactar más tarde.
  Mientras tanto, si querés, puedo seguir ayudándote."

> No escribas el horario en ese mensaje. Si la sede tiene horario cargado en
> [Sedes](/branches) y está cerrada cuando se manda, el sistema agrega solo al
> final cuándo atiende el equipo y cuándo le van a escribir, por ejemplo "Te
> vamos a escribir mañana a partir de las 9".

## Lo que el asistente no responde {#consultas-de-salud}

El asistente de la clínica ayuda con turnos, horarios, precios y lo que esté
cargado en la información de la clínica. **No responde consultas de salud.**
Esto no se puede apagar: vale para todos los canales (WhatsApp, Messenger,
Instagram y el chat de la web) y para cualquier nivel del asistente. Lo que sí
puede cambiar un administrador es el texto de los dos mensajes de abajo y
sumar palabras a las que el asistente detecta, en
[Mensajes de salud](/ayuda/organizacion-y-sucursales#mensajes-de-salud).

Cuando un paciente escribe algo de salud, el asistente no le contesta con sus
palabras: le manda un mensaje fijo y te pasa la conversación.

| Qué escribió el paciente | Qué le contesta el asistente | Qué te llega a vos |
|---|---|---|
| Una posible urgencia: "no puedo respirar", "se me hinchó la cara", "me duele el pecho", "me desmayé", o una palabra de urgencia que agregó la clínica | El mensaje de urgencia. Por defecto: que llame ya al 911 o a su emergencia móvil, y que ya le avisaron al equipo | Una tarea que empieza con **URGENTE**, vencida desde el primer minuto |
| Una consulta clínica: un síntoma o una reacción ("me arde", "me salieron granitos"), medicación, embarazo o lactancia, "¿es normal que…?", o una palabra de consulta clínica que agregó la clínica | El mensaje de consulta clínica. Por defecto: que esa consulta la tiene que ver un profesional y que ya le pasaron el mensaje al equipo | Una tarea "Consulta clínica: ver la conversación" |

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

## Indicaciones antes y después de una prestación {#indicaciones}

En la [base de conocimiento](/knowledge-base), cada entrada tiene un **Tipo**:
**Información general** o **Indicaciones antes o después de una prestación**.

- Las **indicaciones** (por ejemplo, "Antes de la depilación láser") no las
  escribe el asistente: él solo ve los **títulos**. Cuando un paciente pide una,
  el sistema le manda **el texto que cargaste, tal cual**, como un mensaje
  aparte. El asistente no lo resume, no lo explica y no lo adapta al caso de
  cada paciente.
- Por eso importa el **título**: que diga con claridad de qué prestación es y
  si es antes o después ("Después del peeling", no "Indicaciones 2").
- **Lo que cargues ahí le llega al paciente textualmente.** No cargues datos
  de pacientes.
- Si un paciente pregunta por un síntoma o "¿es normal que…?", el asistente no
  responde con la indicación: pasa la conversación a la recepción, como
  cualquier [consulta de salud](#consultas-de-salud).
- Cada entrada es de una sede: el asistente de otra sede no la ve.

## Cambiar o cancelar turnos por chat {#cambiar-o-cancelar-turnos}

Si el asistente está en el nivel **Responde sola**, puede ver, reprogramar y
cancelar los turnos del paciente con el que está hablando. Para eso, en
**Acciones habilitadas** del asistente activá **Ver turnos del paciente**,
**Reprogramar turno** y **Cancelar turno**. En el nivel **Primer contacto** el
asistente no cambia turnos: toma los datos y lo hace la recepción.

- Antes de reprogramar, el asistente le confirma al paciente qué turno es y el
  día, la hora y el profesional nuevos.
- **Cancelar va en dos pasos.** Primero el asistente le muestra al paciente el
  turno (día, prestación y profesional) y le pregunta si confirma que lo
  quiere cancelar. Recién cuando el paciente contesta que sí, en su mensaje
  siguiente, el turno se cancela. Nunca cancela en el mismo mensaje en que el
  paciente lo pide.
- El día de cada turno se lo dice con el día de la semana correcto, en el
  horario de la sede ("lunes 12 de octubre, 09:30").
- Solo ofrece horarios libres de la agenda: **nunca carga un sobreturno**.
- Solo toca turnos de ese paciente y de la sede de la conversación.
- Un turno que ya empezó o ya pasó no lo cambia.
- Si la sede tiene una **anticipación mínima**, con menos tiempo que ese el
  asistente no cambia ni cancela el turno. El paciente recibe un mensaje fijo
  ("Para ese turno ya falta poco, y por este medio no se puede cambiar ni
  cancelar. Ya le pasé tu pedido al equipo de…"), la conversación te llega con
  una tarea para la recepción de la sede, y el asistente no vuelve a escribir
  en esa conversación hasta que toques **Devolver al agente**.
- Si algo no se puede (no hay horarios, el turno ya pasó, hay dudas), te pasa
  la conversación.
- Cada cambio queda en la ficha del paciente con **Asistente** como autor.
- Si en el mismo mensaje el paciente cuenta un síntoma o una urgencia, eso va
  primero: el asistente responde con el mensaje fijo de salud y no toca el
  turno.

Lo mismo que hace recepción a mano está en
[Reprogramar un turno](/ayuda/actividades-y-agenda#reprogramar).

### Anticipación mínima para cambiar un turno {#anticipacion-minima}

Lo configura un administrador, por sede:

1. Entrá a [Sedes](/branches) y abrí la sede.
2. En **Turnos por chat**, completá **Anticipación mínima para cambiar un turno
   (horas)**. Por ejemplo, con 24 el asistente no reprograma ni cancela un turno
   que empieza en menos de 24 horas: le pasa la conversación a la recepción.
3. Tocá **Guardar plazo**.

Si lo dejás vacío no hay plazo, y el asistente puede cambiar un turno hasta que
empieza. Es lo que tiene una sede nueva. Con 0 tampoco hay plazo.

## Aviso de privacidad {#aviso-de-privacidad}

Antes de activar un agente, la clínica tiene que cargar su **aviso de
privacidad** y el **link a su política de privacidad**. Se cargan en
**Administración → Organización**, en la tarjeta **Aviso de privacidad**. Sin
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

## Instalar el chat en un sitio web {#instalar-en-un-sitio}

Para que el agente atienda por el canal **Web**, hay que pegar un código en
el sitio de la clínica. Desde la lista de agentes, **Instalar en un sitio**
abre una pantalla con tres pasos, en el orden en que hay que hacerlos. Es
para administradores; el pegado del código lo hace quien administra el
sitio web.

### 1. Dominios permitidos

El chat solo funciona desde los sitios que estén en esta lista. Es a
propósito: aunque alguien copie el código, no sirve en un sitio que no esté
autorizado.

1. Escribí el dominio en el campo y tocá **Agregar** (o Enter). Solo el
   dominio, con `https://` y sin ninguna ruta después: `https://tusitio.com`,
   no `https://tusitio.com/contacto`.
2. Si el sitio también se abre con `www` (`https://www.tusitio.com`),
   agregalo también: para el navegador son dos sitios distintos.
3. Tocá **Guardar dominios**. Hasta que no guardes, la lista no vale.

Para sacar un dominio, tocá la cruz en su etiqueta y guardá. Se pueden cargar
hasta 50.

### 2. Tokens de embed

El **token** es una clave que identifica a este agente en el código que se
pega en el sitio. Tocá **Generar token nuevo**: aparece una sola vez, en ese
momento, con un botón para copiarlo.

> Esta es la única vez que vas a ver el token completo. El sistema no lo
> guarda: si lo perdés, hay que revocarlo y generar otro. En la tabla queda
> solo su prefijo (los primeros caracteres), para saber cuál es cuál, con la
> fecha de creación y de último uso.

**Revocar** un token deja de funcionar el chat que lo esté usando, de
inmediato: habrá que pegar el código de nuevo con un token nuevo. Usalo si
sospechás que el token se filtró o si cambiás de sitio.

### 3. Código para instalar en el sitio

Es el texto que hay que pegar en el sitio, antes del cierre de la página
(justo antes de `</body>`), en todas las páginas donde tenga que aparecer el
chat. **Copiar código** lo copia entero.

- Si acabás de generar un token en el paso 2, el código ya lo tiene puesto.
- Si volviste a esta pantalla otro día, el código trae la marca
  `PEGÁ_ACÁ_TU_TOKEN` en lugar del token, porque no se puede volver a ver.
  Generá uno nuevo (el código se completa solo) o reemplazá la marca a mano
  por el token que tengas guardado.
- Si todavía no hay ningún dominio guardado, la pantalla avisa que el código
  no va a funcionar hasta que agregues uno.

En el chat del sitio también valen las reglas de salud y el aviso de
privacidad.

## Probar el agente {#probar}

**Probar agente** abre la pantalla **Probar el agente**, para conversar con el
agente escribiendo como si fueras el paciente, y ver qué contesta y qué hace.

> No es una prueba aislada. Los mensajes generan una conversación real con el
> contacto que elijas, y si el agente tiene acciones habilitadas puede agendar,
> reprogramar o cancelar turnos de verdad, calificar al contacto o pasarle la
> conversación a recepción. Usá un contacto de prueba propio (por ejemplo, uno
> con tu nombre), nunca un paciente real.

1. Elegí el **Paciente** con el que vas a conversar.
2. Si el agente atiende por más de un canal, elegí el **Canal**. Si tiene uno
   solo, ya está elegido. Si no tiene ninguno, la pantalla te manda a editar
   el agente: sin canales no hay nada que probar. Lo mismo si el agente está
   desactivado.
3. Escribí en el cuadro de abajo como si fueras el paciente y tocá **Enviar**
   (Enter manda; Shift+Enter hace un salto de línea).

En la transcripción ves tus mensajes (como **Paciente (vos)**), las
respuestas del agente y, entre medio, lo que hizo en cada paso:

- Cada acción que intentó, con su nombre (por ejemplo, **Consultar
  disponibilidad**). Si no se pudo, al lado dice **No se permitió** (una regla
  la bloqueó) o **Falló**. Los datos que usó, el resultado y el motivo quedan
  cerrados en **Ver detalles técnicos**: tocalo para abrirlos.
- **Se derivó esta conversación a un humano**, con un link a la tarea de la
  derivación si se creó una.
- **El agente no respondió** cuando una persona del equipo ya está atendiendo
  esa conversación: el mensaje quedó registrado pero el agente no contesta
  mientras atienda una persona.

Si probás con un mensaje de salud ("me arde la piel"), vas a ver la respuesta
fija y la derivación, igual que le pasaría a un paciente.

Lo que se ve es solo lo que pasó desde que abriste la pantalla. El hilo
completo, con lo de otras veces, está en
[Conversaciones](/ayuda/conversaciones#detalle). Cambiar de contacto limpia la
pantalla.

## Agente interno del equipo {#agente-interno}

Además de los agentes que hablan con los pacientes, la clínica tiene un
agente interno: un asistente de IA para el propio equipo, que se usa desde el
chat **Agente interno** del menú principal (ver
[El agente interno](/ayuda/primeros-pasos#agente-interno)). Sirve para
pedirle cosas en lenguaje natural, como "agendame una tarea para llamar a Ana
Pérez el jueves" o "¿qué turnos hay mañana en Sede Centro?".

Quién lo puede usar:

- Un administrador, siempre.
- Una persona de Recepción, solo si un administrador le habilita **Acceso al
  agente interno** en [Usuarios](/ayuda/usuarios-y-permisos#usuarios).

Hasta que no esté configurado, el chat avisa que todavía no hay un agente
interno. Lo configura un administrador en **Configurar agente interno**,
dentro de la sección **Agentes de IA**. Hay uno solo por clínica.

- **Nombre**: como se presenta en el chat.
- **Instrucciones**: lo que lee antes de cada respuesta. Qué es la clínica,
  cómo tiene que contestar y qué no tiene que hacer. Tené en cuenta que acá
  del otro lado está alguien del equipo, no un paciente.
- **Modelo**: lo elige el equipo de la plataforma; si necesitás otro,
  pedíselo.
- **Acciones habilitadas**: sin acciones, el agente solo conversa. Las dos
  disponibles:
  - **Crear tarea**: crea una tarea en el sistema, ligada a un paciente que
    ya existe, asignada a la persona que se la pidió. Si no le dijiste a qué
    paciente va ligada, pregunta antes de crearla. Si mencionás una fecha
    límite, la carga.
  - **Ver agenda**: lista los turnos agendados en un rango de fechas, de toda
    la clínica o de una sede, con fecha, hora, paciente, prestación, sede y
    estado. Si no indicás hasta cuándo, mira las 24 horas siguientes; el rango
    máximo es de 62 días. Si no hay turnos, lo dice tal cual.

Tocá **Guardar**. Cada persona tiene su propio hilo con el agente interno:
lo que vos le preguntás no lo ve otra persona del equipo.
