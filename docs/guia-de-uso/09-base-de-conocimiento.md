# Base de conocimiento

La base de conocimiento es la información del negocio que los
[agentes de IA](/ayuda/agentes-de-ia) usan para responder: horarios, formas
de pago, política de cancelación, promociones, preguntas frecuentes y, si
querés, el stock de la sucursal. Se carga por sucursal, en entradas cortas,
y cada agente lee las de su sucursal.

Esta sección es para administradores: está dentro de **Agentes de IA** en el
menú.

## Entradas {#entradas}

La pantalla [Base de conocimiento](/knowledge-base) lista las entradas de la
organización. Cada entrada tiene:

- un **Título**, que identifica la entrada en la lista y encabeza su texto
  cuando el agente lo lee;
- una **Sucursal**;
- un **Estado**: **Activa** o **Inactiva**. Una entrada inactiva existe y se
  puede editar, pero el agente no la lee;
- la etiqueta **Stock** si la generó la sincronización del stock (ver
  [Sincronizar el stock](#sincronizar-stock)) y no una persona.

Podés buscar por título (no por el texto de adentro), filtrar por sucursal y
por estado, y ordenar por fecha de creación o por título. El contenido no se
muestra en la tabla: para leerlo, abrí la entrada con **Editar**.

Para borrar varias entradas a la vez, tildá la casilla de cada fila (o la del
encabezado, que tilda las de la página que estás viendo) y tocá **Eliminar
seleccionadas**.

> Al eliminar una entrada, los agentes de esa sucursal dejan de usarla para
> responder desde ese momento. Si solo querés sacarla un tiempo, desmarcá
> **Activa** en vez de eliminarla.

Conviene una entrada por tema, con un título claro: "Horarios de atención",
"Formas de pago", "Promoción de octubre". Un bloque enorme con todo mezclado
funciona peor que varios bloques cortos.

## Crear o editar una entrada {#nueva-entrada}

1. En [Base de conocimiento](/knowledge-base), tocá **Nueva entrada** (o
   **Editar** en la fila de una existente).
2. Escribí el **Título**. Hasta 200 caracteres.
3. Elegí la **Sucursal**. Al editar se puede cambiar: si cargaste una entrada
   en la sucursal equivocada, movela desde acá.
4. Dejá **Activa** marcada para que el agente la lea. Desmarcala para
   guardarla sin que la use todavía, o para pausarla (por ejemplo, una
   promoción de temporada que después vas a reactivar).
5. Escribí el **Contenido**: el texto que el agente va a leer, tal cual, sin
   ninguna interpretación de por medio. Escribilo como se lo contarías a
   alguien que recién entra a trabajar. Por ejemplo: "Atendemos de lunes a
   viernes de 9 a 18 y los sábados de 9 a 13. El último turno se da media
   hora antes del cierre." Hasta 10.000 caracteres por entrada.
6. Tocá **Guardar**.

Si ya tenés el texto en un documento, podés subirlo en vez de escribirlo
(ver abajo).

> Lo que escribís en una entrada activa lo usan todos los agentes de esa
> sucursal para contestarles a los clientes, y puede terminar en lo que les
> dicen. No cargues datos internos, precios de costo ni información de
> clientes.

Si la entrada que estás editando tiene la etiqueta **Stock**, la pantalla
avisa que la generó la sincronización del stock a partir de una unidad.
Podés corregirla, pero la próxima vez que sincronices el stock de esa
sucursal se va a reescribir con los datos del vehículo. Si el dato está mal,
corregilo en la ficha de la unidad en [Stock](/ayuda/stock) y volvé a
sincronizar.

## Subir un documento {#subir-documento}

En la tarjeta **Contenido** del formulario, el botón **Completar desde un
archivo (.txt, .docx o .pdf)** lee el texto de un documento y lo pega en el
campo **Contenido**.

1. Tocá el botón y elegí el archivo. Se aceptan archivos de texto, Word
   modernos (`.docx`) y PDF, de hasta 5 MB.
2. Si el campo **Contenido** ya tenía texto, la pantalla pregunta antes de
   reemplazarlo. El archivo lo pisa por completo; no se agrega al final.
3. Esperá unos segundos mientras se extrae el texto. Revisalo: es texto
   común, podés editarlo, recortarlo o completarlo antes de guardar.
4. Tocá **Guardar**. Se guarda lo que haya en el campo, no el archivo.

Para tener en cuenta:

- El archivo no se guarda en ningún lado ni queda asociado a la entrada.
  Solo sobrevive el texto que cayó en el campo.
- Un PDF escaneado (una foto del papel, sin texto que se pueda seleccionar)
  no sirve: ese hay que copiarlo a mano. Lo mismo si el documento no tiene
  texto: la pantalla avisa que no se pudo leer.
- Los archivos de Word viejos (`.doc`) no se aceptan: guardalos como `.docx`.
- Si el documento es muy largo, el texto se corta y aparece el aviso **El
  archivo era muy largo, se cortó el texto**. Revisá que lo importante haya
  quedado.
- El tope sigue siendo de 10.000 caracteres por entrada. Si el texto lo
  supera, un aviso dice cuántos caracteres sobran; recortalos antes de
  guardar, o repartí el documento en varias entradas (una por tema).

**Quitar archivo** borra el nombre del archivo y el texto que trajo, dejando
el campo vacío. No recupera lo que había antes de elegirlo.

## Sincronizar el stock {#sincronizar-stock}

Para que el agente pueda hablar de las unidades en venta sin que nadie
copie sus datos a mano, el botón **Sincronizar stock** genera una entrada
por cada vehículo de una sucursal, con los datos de su ficha (marca, modelo,
versión, año, kilometraje, precio, equipamiento, etc.). Entran las unidades
**disponibles** y marcadas para **publicar en el sitio web** en
[Stock](/ayuda/stock); las reservadas, vendidas o no publicadas no.

1. En [Base de conocimiento](/knowledge-base), elegí una **Sucursal** en los
   filtros. El botón está deshabilitado hasta que no elijas una, porque la
   sincronización es por sucursal.
2. Tocá **Sincronizar stock** y confirmá.
3. Al terminar, un resumen dice cuántas entradas se crearon, cuántas se
   actualizaron y cuántas se dieron de baja. Si el stock ya estaba al día,
   dice que no hubo cambios.

Qué hace cada corrida:

- **Crea** una entrada para cada unidad que califica y todavía no tenía.
- **Reescribe** las entradas de las unidades que cambiaron (un precio, el
  kilometraje, una descripción), aunque alguien las haya editado a mano.
- **Da de baja** las entradas de las unidades que ya no califican: se
  vendieron, se reservaron, se despublicaron o se eliminaron.
- **No toca** las entradas escritas a mano (las que no tienen la etiqueta
  **Stock**), por más que hablen de un vehículo.

> La sincronización no es automática: cada vez que cambia el stock de la
> sucursal (una venta, un precio nuevo, una unidad que entra), hay que volver
> a tocar **Sincronizar stock** para que el agente lo sepa. Conviene hacerlo
> como parte de la rutina al cargar o cerrar unidades.

Las entradas generadas se ven en la lista con la etiqueta **Stock**. Se pueden
desactivar o editar como cualquier otra, con la salvedad de que la próxima
corrida las vuelve a escribir.

Esta sincronización es distinta de la acción **Buscar vehículos en stock**
de los [agentes](/ayuda/agentes-de-ia#acciones): con la acción, el agente
busca en el stock real en el momento, con los filtros que da el cliente; con
la sincronización, el agente tiene siempre a mano el texto de cada unidad.
Se pueden usar las dos.
