# Conversaciones

Todo lo que los clientes hablan con el negocio por WhatsApp, Messenger,
Instagram y el chat del sitio web pasa por acá. Las conversaciones las
atiende primero el **agente de IA** de cada sucursal; cuando el cliente pide
hablar con una persona, o cuando el agente decide derivar, la conversación
pasa a manos de un vendedor, que puede responder desde esta misma pantalla.

Las conversaciones las ven todos: administradores y usuarios. No se crean a
mano (las abre el primer mensaje del cliente) y no se borran: son el registro
de algo que pasó con un tercero.

## Bandeja {#bandeja}

La pantalla [Conversaciones](/conversations) lista todas las conversaciones
de la organización, de la que tuvo movimiento más reciente a la más vieja.
Ese orden es fijo. La lista se actualiza sola cada pocos segundos: no hace
falta recargar para ver si llegó un mensaje nuevo.

### Qué muestra cada fila

- **Contacto**: el nombre de la persona. Debajo, si existe, el
  [resumen](#resumen) de la conversación, para saber de qué se trata sin
  abrirla. Si el nombre es provisorio ("WhatsApp +54 11 …", "Visitante
  a1b2c3d4"), la persona todavía no dijo cómo se llama: ver
  [Consultas sin identificar](/ayuda/contactos-y-consultas#consultas-sin-identificar).
- **Canal**: WhatsApp, Web, Messenger o Instagram.
- **Estado**:
  - **Activa**: la atiende el agente de IA.
  - **Derivada a un humano**: la atiende (o la tiene que atender) una
    persona. El agente no responde mientras esté así.
  - **Cerrada**: terminó. Si el cliente vuelve a escribir, se abre una
    conversación nueva.

  Al lado del estado puede aparecer la marca roja **Pidió hablar con una
  persona · sin responder**: el cliente pidió una persona, nadie le escribió
  y la conversación volvió al agente. Es algo pendiente: desaparece cuando
  alguien le escribe o completa la tarea de seguimiento.
- **Sucursal** y **Agente**: qué sucursal y qué agente de IA la atienden.
- **Último mensaje**: cuándo fue. Pasando el mouse se ve la fecha completa.

Tocar el nombre del contacto abre la conversación en una ventana encima de
la lista. Al cerrarla volvés exactamente donde estabas, con los mismos
filtros y en la misma página.

### Filtros

- **Buscar**: por el nombre, apellido o email del contacto. No busca dentro
  de los mensajes.
- **Estado**, **Canal**, **Sucursal** y **Agente**.

Cada cambio vuelve a la primera página.

## Detalle de una conversación {#detalle}

Se abre desde la bandeja (en una ventana) o desde **Abrir la conversación**
en Consultas sin identificar. Tiene cuatro partes, de arriba hacia abajo.

### Datos de la conversación

Contacto, canal, estado, sucursal, agente, cuándo empezó y cuándo fue el
último mensaje. Para un administrador, el nombre del contacto es un link a su
ficha; un usuario lo ve como texto.

Debajo hay dos botones:

- **Crear cupón**: le manda al cliente un cupón de descuento por WhatsApp,
  que queda registrado en esta conversación. Cómo funciona está en
  [Cupones y QR](/ayuda/cupones-y-qr#enviar-cupon).
- **Cerrar conversación**: la pasa a **Cerrada**. Pide confirmación. Solo
  aparece mientras está abierta.

> Cerrar una conversación no se deshace desde la pantalla. Si el cliente
> vuelve a escribir, el agente le responde en una conversación **nueva**, sin
> este hilo a la vista. Usalo cuando el tema terminó, no para "ordenar".

### Resumen

La tarjeta con el resumen que escribe la IA. Ver [Resumen](#resumen).

### Mensajes

El hilo completo, en orden. Cada mensaje dice quién lo escribió y cuándo:

- a la izquierda, lo que escribió el **cliente**;
- a la derecha, lo que salió del negocio: el **agente de IA** (con su
  nombre), una **persona del equipo** (con su nombre, en otro color) o una
  **Automatización** (un mensaje que mandó una regla, por ejemplo un cupón o
  un seguimiento).

Si un vendedor respondió desde Meta Business Suite o desde la app de
Instagram en vez de desde acá, el mensaje aparece igual, con la aclaración
"desde la bandeja de Meta". Como Meta no dice quién lo escribió, se le
atribuye a quien tiene asignada la conversación.

En los mensajes que salen por WhatsApp, Messenger o Instagram, al lado de la
hora se ve el estado de entrega: **Enviando**, **Enviado**, **Entregado**,
**Leído** o **No entregado**. Si no se entregó, pasando el mouse se ve el
motivo. Cuando lo que no salió es una respuesta de una persona, debajo del
mensaje aparece "No pudimos enviar" y el botón **Reintentar**, que vuelve a
mandar ese mismo mensaje (lo ve solo quien atiende la conversación, y
mientras no esté cerrada).

> El hilo muestra solo lo que se dijeron. Los turnos en los que el agente
> ejecutó una acción sin escribir nada (por ejemplo, buscó en el stock) no
> aparecen como mensajes. Ver [Acciones del agente](#acciones-del-agente).

### Responder

La tarjeta al pie, para escribirle al cliente. Ver [Atender una
conversación](#atender) y [Responder](#responder).

## Atender una conversación {#atender}

"Atender" quiere decir que una persona toma la conversación y el agente de IA
deja de contestar. Pasa de dos maneras.

### Cuando el agente deriva

El agente deriva cuando el cliente pide hablar con una persona o cuando sus
instrucciones le dicen que lo haga (por ejemplo, ante una queja). En ese
momento:

1. La conversación pasa a **Derivada a un humano** y queda asignada al
   vendedor del contacto (si el contacto no tenía vendedor, se le asigna el
   vendedor por defecto de la sucursal, si hay uno).
2. Se crea una **tarea** para ese vendedor, con el aviso de que el cliente
   espera.
3. La IA escribe el [resumen](#resumen) de la conversación, para que quien
   la tome entienda rápido de qué se trata.

A partir de ahí el cliente está esperando. Si nadie le escribe dentro de los
minutos que el administrador configuró en el agente, el cliente recibe solo
un aviso de que no hay nadie disponible (con el horario de la sucursal si
está cerrada), la conversación **vuelve al agente** y la tarea queda
pendiente. La bandeja la marca con **Pidió hablar con una persona · sin
responder** hasta que alguien le escriba o complete la tarea. El tiempo de
espera y el texto del aviso se configuran en
[Agentes de IA](/ayuda/agentes-de-ia).

### Cuando una persona responde

Responder desde la tarjeta **Responder** también toma la conversación: pasa
a **Derivada a un humano** (si no lo estaba) y el agente se calla. La tarjeta
lo muestra con el aviso "El agente está en pausa: esta conversación la
atiende una persona". Lo mismo pasa si alguien le contesta al cliente desde
la bandeja de Meta: el sistema se entera y el agente deja de responder.

### Quién puede atender

- El **vendedor asignado** a la conversación.
- Cualquier **administrador**.

Una conversación que todavía no tiene vendedor asignado solo la puede tomar
un administrador, y al responder pasa a ser suya. Si no podés atenderla, la
tarjeta lo dice: "Solo el vendedor asignado a esta conversación o un
administrador pueden responderla". Un administrador puede cambiar el
vendedor desde la ficha del contacto o desde **Asignar vendedor** en
Consultas sin identificar.

### Devolver al agente

Cuando el tema está resuelto y querés que el agente siga atendiendo al
cliente, tocá **Devolver al agente**. La conversación vuelve a **Activa** y
el agente contesta el próximo mensaje del cliente.

> Si devolvés la conversación **sin haberle respondido** al cliente desde
> que pidió una persona, el sistema te pide confirmación: al cliente le va a
> llegar el aviso de que lo contactan más tarde, y la tarea de seguimiento
> queda pendiente. Si preferís, respondele primero y devolvé después.

## Responder {#responder}

1. Abrí la conversación.
2. En la tarjeta **Responder**, escribí el mensaje (hasta 4.096 caracteres).
3. Tocá **Enviar**.

El mensaje aparece en el hilo con tu nombre y, en los canales de Meta, con su
estado de entrega. Si el envío falla, lo que escribiste sigue en el cuadro
para que no lo pierdas; si Meta lo rechazó, el mensaje queda en el hilo con
el botón **Reintentar**.

### Por dónde sale

La tarjeta lo dice debajo del cuadro, según el canal:

- **WhatsApp**: sale desde el número de WhatsApp del negocio (el que atiende
  el agente). No se puede responder desde la app de WhatsApp del celular:
  solo desde acá.
- **Messenger**: sale desde la página de Facebook del negocio.
- **Instagram**: sale desde la cuenta de Instagram del negocio.
- **Web**: le llega al visitante en el chat del sitio. Si cerró el chat, lo
  ve cuando lo vuelva a abrir.

### La ventana de 24 horas

WhatsApp, Messenger e Instagram solo dejan escribirle libremente a una
persona durante las **24 horas siguientes a su último mensaje**. La tarjeta
muestra hasta cuándo: "Podés escribir texto libre hasta el (fecha y hora)".

Pasado ese plazo el cuadro se deshabilita:

- En **WhatsApp**, "solo permite plantillas aprobadas": desde esta pantalla
  no se puede mandar texto libre. Los mensajes de las
  [automatizaciones](/ayuda/automatizaciones) usan plantillas aprobadas, por
  eso sí pueden salir.
- En **Messenger** e **Instagram**, no se le puede escribir hasta que el
  cliente vuelva a escribir. Apenas lo haga, la ventana se abre de nuevo.

El chat de la **web** no tiene esta limitación.

> Si el cliente pidió hablar con una persona, no dejes pasar las 24 horas:
> después solo queda esperar a que vuelva a escribir.

### Conversaciones cerradas

Una conversación cerrada no tiene tarjeta **Responder**. Si necesitás
escribirle al cliente, esperá a que vuelva a escribir (se abre una
conversación nueva) o mandale un [cupón](/ayuda/cupones-y-qr#enviar-cupon),
que sale igual.

## Resumen {#resumen}

Arriba del hilo está la tarjeta **Resumen**: dos a cuatro oraciones que
cuentan qué pasó en la conversación. Lo escribe la IA, para que nadie tenga
que leer el hilo entero para saber de qué se trata. El mismo texto se ve
debajo del nombre del contacto en la bandeja.

- Se genera solo cuando el agente deriva la conversación a una persona.
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

## Acciones del agente {#acciones-del-agente}

Además de conversar, el agente de IA puede **hacer cosas** en el sistema,
según lo que el administrador le haya habilitado: anotar el vehículo que le
interesa al cliente, calificar el interés, crear una oportunidad de venta,
reservar una unidad del stock, reservar un turno, compartir los datos de
cobro, guardar campos personalizados, marcar al contacto como «sin interés»
o derivar la conversación a una persona.

En el hilo de la conversación **esas acciones no se ven como tales**: el hilo
muestra solo lo que se dijeron el cliente, el agente, el equipo y las
automatizaciones. Lo que el agente hizo se ve por sus efectos:

- el **vehículo de interés** y la calificación, en la ficha del contacto
  (ver [Vehículo de interés](/ayuda/contactos-y-consultas#vehiculo-de-interes));
- la **oportunidad** que creó, en Oportunidades, con el motivo del cliente
  como nota;
- la **unidad reservada**, en el stock y en la oportunidad;
- la marca **Sin interés**, arriba de la ficha, con el motivo que dijo el
  cliente;
- los **campos personalizados** que completó, en la ficha;
- la **tarea** y el estado **Derivada a un humano**, cuando derivó.

Si un administrador necesita ver en detalle qué acción pidió el agente, con
qué datos, si se le permitió y qué resultado tuvo, eso se ve en el
**probador** de cada agente, en [Agentes de IA](/ayuda/agentes-de-ia). Es
información de diagnóstico, con datos crudos, y por eso no está en la
bandeja que lee el equipo comercial.

> Que una acción esté habilitada no significa que el agente la ejecute
> cuando quiera: antes de cada una, el sistema vuelve a revisar las reglas
> que escribió el administrador para ese agente.
