# Pacientes y consultas

Un **paciente** es una persona: alguien que escribió por WhatsApp, Instagram,
Messenger o el chat del sitio, alguien que llamó o vino a la recepción, o
alguien que cargaste a mano. Todo lo que pasa en la clínica cuelga de los
pacientes: las conversaciones con el asistente de IA, los turnos, las tareas y
los cupones.

"Paciente" es el término con que la clínica llama a sus pacientes en toda la
app. Lo elige un administrador en [Organización](/organization); en esta guía
se usa "paciente".

## Pacientes {#contactos}

Se entra desde **Pacientes**, en el menú. La pantalla
[Contactos](/contacts) tiene dos pestañas:

- **Pacientes**: las personas que ya sabemos quiénes son. Es la pestaña que se
  abre por defecto.
- **Consultas sin identificar**: las personas que escribieron por algún canal
  y todavía no dijeron cómo se llaman. Se explica más abajo, en
  [Consultas sin identificar](#consultas-sin-identificar).

Los pacientes no son de ninguna sede: todos los ven, para poder darles un
turno en cualquier sede.

### Qué muestra la lista de pacientes

Cada fila es un paciente con su **Nombre**, **Email**, **Teléfono**,
**Etapa** y **Origen** (por dónde llegó: WhatsApp, Instagram, lo que haya
cargado quien lo creó). Si sos administrador, ves además la columna
**Asignado**: la persona del equipo que tiene a cargo a ese paciente.

Tocar el nombre abre la ficha del paciente.

### Filtros

Arriba de la lista están los filtros. Cada cambio vuelve a la primera página.

- **Buscar**: por nombre, apellido o email.
- **Etapa**: en qué punto está la relación con la persona. Las etapas son
  **Nuevo** (acaba de llegar), **Calificado (Marketing)**, **Calificado
  (Ventas)**, **Paciente** (ya se atiende en la clínica) y **Perdido**.
- **Ordenar por**: fecha de creación, nombre, apellido o etapa, y el orden
  (ascendente o descendente).

### Acciones de cada fila

El menú de tres puntos de cada fila ofrece:

- **Ver detalle**: una ventana con los datos del paciente en solo lectura.
  Sirve para mirar rápido sin salir de la lista.
- **Editar**: abre la ficha.
- **Eliminar**: solo para administradores. Pide confirmación.

> Un paciente eliminado deja de verse en todas las pantallas, pero sus
> conversaciones, turnos y tareas no se borran: quedan en el historial. El
> sistema no deja eliminar un paciente que tenga **conversaciones abiertas** o
> **turnos confirmados**: primero hay que cerrar las conversaciones y cancelar
> los turnos.

### Quién puede hacer qué

| Qué | Administrador | Recepción |
|---|---|---|
| Ver la lista y las fichas | Sí, todos los pacientes | Sí, todos los pacientes |
| Crear un paciente | Sí | Sí |
| Editar un paciente | Sí | Sí, cualquiera |
| Marcar o quitar «sin interés» | Sí | Sí |
| Elegir o cambiar a quién está asignado | Sí | No |
| Eliminar, unir pacientes y descartar consultas | Sí | No |

> Recepción puede editar cualquier paciente, pero no lo puede asignar a otra
> persona: lo que crea queda a su nombre. Para cambiar a quién está asignado
> un paciente, pedíselo a un administrador. Más detalle en
> [Usuarios y permisos](/ayuda/usuarios-y-permisos#recepcion).

## Nuevo paciente {#nuevo-contacto}

1. En [Contactos](/contacts), tocá **Nuevo contacto**.
2. Completá **Nombre** y **Apellido**. Son los únicos campos obligatorios
   (los marcados con asterisco).
3. Si los tenés, cargá **Email**, **Teléfono** y **Puesto** (opcional; en una
   clínica casi nunca hace falta).
4. **Fuente**: por dónde llegó el paciente, en texto libre. Por ejemplo
   "Recepción", "Recomendado" o "Instagram". Los pacientes que crean los
   canales de chat ya traen la suya.
5. **Etapa**: arranca en **Nuevo**. Cambiala a medida que avance la relación;
   por ejemplo, a **Paciente** cuando ya se atendió.
6. **Asignado** (solo administradores): la persona del equipo que lo tiene a
   cargo. Viene preseleccionado en vos; cambialo si corresponde. Recepción no
   ve este campo: el paciente queda a su nombre.
7. Si la clínica definió campos propios, completalos en la tarjeta **Campos
   personalizados** (ver [Ficha del paciente](#ficha-de-contacto)).
8. Tocá **Guardar**. Volvés a la lista.

Por ejemplo: **Nombre** Ana, **Apellido** Pérez, **Email** ana@example.com,
**Teléfono** +54 11 2345 6789.

> Antes de crear un paciente a mano, buscalo en la lista: si la persona ya
> escribió por algún canal, es probable que exista. Si igual terminás con dos
> fichas de la misma persona, un administrador las puede
> [unir](#unir-contactos).

El teléfono conviene cargarlo con código de país (por ejemplo,
+54 11 2345 6789). Si lo cargás sin código, el sistema usa el país
configurado para la organización.

Para darle un turno al paciente, se hace desde la agenda: ver
[Nuevo turno](/ayuda/actividades-y-agenda#nueva-reserva).

## Ficha del paciente {#ficha-de-contacto}

Se abre tocando el nombre en la lista, o desde **Editar**. La pantalla se
llama **Editar contacto**: es la misma que "Nuevo contacto" con todo lo que ya
se sabe del paciente, más lo que se fue sumando: los campos personalizados y
sus cupones.

### Botones de arriba

- **Crear cupón**: le manda un cupón de descuento por WhatsApp. Se explica en
  [Cupones y QR](/ayuda/cupones-y-qr).
- **Marcar sin interés** / **Quitar «sin interés»**: ver
  [Marca «sin interés»](#sin-interes).
- **Unir con otro contacto** (solo administradores): ver
  [Unir pacientes](#unir-contactos).
- **Borrar datos personales** (solo administradores): ver
  [Borrar datos personales](#borrar-datos-personales).

### Datos del contacto

La tarjeta **Datos del contacto** tiene los mismos campos que al crearlo.
Algunas cosas a tener en cuenta:

- **Asignado** (solo lo ve un administrador) se puede cambiar por otra
  persona, pero no dejar vacío una vez cargado.
- Si el paciente vino de una importación de otro sistema, debajo de
  **Fuente** se muestra "Paciente desde el …" con la fecha de alta que tenía
  allá. Es un dato de consulta: no se edita.
- Los pacientes que crean los canales de chat vienen con un nombre provisorio
  (por ejemplo "WhatsApp +54 11 …" o "Visitante a1b2c3d4"). Si la persona le
  dice su nombre al asistente, el asistente lo reemplaza. Si lo cargás vos a
  mano, el asistente ya no lo toca.

### Lo que anota el asistente de IA

Cuando el asistente habla con el paciente, va dejando en la ficha una
calificación del interés: puntaje, intención, la prestación que le interesa,
urgencia, presupuesto y zona. Esa calificación no se edita desde la ficha: se
ve al [unir pacientes](#unir-contactos) y la usa el asistente para atender
mejor la próxima vez.

En una clínica el asistente **no anota notas de texto libre** sobre lo que
cuenta el paciente: lo que escribe queda solo en la conversación. Tampoco
responde consultas de salud (ver
[Lo que el asistente no responde](/ayuda/agentes-de-ia#consultas-de-salud)).

Si definieron [campos personalizados](/ayuda/campos-personalizados), el
asistente los lee todos y puede completar los que el administrador marcó como
editables por él.

### Campos personalizados

Debajo de los datos aparece la tarjeta **Campos personalizados**, con los
datos propios de la clínica que definió un administrador (por ejemplo "Cómo
nos conoció" o "Sede preferida"). Si la organización no definió ninguno, la
tarjeta no aparece. Cómo se crean y qué tipos hay está en
[Campos personalizados](/ayuda/campos-personalizados).

> **No cargues datos de salud en los campos personalizados**: ni el motivo de
> la consulta, ni síntomas, ni diagnósticos, ni medicación. El asistente de IA
> lee esos campos. Lo que el paciente cuente de su salud queda solo en la
> conversación.

### Cupones

Al pie de la ficha, la tarjeta **Cupones** lista todos los cupones del
paciente: los que mandó alguien a mano y los que salieron por una regla
automática (marcados "por regla"), cada uno con su estado y hasta cuándo
vence o cuándo se canjeó.

### Dónde ver lo demás

- **Conversaciones**: en [Conversaciones](/conversations), buscá al paciente
  por nombre. Ver [Conversaciones](/ayuda/conversaciones#bandeja).
- **Turnos**: en [Turnos](/bookings) y en la [Agenda](/agenda). Ver
  [Turnos](/ayuda/actividades-y-agenda#reservas).
- **Tareas y notas**: las tuyas, en [Mis tareas](/tasks); un administrador
  ve las de todos en Todas las tareas. Para cargar una nueva sobre este
  paciente (una tarea o una nota), ver
  [Nueva tarea](/ayuda/actividades-y-agenda#nueva-actividad).

## Marca «sin interés» {#sin-interes}

Es la forma de decir "esta persona no quiere que la sigamos contactando".
Sirve para que ningún seguimiento automático le vuelva a escribir: las reglas
de [Automatizaciones](/ayuda/automatizaciones#retomar-la-consulta) que le
escriben a quien dejó de responder, y el recordatorio de control
([Después del turno](/ayuda/automatizaciones#despues-del-turno)), se saltean a
los que tienen la marca.

> El [recordatorio de un turno ya dado](/ayuda/automatizaciones#recordatorio-de-turno)
> le llega igual: es un aviso de un turno que tiene confirmado, no un
> seguimiento. Si la persona no va a venir, cancelá el turno.

La marca la puede poner:

- **El asistente de IA**, si el administrador le habilitó esa acción, cuando
  el paciente lo dice claramente ("no gracias", "ya me atiendo en otro lado",
  "no me escribas más"). El asistente anota el motivo con las palabras del
  paciente.
- **Una persona**, desde la ficha, con el botón **Marcar sin interés**. Pide
  confirmación. Lo puede hacer un administrador o cualquier persona de
  Recepción.

Con la marca puesta, arriba de la ficha se ve "**Sin interés** desde el
(fecha)" y, si el asistente anotó un motivo, el motivo entre comillas.

Para quitarla, tocá **Quitar «sin interés»**. No pide confirmación. A partir
de ahí los seguimientos automáticos vuelven a tenerlo en cuenta.

> La marca no cierra conversaciones ni cancela turnos, y el asistente sigue
> atendiendo al paciente si vuelve a escribir (sin ofrecerle nada ni
> insistir). Solo frena los seguimientos automáticos.

## Consultas sin identificar {#consultas-sin-identificar}

La segunda pestaña de [Contactos](/contacts?vista=consultas). Acá están las
personas que escribieron por WhatsApp, Instagram, Messenger o el chat del
sitio y todavía **no dijeron cómo se llaman**: el sistema las creó con un
nombre provisorio ("WhatsApp +54 11 …", "Visitante a1b2c3d4", "Instagram
…1234", "@ana.perez") o con un nombre a medias (solo "Ana", sin apellido).

No hay que hacer nada para que una consulta pase a Pacientes: cuando la
persona le dice su nombre y apellido al asistente, o cuando alguien se lo
completa en la ficha, pasa sola a la otra pestaña.

### Qué muestra

Cada fila tiene la **Consulta** (el nombre provisorio; tocarlo abre la
ficha), el **Canal** por el que escribió, su **Último mensaje** y hace cuánto
**Escribió**. Los administradores ven además la columna **Responsable**: quién
la tiene asignada.

Los filtros son **Buscar** (por nombre, email o teléfono), **Canal** y, para
administradores, **Responsable**.

### Acciones de cada fila

- **Abrir la conversación**: va al hilo con el asistente, para leer qué
  preguntó. Ver [Conversaciones](/ayuda/conversaciones#detalle).
- **Asignar responsable** (solo administradores): elegí quién la va a atender.
  Es lo mismo que cambiar **Asignado** en la ficha, sin abrirla.
- **Crear tarea de seguimiento**: abre una tarea nueva ya vinculada a esta
  persona, para llamarla o escribirle más tarde. Ver
  [Nueva tarea](/ayuda/actividades-y-agenda#nueva-actividad).
- **Unir con un contacto existente** (solo administradores): si te das
  cuenta de que esta consulta es un paciente que ya tenés cargado, unilas.
  Ver [Unir pacientes](#unir-contactos).
- **Descartar** (solo administradores): para consultas que no van a ningún
  lado (spam, alguien que escribió por error). Pide confirmación.

Recepción ve **Abrir la conversación** y **Crear tarea de seguimiento**.

> **Descartar** cierra las conversaciones de la consulta y da de baja a la
> persona. Si vuelve a escribir, entra como una consulta nueva, sin el
> historial anterior a la vista. No se puede descartar una consulta con un
> turno confirmado.

### Identificar una consulta

Cuando sabés quién es la persona (te lo dijo por teléfono, la reconociste
por el número), hay dos caminos:

- **Si no la tenías cargada**: tocá el nombre provisorio para abrir la ficha,
  reemplazalo por el nombre y el apellido reales y guardá. La consulta pasa a
  Pacientes y conserva su conversación y todo lo que anotó el asistente. Esto
  lo puede hacer también Recepción.
- **Si ya existía como paciente**: un administrador usa **Unir con un
  contacto existente**. Así no quedan dos fichas de la misma persona.

## Unir pacientes {#unir-contactos}

Solo para administradores. Sirve cuando la misma persona quedó cargada dos
veces: por ejemplo, Ana Pérez existe porque la cargó la recepción y además
escribió por WhatsApp y el sistema le creó otra ficha.

Se puede unir desde dos lugares, y la diferencia importa:

- **Desde la ficha de un paciente**, con **Unir con otro contacto**: el
  paciente de la ficha es el que **queda**. El que elijas (el duplicado) se
  da de baja y todo lo suyo pasa a este.
- **Desde Consultas sin identificar**, con **Unir con un contacto
  existente**: la consulta es la que **se da de baja**. El paciente que
  elijas es el que queda y recibe todo lo de la consulta.

Pasos:

1. Tocá el botón. Se abre una ventana.
2. En el buscador, escribí el nombre o el email del otro paciente y elegilo.
   No podés elegir el mismo paciente de la ficha.
3. El sistema muestra, campo por campo (nombre, apellido, email, teléfono,
   puesto, asignado, etapa, fuente y la calificación que anotó el asistente),
   los dos valores: el de este paciente y el del otro. Viene preseleccionado
   el más reciente que no esté vacío; cambiá el que quieras con las casillas.
4. Más abajo, **Pasan a este contacto** lista lo que se va a mover, con
   cantidades: conversaciones (con sus mensajes), actividades y tareas,
   turnos, cupones, seguimientos, recordatorios de turno, identidades de
   Messenger e Instagram. Si el duplicado no tiene nada, lo dice.
5. Tocá **Unir** y confirmá en la ventana que resume lo que va a pasar.

Al terminar, la ficha muestra "Contactos unidos: N registros pasaron a este
contacto".

Qué más tener en cuenta:

- Los datos extra que juntó el asistente de IA **no se eligen: se suman**.
- Si a alguno de los dos ya se le había mandado el
  [aviso de privacidad](/ayuda/agentes-de-ia#aviso-de-privacidad), queda la
  fecha más vieja y el aviso no se repite.
- Si el duplicado tenía un chat abierto en el sitio web, ese chat se corta:
  quien escribía desde ese navegador no va a ver esta conversación y, si
  vuelve a escribir, entra como un visitante nuevo. La ventana lo avisa
  cuando aplica.

> Asegurate de que los dos son la misma persona antes de unir. **No se puede
> deshacer desde la pantalla.**

## Borrar datos personales {#borrar-datos-personales}

Solo para administradores. Es lo que hay que hacer cuando un paciente pide que se
borren sus datos. **No se puede deshacer.**

En la ficha, tocá **Borrar datos personales** y confirmá. El sistema borra:

- su nombre y apellido (quedan como "[dato borrado]"), email, teléfono y
  puesto;
- lo que anotó el asistente de IA o una persona sobre el paciente: intención,
  prestación de interés, urgencia, presupuesto, zona, notas y los
  campos personalizados;
- todos los mensajes de sus conversaciones y el resumen de la derivación.
  Las conversaciones quedan cerradas, con un único mensaje: "Datos borrados
  a pedido del titular el … por …";
- el asunto y el texto de sus tareas y notas;
- sus identidades de WhatsApp, Messenger e Instagram;
- los seguimientos y recordatorios que todavía no salieron (se cancelan);
- lo que lo menciona en el asistente "¿Cómo se hace?" y en el agente
  interno (por nombre completo, email o teléfono; nunca por el nombre solo:
  una pregunta sobre otra persona con el mismo nombre de pila no se toca);
- los formularios de una landing o una importación que traían su email o su
  teléfono, aunque nunca se hayan convertido en el paciente.

Lo que **no** se borra: sus turnos quedan como registro (la prestación, el
profesional y la fecha), pero ya sin su nombre.

Si la persona vuelve a escribir después del borrado, entra como un **paciente
nuevo**, en una conversación nueva: el sistema ya no la reconoce. Lo mismo si
vuelve a llegar en una importación: se crea un paciente nuevo y el borrado no
se toca.

Después, la ficha dice **"Datos personales borrados el … por …"**: queda
registrado quién lo hizo y cuándo, y el botón ya no aparece.

### Después del borrado, la ficha queda en solo lectura

Un paciente con los datos borrados ya no describe a nadie, así que no se le
agrega nada nuevo: la ficha muestra los campos deshabilitados y sin
**Guardar**, **Crear cupón**, **Marcar sin interés** ni **Unir con otro
contacto**. Tampoco se le puede dar un turno, cargar una nota o una tarea, ni
pasarle una que era de otro paciente; los buscadores de pacientes ya no lo
ofrecen. Si alguien lo intenta igual, el sistema responde "Este contacto tiene
los datos personales borrados: queda en solo lectura."

Lo que sí sigue: completar sus tareas, cancelar, reprogramar o marcar
atendidos sus turnos, y volver a tocar el borrado (por ejemplo, para
reintentar Google Calendar). Repetirlo completa lo que faltó, sin cambiar la
fecha ni quién lo hizo.

### Google Calendar

Si la sede tiene Google Calendar conectado, el sistema también saca el nombre
del título del evento de cada turno ("Limpieza facial — [dato borrado]"). Si
Google no responde, o la sede ya no tiene el calendario conectado, el borrado
de todo lo demás **se hace igual**, y la ficha avisa cuántos eventos quedaron
con el nombre. Podés volver a tocar el borrado más tarde, o corregir el evento
a mano en el calendario.

### Lo que no se puede borrar desde acá

El sistema borra lo que guarda. No puede borrar lo que ya está en manos de
otros:

- **WhatsApp, Messenger e Instagram (Meta):** los mensajes siguen en el
  teléfono o la cuenta de la persona y en los servidores de Meta, según sus
  propias reglas.
- **El proveedor de inteligencia artificial:** los mensajes que el asistente
  ya procesó. El sistema le pide que no los guarde para entrenar, pero lo que
  conserve depende de sus políticas.
- **Los registros técnicos del servidor (logs):** se borran solos con el tiempo.
- **Las copias de seguridad de la base de datos:** se borran solas cuando
  vencen.
- **Lo que la clínica sacó del sistema:** exportaciones a Excel, capturas de
  pantalla, mails o mensajes reenviados.
