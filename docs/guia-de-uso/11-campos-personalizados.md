# Campos personalizados

La ficha de un contacto trae los datos de siempre: nombre, apellido, email,
teléfono, empresa, etapa. Los **campos personalizados** son los datos que
necesita tu negocio y que la ficha no tiene: la patente del auto actual, si
tiene auto para entregar en parte de pago, la forma de pago que prefiere, la
fecha en que vence su seguro.

- **Solo un administrador** define los campos (cuáles hay, de qué tipo, con
  qué opciones), desde el menú **Campos de contacto** de la configuración.
- **Todos** los ven en la ficha de cada contacto, en la tarjeta **Campos
  personalizados**, y los completa quien puede editar ese contacto (un
  administrador o el vendedor asignado).
- El **agente de IA** los lee todos cuando atiende al contacto, y puede
  completar los que estén marcados como editables por él.

## Campos de contacto {#campos}

La pantalla [Campos de contacto](/contact-custom-fields) lista los campos
definidos por la organización. Una organización puede tener **hasta 30
campos**; la pantalla dice cuántos hay en uso y, al llegar al tope, el botón
**Nuevo campo** desaparece.

Cada fila muestra:

- **Etiqueta**: el nombre que se ve en la ficha.
- **Clave**: el nombre corto con el que el agente de IA identifica el campo.
  Sale de la etiqueta al crearlo y no cambia después, aunque renombres la
  etiqueta.
- **Tipo**: ver [Tipos de campo](#tipos).
- **Opciones**: las opciones de una lista, separadas por comas; "—" en los
  demás tipos.
- **Agente**: **Puede editar** o **Solo lee**. Ver
  [Editable por el agente](#editable-por-el-agente).

El menú de cada fila ofrece **Editar** y **Eliminar**.

> **Eliminar** un campo lo saca de las fichas, pero **no borra los valores**
> que los contactos ya tenían cargados: quedan guardados, aunque dejen de
> verse. Pide confirmación.

### Cómo se ven en la ficha

En la ficha de cada contacto, debajo de los datos, aparece la tarjeta
**Campos personalizados** con un control por campo, en el orden en que se
crearon. Si no hay campos definidos, la tarjeta no aparece.

- **Texto**: un renglón de hasta 500 caracteres.
- **Número**: un número, con decimales si hace falta.
- **Fecha**: un selector de fecha.
- **Sí / No**: una casilla.
- **Lista de opciones**: un desplegable con las opciones y la opción
  **Sin cargar**.
- **Selección múltiple**: una casilla por opción; se pueden marcar varias.

Para borrar un valor, vaciá el campo (o elegí **Sin cargar**, o desmarcá
todas las casillas) y guardá la ficha. Los campos se guardan junto con el
resto de la ficha, con el botón **Guardar**.

## Nuevo campo {#nuevo-campo}

Solo para administradores.

1. En [Campos de contacto](/contact-custom-fields), tocá **Nuevo campo**.
2. Escribí la **Etiqueta**: el nombre que van a ver los vendedores en la
   ficha, hasta 100 caracteres. Por ejemplo "Patente del auto actual".
3. Elegí el **Tipo**. Pensalo bien: salvo entre los dos tipos de lista, el
   tipo no se puede cambiar después (ver
   [Cambiar el tipo de un campo](#cambiar-el-tipo)).
4. Si el tipo es **Lista de opciones** o **Selección múltiple**, cargá las
   **Opciones**. Ver [Opciones de una lista](#opciones).
5. Marcá **Editable por el agente de IA** si querés que el agente pueda
   completar este campo con lo que le cuente el cliente. Ver
   [Editable por el agente](#editable-por-el-agente).
6. Tocá **Guardar**.

El campo aparece de inmediato en la ficha de todos los contactos, vacío.

> La clave del campo (la que usa el agente) sale de la etiqueta y **no
> cambia después**, aunque renombres la etiqueta. Si te equivocaste de
> etiqueta, podés corregirla con **Editar**; la clave sigue siendo la
> original, y eso no afecta nada en la ficha.

### Editar un campo

Desde **Editar** se puede cambiar la etiqueta, las opciones de una lista y
si es editable por el agente. El tipo, solo entre los dos tipos de lista.

## Tipos de campo {#tipos}

| Tipo | Para qué sirve | Ejemplo |
|---|---|---|
| **Texto** | Un dato corto en texto libre | Patente: "AB 123 CD" |
| **Número** | Una cantidad o un importe | Kilómetros del auto actual: 85000 |
| **Fecha** | Un día del calendario | Vencimiento del seguro: 15/03/2027 |
| **Sí / No** | Algo que es cierto o no | Tiene auto para entregar: Sí |
| **Lista de opciones** | Elegir **una** entre opciones fijas | Forma de pago: Contado / Financiado / Permuta |
| **Selección múltiple** | Elegir **varias** entre opciones fijas | Le interesa: SUV, Pick-up, Sedán |

Cuándo conviene una lista en vez de texto libre: cuando después vas a querer
contar o filtrar por ese dato. "Contado", "contado" y "al contado" escritos
a mano son tres cosas distintas; en una lista son una sola opción.

### Cambiar el tipo de un campo {#cambiar-el-tipo}

Los valores que los contactos ya tienen cargados son del tipo del campo, y
por eso el tipo casi nunca se puede cambiar. Al editar un campo:

- Si es **Texto**, **Número**, **Fecha** o **Sí / No**, el tipo aparece
  bloqueado: "El tipo no se puede cambiar: los contactos ya tienen valores
  de ese tipo. Para cambiarlo, eliminá el campo y creá otro."
- Si es **Lista de opciones** o **Selección múltiple**, se puede pasar de
  uno al otro:
  - **De lista a selección múltiple**: siempre se puede. Cada contacto
    conserva la opción que tenía, ahora como única marcada.
  - **De selección múltiple a lista**: solo si ningún contacto tiene más de
    una opción marcada. Si alguno tiene dos o más, el sistema rechaza el
    cambio: primero hay que dejarle una sola opción a esos contactos.

## Opciones de una lista {#opciones}

Para los tipos **Lista de opciones** y **Selección múltiple**, el formulario
muestra el bloque **Opciones**: una opción por fila.

### Cargar opciones

- Escribí una opción en cada fila. **Enter** pasa a la fila siguiente (y la
  crea si no existe); en el celular, la tecla "siguiente" hace lo mismo.
- **Agregar opción** suma una fila vacía al final.
- Si pegás una lista separada por comas o por renglones (por ejemplo,
  "Contado, Financiado, Permuta"), se reparte sola en varias filas.
- Las filas vacías no se guardan.
- Las flechas **Subir** y **Bajar** cambian el orden, que es el orden en que
  se ven en la ficha. El tacho **Borrar** saca la fila.

Reglas que el sistema controla al guardar:

- al menos una opción;
- hasta **50 opciones**, de hasta 100 caracteres cada una;
- sin repetidas. "Contado" y "contado" cuentan como la misma opción: no se
  distinguen mayúsculas ni acentos.

Si algo no cumple, el formulario marca las filas a corregir y dice por qué.

### Renombrar una opción

Editá el texto de la fila y guardá. Los contactos que tenían esa opción
elegida pasan al texto nuevo: si "Financiado" pasa a llamarse "Crédito",
todos los que tenían "Financiado" quedan con "Crédito". Antes de guardar, una
ventana te lo informa con la cantidad de contactos.

> Partir una opción no es renombrarla. Si en la fila "Contado, financiado,
> permuta" pegás ese texto para separarlo en tres, el sistema la trata como
> una opción **eliminada** y tres **nuevas**, y te pregunta qué hacer con los
> contactos que la tenían (ver abajo).

### Eliminar una opción que ya usan contactos

Al borrar una fila y guardar, si algún contacto tiene esa opción elegida, se
abre la ventana **Opciones que ya usan contactos**. Por cada opción eliminada
dice cuántos contactos la tienen y te pide decidir **Qué hacer con «la
opción»**:

- **Dejar sin cargar** (lo que viene por defecto): a esos contactos se les
  quita la opción y el campo les queda vacío.
- **Pasar a: (otra opción)**: a esos contactos se les reemplaza por la opción
  que elijas, entre las que quedan en la lista.
- **Pasar a todas las nuevas**: solo en **Selección múltiple**, y solo cuando
  en este mismo guardado agregaste dos o más opciones. Es el caso de partir
  "Contado, financiado, permuta" en tres: los contactos que tenían la opción
  vieja quedan con las tres nuevas marcadas.
- **Conservar como opción eliminada**: el contacto se queda con el texto
  viejo. En su ficha se ve marcado como "(opción eliminada)" y se puede
  seguir viendo, pero una vez que se cambie por otra opción no se puede
  volver a elegir.

Tocá **Guardar** en la ventana para aplicar todo junto. Si ningún contacto
tenía la opción, no se pregunta nada.

## Editable por el agente {#editable-por-el-agente}

Cada campo tiene la casilla **Editable por el agente de IA**. Define qué
puede hacer el agente con ese campo cuando habla con el contacto:

- **Sin marcar** (**Solo lee** en la lista): el agente ve el valor y lo usa
  para atender mejor (por ejemplo, sabe que el cliente ya tiene un auto para
  entregar), pero no lo modifica. Lo cargan solo las personas.
- **Marcado** (**Puede editar** en la lista): además, cuando el cliente le
  da ese dato en la conversación, el agente lo guarda en la ficha. Si el
  cliente dice "mi auto actual es un Corsa 2012 con patente AB 123 CD", el
  agente completa "Patente del auto actual".

El agente respeta el tipo del campo: en una lista solo puede elegir una de
las opciones definidas, en un número solo puede guardar un número. Lo que no
encaja, no se guarda.

Para que el agente pueda escribir, además de marcar el campo hace falta que
ese agente tenga habilitada la acción **Guardar campos personalizados** en
su configuración. Ver [Agentes de IA](/ayuda/agentes-de-ia).

> Marcá como editables solo los campos que el cliente puede responder en un
> chat (su patente, qué busca, cómo prefiere pagar). Lo que decide el
> negocio (una categoría interna, una nota del vendedor) conviene dejarlo en
> **Solo lee**, para que el agente no lo pise con algo que entendió mal.
