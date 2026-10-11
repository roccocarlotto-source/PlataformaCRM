# Base de conocimiento

La base de conocimiento es la información de la clínica que el
[asistente de IA](/ayuda/agentes-de-ia#agentes) usa para responder: horarios,
formas de pago, cómo se cancela un turno, qué prestaciones hay, preguntas
frecuentes y las indicaciones antes y después de cada prestación. Se carga por
sede, en entradas cortas, y cada asistente lee las de su sede.

Solo un administrador configura la base: está dentro de **Agentes de IA** en
el menú. Recepción no la ve.

## Entradas {#entradas}

La pantalla [Base de conocimiento](/knowledge-base) lista las entradas de la
organización. Cada entrada tiene:

- un **Título**, que identifica la entrada en la lista y encabeza su texto
  cuando el asistente lo lee;
- una **Sede**;
- un **Estado**: **Activa** o **Inactiva**. Una entrada inactiva existe y se
  puede editar, pero el asistente no la lee.

Podés buscar por título (no por el texto de adentro), filtrar por **Sede** y
por **Estado**, y ordenar por **Fecha de creación** o por **Título**. El
contenido no se muestra en la tabla: para leerlo, abrí la entrada con
**Editar**.

Para borrar varias entradas a la vez, tildá la casilla de cada fila (o la del
encabezado, que tilda las de la página que estás viendo) y tocá **Eliminar
seleccionadas**.

> Al eliminar una entrada, el asistente de esa sede deja de usarla para
> responder desde ese momento. Si solo querés sacarla un tiempo, desmarcá
> **Activa** en vez de eliminarla.

Conviene una entrada por tema, con un título claro: "Horarios de atención",
"Formas de pago", "Antes de la limpieza facial". Un bloque enorme con todo
mezclado funciona peor que varios bloques cortos.

## Crear o editar una entrada {#nueva-entrada}

1. En [Base de conocimiento](/knowledge-base), tocá **Nueva entrada** (o
   **Editar** en la fila de una existente).
2. Escribí el **Título**. Hasta 200 caracteres.
3. Elegí la sede. Al editar se puede cambiar: si cargaste una entrada en la
   sede equivocada, movela desde acá.
4. Dejá **Activa** marcada para que el asistente la lea. Desmarcala para
   guardarla sin que la use todavía, o para pausarla (por ejemplo, una
   promoción de temporada que después vas a reactivar).
5. Elegí el **Tipo**: **Información general** o **Indicaciones antes o después
   de una prestación** (ver [Indicaciones](#indicaciones-de-prestaciones)).
6. Escribí el **Contenido**: el texto que el asistente va a leer, tal cual,
   sin ninguna interpretación de por medio. Escribilo como se lo contarías a
   alguien que recién entra a trabajar. Por ejemplo: "Atendemos de lunes a
   viernes de 9 a 18 y los sábados de 9 a 13. El último turno se da media
   hora antes del cierre." Hasta 10.000 caracteres por entrada.
7. Tocá **Guardar**.

Si ya tenés el texto en un documento, podés subirlo en vez de escribirlo
(ver abajo).

> Lo que cargues en una entrada activa lo puede repetir el asistente
> textualmente a los pacientes de esa sede. **No cargues datos de pacientes**
> ni información interna.

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

> Revisá que el documento no tenga datos de pacientes antes de subirlo: todo
> el texto que queda en el campo lo puede leer el asistente.

## Indicaciones antes y después de una prestación {#indicaciones-de-prestaciones}

Una entrada de tipo **Indicaciones antes o después de una prestación** (por
ejemplo, "Antes de la limpieza facial") el asistente la **transcribe tal
cual**: no la explica, no le agrega nada y no la adapta a cada paciente. Si un
paciente pregunta por un síntoma, el asistente no responde con la indicación:
pasa la conversación a la recepción.

Cómo usa el asistente estas entradas, en
[Indicaciones antes y después de una prestación](/ayuda/agentes-de-ia#indicaciones).
