# Agenda y tareas

En el menú, **Agenda** junta todo lo de los turnos:

- La [Agenda](/agenda): el día de cada profesional, donde se dan los turnos a
  mano y se abre cada turno para reprogramarlo, marcarlo o cancelarlo.
- [Turnos](/bookings): la lista de todos los turnos, para buscar y cancelar.
- [Bloqueos](/clinica/bloqueos) y [Sobreturnos](/clinica/sobreturnos).
- Para administradores, la configuración: **Profesionales**, **Prestaciones**
  y **Configurar prestaciones**.

El menú **Tareas** tiene **Mis tareas** (cada persona, las suyas) y, para
administradores, **Todas las tareas**.

Recepción ve la agenda, los turnos, los bloqueos y los sobreturnos de **sus
sedes**, y sus tareas. La configuración es solo de administradores (ver
[Qué puede hacer Recepción](/ayuda/usuarios-y-permisos#recepcion)).

## Agenda {#calendario}

La [Agenda](/agenda) muestra un día de una sede, con una columna por cada
profesional de esa sede. La ven los administradores y la recepción.

Filtros:

- **Sede**: si no elegís una, se muestra la primera. Recepción solo ve sus
  sedes.
- **Profesional**: **Todos**, o uno solo para ver su columna.
- **Fecha**, con los botones **Día anterior**, **Día siguiente** y **Hoy**.

La grilla va de 00:00 a 24:00 en renglones de media hora y arranca a las 7 de
la mañana. Todo se muestra en la **zona horaria de la sede**, no en la de tu
computadora.

Qué se ve en cada columna:

- Los horarios en que el profesional **atiende** (según su
  [horario](#horario-de-trabajo)) se ven abiertos; el resto, cerrado.
- Cada turno es un bloque con el horario, el paciente y la prestación. Si ya
  se marcó, dice **Atendido** o **No vino**; si es un sobreturno, dice
  **Sobreturno**. Los turnos cancelados no aparecen.
- Si una prestación admite más de un paciente por turno, los turnos que se
  superponen se ven uno al lado del otro.
- Tocar un horario libre y abierto sirve para [dar un turno](#nueva-reserva).
- Un horario que **ya empezó** no se puede tocar: no se dan turnos en el
  pasado.

Tocar un turno abre su detalle: **Paciente**, **Prestación**, **Profesional**, **Horario** y, si el paciente confirmó por
WhatsApp, **Confirmación**. Desde ahí, según el momento del turno:

- **Reprogramar**, si todavía no empezó (ver [Reprogramar un
  turno](#reprogramar)).
- **Atendido** o **No vino**, si ya empezó (ver [Atendido y No
  vino](#atendido-no-vino)).
- **Cancelar turno**: pide confirmación (**Cancelar turno** o **Volver**). No
  se deshace y el horario queda libre.

Un administrador puede tocar también los horarios cerrados (se ven rayados):
es dar un turno fuera de horario; ver abajo.

Si la sede tiene Google Calendar conectado, los turnos se anotan en Google y
lo que ya esté ocupado ahí no se ofrece (ver [Calendario de Google de cada
profesional](#calendario-de-google) y
[Google Calendar](/ayuda/organizacion-y-sucursales#google-calendar)).

## Dar un turno desde la agenda {#nueva-reserva}

Hay dos formas:

- **Con el botón Nuevo turno**, si importa la prestación y el horario pero no
  quién atiende: se puede dejar en **el primero libre**. Ver [Nuevo turno con
  el primero libre](#nuevo-turno).
- **Tocando un horario libre** en la columna de un profesional, si ya se sabe
  con quién es. Son los pasos de abajo.

1. En la [Agenda](/agenda), tocá el horario libre en la columna del
   profesional.
2. Se abre **Nuevo turno** con el profesional, la fecha y la hora ya fijos.
3. Elegí la **Prestación**. Aparecen las prestaciones que atiende ese
   profesional: las que lo tienen como principal (el que se eligió al crearla
   en **Configurar prestaciones**) y las que lo suman en **Elegir
   profesionales** (ver [Prestaciones](#prestaciones)). La hora de fin se
   calcula con la duración de la
   prestación. Si dice "Este profesional todavía no tiene prestaciones.", un
   administrador tiene que crearlas.
4. Elegí el **Paciente** (se busca por nombre o email).
5. Tocá **Reservar**.

El sistema rechaza el turno si se pisa con otro y la prestación no tiene cupo,
si cae fuera del horario del profesional o en un bloqueo, o si no coincide
con la grilla de la prestación (por ejemplo, una prestación de 30 minutos que
arranca a las 9:00 ofrece 9:00, 9:30, 10:00…).

**Forzar fuera de horario** (solo administradores): si el turno queda fuera
del horario del profesional o no coincide con la grilla, aparece esta casilla
y hay que tildarla para poder darlo. Lo que no se saltea es el **cupo**: si
se pisa con otro turno, se rechaza igual. Recepción no puede dar turnos fuera
de horario.

Para un turno de más sobre un horario completo, usá
[Sobreturnos](#sobreturnos).

### Nuevo turno con el primero libre {#nuevo-turno}

1. En la [Agenda](/agenda), con la sede elegida, tocá **Nuevo turno**.
2. Elegí la **Prestación**. Aparecen las de la sede que muestra la agenda.
3. El **Día** arranca en el que muestra la agenda; se puede cambiar.
4. Elegí el **Horario**. Se listan los horarios libres de **todos** los
   profesionales de la prestación, cada uno con cuántos están libres (por
   ejemplo, "09:00 · 2 libres"). Si dice "No hay horarios libres ese día",
   probá con otro día.
5. **Profesional** arranca en **El primero libre**. Dejalo así, o elegí a uno
   de los que están libres en ese horario.
6. Elegí el **Paciente** (se busca por nombre o email) y tocá **Reservar**.

Con el primero libre, el turno queda con el profesional que tenga **menos
turnos ese día** (ver [el primero libre](#primero-libre)). Acá no se puede
forzar fuera de horario: solo se ofrecen horarios libres de verdad.

El asistente de IA también da turnos por chat, con el mismo criterio de
horarios y cupos (ver [Turnos con el profesional que elige el paciente o el
primero libre](#primero-libre)), y si está habilitado puede
[cambiarlos o cancelarlos](/ayuda/agentes-de-ia#cambiar-o-cancelar-turnos).

## Reprogramar un turno {#reprogramar}

En la **Agenda**, abrí el turno y tocá **Reprogramar**. Elegí el
profesional (cualquiera de los que atienden esa prestación), el día y el
horario nuevo. Solo aparecen los horarios libres de verdad: respetan el horario
del profesional, sus bloqueos y su calendario de Google. Si el profesional
admite sobreturnos, también aparecen los horarios completos, marcados como
**(sobreturno)**.

- Es el **mismo turno**: en la ficha del paciente queda una nota con el horario
  anterior, el nuevo y quién lo reprogramó.
- Si la sede tiene Google conectado, el evento se mueve solo (o pasa al
  calendario del profesional nuevo). Si Google falla, a la recepción de la sede
  le llega una tarea para avisarle al profesional.
- Lo pueden hacer los administradores y la recepción, en los turnos de sus
  sedes. Solo se reprograma un turno confirmado que todavía no empezó.

## Atendido y No vino {#atendido-no-vino}

Cuando un turno ya empezó, en la **Agenda** abrí el turno y marcá
**Atendido** o **No vino**. Podés sumar una nota corta (opcional). **No cargues
datos de salud** ni el motivo de la consulta.

- En el calendario el turno queda marcado como **Atendido** o **No vino**.
- Si te equivocaste, abrilo de nuevo y tocá **Corregir a No vino** (o a
  Atendido). La corrección queda en la ficha del paciente, con quién la hizo.
- Si nadie lo marca, **3 horas después de terminar** el turno se cierra solo
  como atendido, con una nota en la ficha. Si el paciente no vino, corregilo a
  **No vino**.
- Lo pueden hacer los administradores y la recepción, en los turnos de sus
  sedes. Un turno cancelado no se marca.

## Confirmado por el paciente {#confirmado-por-el-paciente}

Si la clínica usa el [recordatorio antes del turno](/ayuda/automatizaciones#recordatorio-de-turno)
y el paciente tocó **Confirmo**, el detalle del turno en la **Agenda** dice
**Confirmado por el paciente**.

## Turnos {#reservas}

[Turnos](/bookings) es la lista de todos los turnos: los que da el asistente
de IA por chat y los que da el equipo desde la agenda. La ven los
administradores y la recepción (Recepción, solo los de sus sedes). Acá no se
dan turnos: para eso está la [Agenda](#calendario).

La lista **arranca filtrada desde hoy** (campo **Desde**): lo primero que se
busca es lo que viene. Vaciá ese campo para ver el historial completo.

Filtros: **Sede**, **Profesional**, **Prestación** (cada uno se acota a lo
elegido en el anterior), **Estado**, **Desde**, **Hasta** y **Ordenar por**
**Fecha del turno** o **Fecha en que se dio**.

Columnas: **Turno** (día y hora, en la zona horaria de la sede),
**Paciente**, **Prestación**, **Profesional**, **Sede** y **Estado**.

Estados de un turno:

| Estado | Qué significa |
|---|---|
| Confirmado | El turno está dado. |
| Cancelado | Se canceló; el horario quedó libre. |
| Atendido | El paciente vino. |
| No vino | El paciente no vino. |

### Cancelar un turno

Solo un turno **Confirmado** se puede cancelar:

1. Tocá **Cancelar** en la fila.
2. Confirmá con **Cancelar turno** (o **Volver** para no hacerlo).

> Cancelar un turno **no se deshace** y el horario queda libre para otro
> paciente. Si el paciente quiere otro horario, no lo canceles:
> [reprogramalo](#reprogramar) desde la agenda.

## Turnos con el profesional que elige el paciente o el primero libre {#primero-libre}

Cuando el asistente de IA ofrece turnos para una prestación, muestra los
horarios libres de **todos** sus profesionales, cada uno con el nombre de quien
atiende. El paciente puede pedir un profesional en particular, o que le den
**el primero libre**.

Con "el primero libre", el sistema asigna a un profesional que tenga ese
horario disponible y, si hay varios, al que tenga **menos turnos ese día**.

Desde el panel funciona igual, con el botón **Nuevo turno** de la agenda (ver
[Nuevo turno con el primero libre](#nuevo-turno)).

> Si dos pacientes piden el mismo horario al mismo tiempo, el sistema no da el
> mismo turno dos veces: el segundo queda con otro profesional libre, o se le
> avisa que ese horario ya no está.

## Sobreturnos {#sobreturnos}

Un sobreturno es un turno de más encima de un horario que ya está completo.

- **Están apagados** para cada profesional hasta que un administrador los
  habilita: en [Profesionales](/clinica/profesionales), menú de la fila,
  **Sobreturnos**. Ahí se elige también el **tope por día** (cuántos
  sobreturnos puede tener ese profesional en un mismo día).
- Para cargar uno, entrá a [Sobreturnos](/clinica/sobreturnos), elegí la
  prestación, el profesional, el día y el paciente, y tocá **Cargar
  sobreturno** en el horario que quieras. Solo aparecen horarios completos.
- Un sobreturno respeta el horario del profesional y sus bloqueos, y no le
  quita lugar a los turnos normales. En el calendario aparece marcado como
  **Sobreturno**.
- Al llegar al tope del día no se ofrecen más. Cancelar uno libera el lugar.
  Si bajás el tope, los sobreturnos ya cargados no se tocan.

> El asistente de IA nunca ofrece ni carga sobreturnos: los carga una persona
> del equipo.

## Bloqueos de un profesional {#bloqueos}

Un bloqueo es un período en el que un profesional no atiende: vacaciones, una
ausencia, una reunión. En [Bloqueos](/clinica/bloqueos) elegís el profesional,
ves sus bloqueos de los próximos dos meses y cargás uno nuevo con **Desde**,
**Hasta** y, si querés, un **Motivo** (es interno: el paciente nunca lo ve).

- Mientras dura el bloqueo, esos horarios **no se ofrecen**: ni el asistente
  ni el calendario los muestran, y no se puede dar un turno ahí.
- Si ya había turnos dados dentro del bloqueo, **no se cancelan solos**. Al
  guardar, la pantalla los lista para que los canceles o los reprogrames, y a
  la recepción de esa sede le queda una tarea por cada turno para avisarle al
  paciente.
- Para sacar un bloqueo, tocá **Quitar** en su fila. Los horarios vuelven a
  estar disponibles.

Los bloqueos los cargan los administradores y la recepción, en los
profesionales de sus sedes.

## Profesionales {#profesionales}

Un profesional es una persona que atiende turnos en una sede: tiene su nombre
(el que ve el paciente, por ejemplo "Dra. Lucía Ejemplo"), su sede y su
horario.

En [Profesionales](/clinica/profesionales) ves la lista, en qué sede atiende
cada uno y qué prestaciones hace. Solo un administrador puede verla.

- Para **dar de alta** un profesional, tocá **Nuevo profesional**, elegí la
  sede y el tipo **Persona**.
- Para **cambiarle el nombre o cargar su horario**, tocá **Editar y horario**
  en su fila. Sin horario cargado, ese profesional no ofrece ningún turno.

## Editar un profesional {#recursos}

**Nuevo profesional** y **Editar y horario** (en
[Profesionales](/clinica/profesionales)) abren el formulario del profesional.
Solo un administrador puede usarlo.

Para dar de alta un profesional:

1. Poné el **Nombre** (obligatorio), tal como lo va a ver el paciente: por
   ejemplo "Dra. Lucía Ejemplo".
2. En **Tipo**, elegí **Persona**. La lista de Profesionales muestra solo las
   personas.
3. Elegí la sede (obligatoria).
4. Tocá **Guardar**. El horario se carga después, con **Editar y horario**.

Al editarlo podés cambiar el nombre y cargar su [horario](#horario-de-trabajo)
en la misma pantalla, con un solo **Guardar**.

> La **sede de un profesional no se puede cambiar** después de darlo de alta.
> Si quedó en la equivocada, dalo de alta de nuevo en la sede correcta y
> [archivá](#archivar-profesional) el anterior.

## Horario del profesional {#horario-de-trabajo}

Al editar un profesional aparece la tarjeta **Horario laboral**: en qué días y
horas atiende, en la zona horaria de su sede. Es lo que la agenda muestra como
abierto y lo que el asistente de IA ofrece como turnos.

Para cada día de la semana, de lunes a domingo:

- Si no tiene franjas, dice **No atiende.**
- **Agregar franja** suma una franja **Desde**–**Hasta**. En un día vacío
  propone 09:00–18:00; si ya hay una, propone la hora siguiente a la última
  (por ejemplo, una tarde después de una mañana). Son solo un punto de
  partida: escribí las horas que correspondan.
- Un día puede tener varias franjas (mañana y tarde). **Quitar** saca una.
- Las horas van como HH:MM, entre 00:00 y 24:00 (24:00 vale como "hasta la
  medianoche"). Cada franja tiene que empezar antes de terminar, y dos
  franjas del mismo día no pueden superponerse (09:00–13:00 y 13:00–18:00
  sí conviven). Máximo 50 franjas en total.

El horario se guarda con el botón **Guardar** del formulario. Si tiene un
error, la pantalla dice en qué día está y no guarda nada hasta que lo
corrijas.

> Un profesional **sin ninguna franja no atiende**: no se le ofrecen turnos ni
> en la agenda ni por el asistente. Un administrador igual puede forzarle un
> turno. Para las vacaciones o una ausencia no cambies el horario: cargá un
> [bloqueo](#bloqueos).

## Calendario de Google de cada profesional {#calendario-de-google}

Si la sede tiene Google Calendar conectado, cada profesional puede tener su
propio calendario de Google. Lo elige un administrador en
[Profesionales](/clinica/profesionales), menú de la fila, **Calendario de
Google**.

- El calendario tiene que ser de la cuenta de Google conectada a la sede, o
  estar compartido con ella con permiso para editar.
- Si no aparece la lista de calendarios, reconectá Google en la sede (la
  conexión es anterior y le falta ese permiso), o pegá el **ID del
  calendario** (en Google Calendar: Configuración del calendario → Integrar el
  calendario).
- Con calendario propio, los turnos del profesional se crean en su calendario,
  y lo que tenga ocupado ahí (por ejemplo, un evento personal) **no se
  ofrece**.
- Sin calendario propio, el profesional funciona solo con la agenda de la
  plataforma: no se le resta nada de Google y sus turnos se anotan en el
  calendario de la sede.

> La agenda de la plataforma manda. Si alguien **mueve o borra** un turno
> directamente en Google, el turno **no cambia** en la plataforma: a la
> recepción de la sede le llega una tarea con el paciente, el profesional, la
> fecha y lo que pasó en Google, para que lo resuelva (reprogramar, cancelar o
> avisarle al paciente).

## Archivar un profesional {#archivar-profesional}

En [Profesionales](/clinica/profesionales), menú de la fila, **Archivar**.
Antes de confirmar, la pantalla avisa cuántos turnos futuros tiene. Esos turnos
**no se cancelan**: a la recepción de la sede le queda una tarea por cada uno
para reprogramarlo con otro profesional o cancelarlo. Si tenía calendario de
Google, se deja de seguir.

## Prestaciones y quién las atiende {#prestaciones}

Una prestación (por ejemplo "Limpieza facial") la pueden hacer varios
profesionales. En [Prestaciones](/clinica/prestaciones) ves cada prestación con
su sede, su duración, quiénes la atienden y su control.

Para elegir quiénes la atienden:

1. En la fila de la prestación, abrí el menú y tocá **Elegir profesionales**.
2. Marcá los profesionales que la hacen. Solo aparecen las personas de la
   misma sede que la prestación.
3. Tocá **Guardar**.

El profesional **principal** (el que se eligió al crear la prestación) queda
siempre marcado: para cambiarlo, editá la prestación en **Configurar
prestaciones**. Crear, cambiar la duración o eliminar una prestación también se
hace ahí.

## Configurar prestaciones {#tipos-de-servicio}

[Configurar prestaciones](/service-types) (solo administradores) define cada
prestación: su nombre, su sede, su profesional principal, cuánto dura y
cuántos pacientes entran por turno. Por ejemplo: "Limpieza facial" de 45
minutos con la Dra. Lucía Ejemplo, en Sede Centro.

La lista muestra el nombre, el profesional principal, la sede, la
**Duración** y el **Cupo**; se filtra por nombre, sede y profesional, y se
ordena por **Fecha de creación**, **Nombre** o **Duración**. En el menú de
cada fila: **Editar** y **Eliminar**.

### Crear una prestación

1. Tocá el botón de alta, arriba de la lista.
2. Poné el **Nombre** (obligatorio), por ejemplo "Limpieza facial".
3. Elegí la sede y después el profesional principal (los dos obligatorios):
   solo se ofrecen los profesionales de la sede elegida. Si cambiás la sede,
   hay que volver a elegir el profesional.
4. Cargá la **Duración (minutos)** (obligatoria): un número entero entre 1 y
   1440 (un día). Es lo que dura cada turno y lo que define la grilla de
   horarios que se ofrecen.
5. **Cupo**: cuántos pacientes pueden tener el mismo turno. **1** es un turno
   exclusivo (lo habitual en una consulta); más de 1, una actividad grupal.
   Si lo dejás vacío al crearla, queda en 1.
6. Tocá **Guardar**.

Después, en [Prestaciones](#prestaciones), sumale los otros profesionales que
también la hacen.

> No se puede eliminar una prestación que tiene turnos activos: el sistema lo
> rechaza y muestra el motivo. Cancelá o esperá a que pasen esos turnos.

## Recordar control {#recordar-control}

En [Prestaciones](/clinica/prestaciones), en las acciones de una prestación,
elegí **Recordar control** y cargá a cuántos días (de 1 a 730). Después de un
turno atendido de esa prestación, el paciente recibe un WhatsApp para agendar el
próximo, si está activa la regla
[Recordar el control](/ayuda/automatizaciones#despues-del-turno). Vacío: sin
control.

## Mis tareas {#mis-tareas}

**Tareas → Mis tareas** muestra las tareas asignadas a vos que todavía te
conciernen, con o sin vencimiento. La ven los administradores y la recepción.

Muchas tareas las crea el sistema para la recepción de una sede: un turno que
quedó dentro de un bloqueo, un turno que alguien movió en Google, los turnos
de un profesional archivado o un paciente que pidió hablar con una persona.
Esas tareas le llegan a alguien de Recepción de la sede (ver
[Sedes de cada persona de recepción](/ayuda/usuarios-y-permisos#sedes)).

Están agrupadas por vencimiento, en este orden: **Vencidas**, **Hoy**, **Esta
semana**, **Más adelante**, **Sin fecha** y, al final, **Esperando
confirmación**. Un bloque sin tareas no se muestra. Cada fila tiene el tipo,
el asunto, el paciente con el que está relacionada y la fecha de vencimiento
("Hoy, 11:00", "jue 3 sep").

Se puede **buscar** por asunto y filtrar por **Tipo**. Al pie se lee cuántas
tareas pendientes quedan y cuántas esperan confirmación, contando solo lo que
está en pantalla.

### Completar una tarea

1. Tildá la casilla de la tarea.
2. La fila pasa al bloque **Esperando confirmación**, con la fecha en que la
   completaste, hasta que un administrador la confirme (entonces desaparece
   de acá) o la rechace (vuelve a su bloque).

Si sos administrador, al tildarla queda confirmada y desaparece directamente.

### Crear y editar

- **Nueva tarea** crea una tarea asignada a vos (ver
  [Nueva tarea](#nueva-actividad)).
- Tocando el asunto se abre la tarea para editarla. Recepción solo puede
  editar las que **creó, tiene asignadas y todavía no completó**. Las que le
  asignó un administrador o el sistema solo las puede completar. Un
  administrador edita cualquiera.

## Todas las tareas {#actividades}

**Tareas → Todas las tareas** es el listado completo de la organización. Lo
ve solo un administrador; Recepción trabaja desde [Mis tareas](#mis-tareas).

Filtros:

- **Buscar** por asunto o notas.
- **Tipo**: Llamada, Reunión, Email, Tarea o Nota.
- **Confirmación**: Pendiente de confirmar o Confirmada (ver más abajo).
- **Ordenar por**: fecha, fecha de creación, última actualización,
  vencimiento, completada o asunto.

Columnas principales: **Asunto**, **Tipo**, **Contacto** (el paciente),
**Autor** (quien la creó; **Asistente** si la dejó el asistente de IA),
**Asignado a**, **Vencimiento**, **Completada** y **Confirmación**. Una tarea
con vencimiento pasado y sin completar lleva la marca **Vencida**.

### Completar y confirmar

Una tarea pasa por tres momentos:

1. **Pendiente**: no se hizo todavía.
2. **Pendiente de confirmar**: quien la tenía asignada la marcó como hecha
   (desde Mis tareas) y espera que un administrador la revise.
3. **Confirmada**: un administrador la dio por buena.

Cuando un administrador completa una tarea propia, queda confirmada en el
acto. En el menú de acciones de una tarea pendiente de confirmar:

- **Confirmar**: la da por hecha.
- **Rechazar**: la devuelve a pendiente; vuelve a aparecer en Mis tareas de
  la persona asignada.

Una vez confirmada, para volver atrás hay que editarla a mano.

### Otras acciones

- **Ver detalle**: todos los datos y, si está confirmada, quién y cuándo.
- **Editar**: abre el formulario.
- **Eliminar**: pide confirmación y no se deshace.

Las tareas no solo las carga el equipo: las automatizaciones y el asistente de
IA también las crean (un seguimiento, una derivación a la recepción). Ver
[Automatizaciones](/ayuda/automatizaciones#reglas) y
[Derivar a una persona](/ayuda/agentes-de-ia#derivar).

## Nueva tarea {#nueva-actividad}

Se llega desde **Nueva tarea** (Mis tareas, todos) o **Nueva actividad**
(Todas las tareas, administradores). Algunas pantallas la abren con datos ya
cargados, por ejemplo **Crear tarea de seguimiento** en
[Consultas sin identificar](/ayuda/contactos-y-consultas#consultas-sin-identificar).

1. Elegí el **Tipo**: Llamada, Reunión, Email, Tarea o Nota.
2. Escribí el **Asunto** (obligatorio), por ejemplo "Llamar a Ana Pérez para
   reprogramar", y, si hace falta, **Notas**. **No cargues datos de salud.**
3. En **Contacto**, elegí el paciente (se busca por nombre o email). La tarea
   tiene que estar relacionada con alguien; el selector tiene su botón
   **Quitar**.
4. **Asignado a**: un administrador elige a quién (o la deja sin asignar);
   para Recepción, el campo es fijo con su propio nombre.
5. **Vencimiento**: fecha y hora para cuándo tiene que estar hecha. Opcional;
   sin vencimiento va al bloque "Sin fecha".
6. **Completada**: fecha y hora en que se hizo, si ya se hizo. Dejalo vacío
   para una tarea pendiente.
7. Tocá **Guardar**. Un administrador vuelve a Todas las tareas; Recepción, a
   Mis tareas.

> Si cargás **Completada** desde el formulario, la tarea queda completada con
> esa fecha y hora exactas (por eso es un campo y no una casilla). Si solo
> querés tildarla como hecha, usá la casilla de Mis tareas.
