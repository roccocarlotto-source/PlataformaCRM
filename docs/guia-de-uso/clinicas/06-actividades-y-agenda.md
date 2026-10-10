# Actividades y agenda

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

## Prestaciones y quién las atiende {#prestaciones}

Una prestación (por ejemplo "Limpieza facial") la pueden hacer varios
profesionales. En [Prestaciones](/clinica/prestaciones) ves cada prestación con
quiénes la atienden.

Para elegir quiénes la atienden:

1. En la fila de la prestación, abrí el menú y tocá **Elegir profesionales**.
2. Marcá los profesionales que la hacen. Solo aparecen las personas de la
   misma sede que la prestación.
3. Tocá **Guardar**.

El profesional **principal** (el que se eligió al crear la prestación) queda
siempre marcado: para cambiarlo, editá la prestación en **Configurar
prestaciones**. Crear, cambiar la duración o eliminar una prestación también se
hace ahí.

## Turnos con el profesional que elige el paciente o el primero libre {#primero-libre}

Cuando el asistente de IA ofrece turnos para una prestación, muestra los
horarios libres de **todos** sus profesionales, cada uno con el nombre de quien
atiende. El paciente puede pedir un profesional en particular, o que le den
**el primero libre**.

Con "el primero libre", el sistema asigna a un profesional que tenga ese
horario disponible y, si hay varios, al que tenga **menos turnos ese día**.

> Si dos pacientes piden el mismo horario al mismo tiempo, el sistema no da el
> mismo turno dos veces: el segundo queda con otro profesional libre, o se le
> avisa que ese horario ya no está.

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

## Reprogramar un turno {#reprogramar}

En el **Calendario**, abrí el turno y tocá **Reprogramar**. Elegí el
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

## Archivar un profesional {#archivar-profesional}

En [Profesionales](/clinica/profesionales), menú de la fila, **Archivar**.
Antes de confirmar, la pantalla avisa cuántos turnos futuros tiene. Esos turnos
**no se cancelan**: a la recepción de la sede le queda una tarea por cada uno
para reprogramarlo con otro profesional o cancelarlo. Si tenía calendario de
Google, se deja de seguir.

## Atendido y No vino {#atendido-no-vino}

Cuando un turno ya empezó, en el **Calendario** abrí el turno y marcá
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
y el paciente tocó **Confirmo**, el detalle del turno en el **Calendario** dice
**Confirmado por el paciente**.
