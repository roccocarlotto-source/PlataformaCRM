# Conversaciones

Todo lo que los pacientes hablan con la clínica por WhatsApp, Messenger,
Instagram y el chat del sitio web pasa por acá. Las conversaciones las
atiende primero el **asistente de IA** de cada sede; cuando el paciente pide
hablar con una persona, cuando escribe algo de salud o cuando el asistente
decide derivar, la conversación pasa a manos del equipo, que puede responder
desde esta misma pantalla.

Las conversaciones no se crean a mano (las abre el primer mensaje del
paciente) y no se borran: son el registro de lo que se habló con el paciente.

Quién ve qué:

- Un **administrador** ve las conversaciones de todas las sedes.
- **Recepción** ve las conversaciones de **sus sedes**, y puede responderlas,
  cerrarlas y devolverlas al asistente aunque estén asignadas a otra persona.
  Ver [Sedes de cada persona de recepción](/ayuda/usuarios-y-permisos#sedes).

## Bandeja {#bandeja}

La pantalla [Conversaciones](/conversations) (en el menú, dentro de
**Pacientes**) lista las conversaciones, de la que tuvo movimiento más
reciente a la más vieja. Ese orden es fijo. La lista se actualiza sola cada
pocos segundos: no hace falta recargar para ver si llegó un mensaje nuevo.

### Qué muestra cada fila

- **Contacto**: el nombre del paciente. Debajo, si existe, el
  [resumen](#resumen) de la conversación, para saber de qué se trata sin
  abrirla. Si el nombre es provisorio ("WhatsApp +54 11 …", "Visitante
  a1b2c3d4"), la persona todavía no dijo cómo se llama: ver
  [Consultas sin identificar](/ayuda/contactos-y-consultas#consultas-sin-identificar).
- **Canal**: WhatsApp, Web, Messenger o Instagram.
- **Estado**:
  - **Activa**: la atiende el asistente de IA.
  - **Derivada a un humano**: la atiende (o la tiene que atender) una
    persona del equipo.
  - **Cerrada**: terminó. Si el paciente vuelve a escribir, se abre una
    conversación nueva.

  Al lado del estado puede aparecer la marca roja **Pidió hablar con una
  persona · sin responder**: el paciente pidió una persona, nadie le escribió
  y la conversación volvió al asistente. Es algo pendiente: desaparece cuando
  alguien le escribe o completa la tarea de seguimiento.
- **Sede** y **Agente**: qué sede y qué asistente de IA la atienden.
- **Último mensaje**: cuándo fue. Pasando el mouse se ve la fecha completa.

Tocar el nombre del paciente abre la conversación en una ventana encima de
la lista. Al cerrarla volvés exactamente donde estabas, con los mismos
filtros y en la misma página.

### Filtros

- **Buscar**: por el nombre, apellido o email del paciente. No busca dentro
  de los mensajes.
- **Estado**, **Canal**, **Sede** y **Agente**. Si sos de Recepción, en
  **Sede** aparecen solo las tuyas.

Cada cambio vuelve a la primera página.

> Si sos de Recepción y no tenés ninguna sede asignada, la bandeja aparece
> vacía. Pedile a un administrador que te asigne tus sedes.

## Detalle de una conversación {#detalle}

Se abre desde la bandeja (en una ventana) o desde **Abrir la conversación**
en Consultas sin identificar. Tiene cuatro partes, de arriba hacia abajo.

### Datos de la conversación

Contacto, canal, estado, sede, agente, cuándo empezó (**Inicio**) y cuándo fue
el **Último mensaje**. Para un administrador, el nombre del paciente es un
link a su ficha; Recepción lo ve como texto (la ficha se abre desde
[Contactos](/contacts)).

Debajo hay dos botones:

- **Crear cupón**: le manda al paciente un cupón de descuento por WhatsApp,
  que queda registrado en esta conversación. Cómo funciona está en
  [Cupones y QR](/ayuda/cupones-y-qr).
- **Cerrar conversación**: la pasa a **Cerrada**. Pide confirmación. Solo
  aparece mientras está abierta.

> Cerrar una conversación no se deshace desde la pantalla. Si el paciente
> vuelve a escribir, el asistente le responde en una conversación **nueva**,
> sin este hilo a la vista. Usalo cuando el tema terminó, no para "ordenar".

### Resumen

La tarjeta con el resumen que escribe la IA. Ver [Resumen](#resumen).

### Mensajes

El hilo completo, en orden. Cada mensaje dice quién lo escribió y cuándo:

- a la izquierda, lo que escribió el **paciente**;
- a la derecha, lo que salió de la clínica: el **asistente de IA** (con su
  nombre), una **persona del equipo** (con su nombre, en otro color) o una
  **Automatización** (un mensaje que mandó el sistema o una regla, por
  ejemplo el [aviso de privacidad](/ayuda/agentes-de-ia#aviso-de-privacidad)
  o un seguimiento).

Si alguien respondió desde Meta Business Suite o desde la app de Instagram en
vez de desde acá, el mensaje aparece igual, con la aclaración "desde la
bandeja de Meta". Como Meta no dice quién lo escribió, se le atribuye a quien
tiene asignada la conversación.

En los mensajes que salen por WhatsApp, Messenger o Instagram, al lado de la
hora se ve el estado de entrega: **Enviando**, **Enviado**, **Entregado**,
**Leído** o **No entregado**. Si no se entregó, pasando el mouse se ve el
motivo. Cuando lo que no salió es una respuesta de una persona, debajo del
mensaje aparece "No pudimos enviar" y el botón **Reintentar**, que vuelve a
mandar ese mismo mensaje (lo ve solo quien puede atender la conversación, y
mientras no esté cerrada).

> Lo que el paciente cuenta de su salud queda **solo en este hilo**: no se
> copia a la ficha, ni a las tareas, ni a ningún otro lado. Si necesitás
> consultarlo, volvé a la conversación.

> El hilo muestra solo lo que se dijeron. Los turnos del asistente en los que
> ejecutó una acción sin escribir nada (por ejemplo, buscó horarios libres en
> la agenda) no aparecen como mensajes. Ver
> [Acciones del asistente](#acciones-del-agente).

### Responder

La tarjeta al pie, para escribirle al paciente. Ver
[Atender una conversación](#atender) y [Responder](#responder).

## Atender una conversación {#atender}

"Atender" quiere decir que una persona toma la conversación y el asistente de
IA deja de contestar. Pasa de dos maneras.

### Cuando el asistente deriva

El asistente deriva cuando el paciente pide hablar con una persona, cuando
sus instrucciones le dicen que lo haga (por ejemplo, ante una queja) o cuando
el paciente escribe algo de salud. En ese momento:

1. La conversación pasa a **Derivada a un humano**.
2. Se crea una **tarea** para alguien de Recepción de esa sede (el
   **Responsable por defecto** de la sede si es de Recepción, o si no quien
   tenga menos tareas pendientes), con el aviso de que el paciente espera.
   Como Recepción ve las tareas y las conversaciones de sus sedes, cualquier
   persona de Recepción de la sede la puede tomar.
3. La IA escribe el [resumen](#resumen) de la conversación, para que quien la
   tome entienda rápido de qué se trata. **En una consulta de salud no hay
   resumen**: la tarea lleva un texto fijo y hay que leer la conversación.

### Cuando el paciente escribe algo de salud

El asistente **no responde consultas de salud**. Ante una posible urgencia le
indica al paciente que llame al 911 o a su emergencia móvil, y ante una
consulta clínica (un síntoma, una reacción, medicación, "¿es normal que…?") le
dice que la tiene que ver un profesional. En los dos casos te pasa la
conversación. La tarea de una urgencia empieza con **URGENTE**.

Después de una derivación por salud, el asistente no vuelve a escribir en esa
conversación aunque el paciente siga mandando mensajes. Qué hacer paso a paso
está en
[Lo que el asistente no responde](/ayuda/agentes-de-ia#consultas-de-salud).

> Si el paciente escribe una urgencia, el asistente le manda el mensaje del
> 911 aunque estés vos atendiendo la conversación.

### Si nadie responde a tiempo

Cuando el paciente pidió una persona y nadie le escribe dentro de los minutos
que el administrador configuró en el asistente, el paciente recibe solo un
aviso de que no hay nadie disponible (con el horario de la sede si está
cerrada), la conversación **vuelve al asistente** y la tarea queda pendiente.
La bandeja la marca con **Pidió hablar con una persona · sin responder** hasta
que alguien le escriba o complete la tarea. El tiempo de espera y el texto del
aviso se configuran en
[Agentes de IA](/ayuda/agentes-de-ia#derivar).

### Cuando una persona responde

Responder desde la tarjeta **Responder** también toma la conversación: pasa
a **Derivada a un humano** (si no lo estaba) y el asistente se calla. La
tarjeta lo muestra con el aviso "El agente está en pausa: esta conversación la
atiende una persona". Lo mismo pasa si alguien le contesta al paciente desde
la bandeja de Meta: el sistema se entera y el asistente deja de responder.

### Quién puede atender

- Cualquier **administrador**, en todas las sedes.
- Cualquier persona de **Recepción**, en las conversaciones de sus sedes,
  esté asignada a quien esté.

### Devolver al asistente

Cuando el tema está resuelto y querés que el asistente siga atendiendo al
paciente (por ejemplo, para que le dé un turno), tocá **Devolver al agente**.
La conversación vuelve a **Activa** y el asistente contesta el próximo
mensaje del paciente.

> Si devolvés la conversación **sin haberle respondido** al paciente desde
> que pidió una persona, el sistema te pide confirmación: al paciente le va a
> llegar el aviso de que lo contactan más tarde, y la tarea de seguimiento
> queda pendiente. Si preferís, respondele primero y devolvé después.

## Responder {#responder}

1. Abrí la conversación.
2. En la tarjeta **Responder**, escribí el mensaje (hasta 4.096 caracteres).
3. Tocá **Enviar**.

Por ejemplo: "Hola Ana, te habla la recepción de Sede Centro. Te podemos dar
un turno de Limpieza facial con la Dra. Lucía Ejemplo el jueves a las 10.
¿Te sirve?".

El mensaje aparece en el hilo con tu nombre y, en los canales de Meta, con su
estado de entrega. Si el envío falla, lo que escribiste sigue en el cuadro
para que no lo pierdas; si Meta lo rechazó, el mensaje queda en el hilo con
el botón **Reintentar**.

### Por dónde sale

La tarjeta lo dice debajo del cuadro, según el canal:

- **WhatsApp**: sale desde el número de WhatsApp de la clínica (el que
  atiende el asistente). No se puede responder desde la app de WhatsApp del
  celular: solo desde acá.
- **Messenger**: sale desde la página de Facebook de la clínica.
- **Instagram**: sale desde la cuenta de Instagram de la clínica.
- **Web**: le llega al visitante en el chat del sitio. Si cerró el chat, lo
  ve cuando lo vuelva a abrir.

### La ventana de 24 horas

WhatsApp, Messenger e Instagram solo dejan escribirle libremente a una
persona durante las **24 horas siguientes a su último mensaje**. La tarjeta
muestra hasta cuándo: "Podés escribir texto libre hasta el (fecha y hora)".

Pasado ese plazo el cuadro se deshabilita:

- En **WhatsApp** el aviso dice "Pasaron más de 24 h desde el último mensaje
  del paciente: WhatsApp solo permite plantillas aprobadas". Desde esta
  pantalla no se puede mandar texto libre. Los mensajes de las
  [automatizaciones](/ayuda/automatizaciones#reglas) (por ejemplo, el
  [recordatorio de turno](/ayuda/automatizaciones#recordatorio-de-turno)) usan
  plantillas aprobadas, por eso sí pueden salir.
- En **Messenger** e **Instagram**, no se le puede escribir hasta que el
  paciente vuelva a escribir. Apenas lo haga, la ventana se abre de nuevo.

El chat de la **web** no tiene esta limitación.

> Si el paciente pidió hablar con una persona, no dejes pasar las 24 horas:
> después solo queda esperar a que vuelva a escribir, o llamarlo por
> teléfono.

### Conversaciones cerradas

Una conversación cerrada no tiene tarjeta **Responder**. Si necesitás
escribirle al paciente, esperá a que vuelva a escribir (se abre una
conversación nueva) o mandale un [cupón](/ayuda/cupones-y-qr), que sale
igual.

## Resumen {#resumen}

Arriba del hilo está la tarjeta **Resumen**: dos a cuatro oraciones que
cuentan qué pasó en la conversación. Lo escribe la IA, para que nadie tenga
que leer el hilo entero para saber de qué se trata. El mismo texto se ve
debajo del nombre del paciente en la bandeja.

- Se genera solo cuando el asistente deriva la conversación a una persona,
  **salvo en las derivaciones por salud**: ahí no se genera, para que lo que
  contó el paciente no salga del hilo.
- Para cualquier otra conversación, tocá **Generar resumen**.
- **Regenerar resumen** lo vuelve a escribir con lo que se habló hasta
  ahora. Si el texto lo había editado una persona, pide confirmación, porque
  reemplaza esa edición.
- **Editar** abre el texto para corregirlo a mano. Guardá o cancelá. Un
  resumen editado a mano muestra "Editado a mano por (nombre)".
- Para borrarlo, editalo, vaciá el texto y guardá: la tarjeta vuelve a
  ofrecer generarlo.

Cualquiera que vea la conversación puede generar, regenerar o editar el
resumen.

> El resumen se ve en la bandeja, a la vista de todo el equipo. En una
> conversación donde el paciente habló de su salud, no generes el resumen a
> mano y, si lo editás, no escribas datos de salud.

## Acciones del asistente {#acciones-del-agente}

Además de conversar, el asistente de IA puede **hacer cosas** en el sistema,
según lo que el administrador le haya habilitado: consultar las prestaciones
y los horarios libres, dar un turno, ver, reprogramar o cancelar los turnos
del paciente (ver
[Cambiar o cancelar turnos por chat](/ayuda/agentes-de-ia#cambiar-o-cancelar-turnos)),
calificar el interés, guardar campos personalizados, marcar al paciente como
«sin interés» o derivar la conversación a una persona.

En el hilo de la conversación **esas acciones no se ven como tales**: el hilo
muestra solo lo que se dijeron el paciente, el asistente, el equipo y las
automatizaciones. Lo que el asistente hizo se ve por sus efectos:

- el **turno** que dio, reprogramó o canceló, en [Turnos](/bookings) y en la
  [Agenda](/agenda); los cambios quedan en la ficha del paciente con
  **Asistente** como autor;
- la calificación del interés, en la ficha del paciente (ver
  [Ficha del paciente](/ayuda/contactos-y-consultas#ficha-de-contacto));
- la marca **Sin interés**, arriba de la ficha, con el motivo que dijo el
  paciente;
- los **campos personalizados** que completó, en la ficha;
- la **tarea** y el estado **Derivada a un humano**, cuando derivó.

Si un administrador necesita ver en detalle qué acción pidió el asistente,
con qué datos, si se le permitió y qué resultado tuvo, eso se ve en el
**probador** de cada asistente, en
[Agentes de IA](/ayuda/agentes-de-ia#probar). Es información de
diagnóstico, con datos crudos, y por eso no está en la bandeja que lee el
equipo.

> Que una acción esté habilitada no significa que el asistente la ejecute
> cuando quiera: antes de cada una, el sistema vuelve a revisar las reglas
> que escribió el administrador para ese asistente. Y ninguna acción le
> permite responder consultas de salud.
