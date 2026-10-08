# Primeros pasos

Plataforma CRM es la herramienta con la que el equipo de la automotora lleva
sus contactos, conversaciones, oportunidades de venta, stock, turnos y
agentes de IA. Esta sección cubre lo primero que vas a necesitar: entrar,
moverte por el menú y entender qué muestra la pantalla de inicio.

Hay dos tipos de cuenta:

- **Administrador**: ve y configura todo (usuarios, sucursales, agentes de
  IA, fuentes de ingesta, etc.) y puede editar o eliminar cualquier
  registro.
- **Usuario**: trabaja con el CRM del día a día (contactos, conversaciones,
  oportunidades, tareas, turnos, stock) y edita solo lo que tiene asignado a
  su nombre.

Tu rol aparece debajo de tu nombre, al pie del menú. El detalle de qué puede
hacer cada rol, pantalla por pantalla, está en
[Usuarios y permisos](/ayuda/usuarios-y-permisos#roles).

## Ingresar {#ingresar}

Para entrar necesitás una cuenta. Las cuentas no se crean solas: un
administrador de tu organización te manda una invitación por email (ver
[Aceptar una invitación](#aceptar-invitacion)). Una vez que tenés la cuenta
creada:

1. Abrí la dirección de la app en el navegador. Si no tenés sesión, vas a ver
   la pantalla **Iniciar sesión**.
2. Completá **Email** y **Contraseña**.
3. Tocá **Ingresar**.

Si todo está bien, entrás al [Dashboard](#dashboard). Si habías intentado
abrir una pantalla puntual antes de ingresar (por ejemplo, un link a una
conversación), después de ingresar vas directo a esa pantalla.

Qué puede pasar:

- **El email o la contraseña no coinciden**: el sistema te lo dice debajo del
  formulario. Revisá que el email sea el que te invitaron y, si no te
  acordás la contraseña, usá
  [Recuperar la contraseña](#recuperar-contrasena).
- **"No pudimos verificar tu cuenta"**: la app no pudo confirmar tus datos
  (por ejemplo, se cortó internet). Tocá **Reintentar**.
- **Tu cuenta no está disponible**: si un administrador desactivó tu cuenta,
  el sistema te lo avisa y no te deja entrar. Hablá con un administrador de
  tu organización.

> La sesión dura mientras el navegador esté abierto. Si cerrás el navegador
> por completo, la próxima vez vas a tener que volver a ingresar. En una
> computadora compartida, además, cerrá sesión al terminar (ver
> [El menú](#menu)).

## Recuperar la contraseña {#recuperar-contrasena}

Si no te acordás la contraseña, podés elegir una nueva desde tu email:

1. En la pantalla **Iniciar sesión**, tocá **¿Olvidaste tu contraseña?**.
2. Escribí tu email y tocá **Enviar enlace**.
3. Vas a ver el mensaje **Revisá tu email**. Si existe una cuenta con ese
   email, te llega un correo con un enlace para restablecer la contraseña.
   Si no te llega en unos minutos, revisá la carpeta de correo no deseado.
4. Abrí el enlace. Vas a ver la pantalla **Elegí una nueva contraseña**.
5. Completá **Contraseña** y **Confirmar contraseña**. Tienen que coincidir y
   tener al menos 8 caracteres.
6. Tocá **Guardar contraseña**.
7. Volvés a la pantalla de inicio de sesión: ingresá con la contraseña nueva.

Si al abrir el enlace ves **"Este enlace no es válido o expiró"**, tocá
**Solicitar un nuevo enlace** y repetí el proceso: los enlaces vencen y se
usan una sola vez.

> Por seguridad, el mensaje después de pedir el enlace es siempre el mismo,
> exista o no una cuenta con ese email. Si no te llega nada, confirmá con un
> administrador que te hayan invitado con ese email.

## Aceptar una invitación {#aceptar-invitacion}

Un administrador te invita desde la app (ver
[Invitar a una persona](/ayuda/usuarios-y-permisos#invitar)) y vos recibís
un email con un enlace. Para crear tu cuenta:

1. Abrí el enlace del email. Vas a ver la pantalla **Completá tu cuenta**.
2. Escribí tu **Nombre completo** tal como querés que lo vea el resto del
   equipo (por ejemplo, "Ana Pérez"). Es el nombre que aparece en el menú,
   en las tareas y como vendedor asignado.
3. Elegí una **Contraseña** y repetila en **Confirmar contraseña** (al menos
   8 caracteres).
4. Tocá **Completar registro**.
5. Entrás directo al [Dashboard](#dashboard), ya con tu cuenta creada.

El rol (administrador o usuario) lo eligió quien te invitó. Un
administrador lo puede cambiar después desde
[Usuarios](/ayuda/usuarios-y-permisos#usuarios).

Qué puede pasar:

- **"Este enlace no es válido o expiró. Pedile a tu administrador que te
  reinvite"**: las invitaciones vencen. Un administrador tiene que mandarte
  una nueva.
- **"Ya iniciaste sesión como ana@example.com"**: abriste el enlace en un
  navegador donde ya hay una sesión abierta. Si la invitación es para esa
  misma cuenta, podés configurar la contraseña ahí mismo. Si es para otra
  persona, primero cerrá sesión y volvé a abrir el enlace.
- **"Tu cuenta ya fue creada. Solo falta configurar tu contraseña"**: algo se
  interrumpió a mitad de camino (por ejemplo, se recargó la página). No hace
  falta volver a empezar: completá la contraseña y tocá **Guardar
  contraseña**.
- Si aparece un error, tocá **Reintentar**: el sistema retoma desde el paso
  que falló, sin crear nada dos veces.

## El dashboard {#dashboard}

Es la pantalla de inicio, un resumen del negocio. Cada tarjeta carga por su
cuenta: si una no se puede mostrar, las demás siguen funcionando.

**El selector de período.** Arriba a la derecha hay tres opciones:
**Mensual**, **Semanal** y **Diario**. Cambia a la vez las tres tarjetas
comerciales y el gráfico de ingresos. "Hoy", "esta semana" y "este mes" se
calculan con la zona horaria de la organización (la configura un
administrador en
[Organización](/ayuda/organizacion-y-sucursales#organizacion)).

Las tarjetas, de arriba hacia abajo:

- **Unidades en stock** y **Disponibles**: cuántos vehículos hay cargados y
  cuántos están disponibles para la venta. Es la foto de hoy: no cambia con
  el período.
- **Oportunidades creadas** (este mes / esta semana / hoy): cuántas
  oportunidades se abrieron en el período, con la diferencia respecto del
  período anterior.
- **Ganado**: el total de las oportunidades ganadas en el período, en la
  moneda de la organización, con la variación en porcentaje respecto del
  período anterior.
- **Tasa de cierre**: de las oportunidades que se cerraron en el período,
  qué porcentaje se ganó (ganadas sobre ganadas más perdidas). La variación
  se muestra en puntos.
  Cuando no hay con qué comparar (por ejemplo, el período anterior tuvo
  cero), la variación dice **"— sin base de comparación"**.
- **Ingresos ganados por mes / semana / día**: un gráfico con lo ganado en
  los últimos 6 meses, 8 semanas o 30 días. El último tramo va punteado
  porque es el período en curso, todavía sin cerrar. Si pasás el cursor por
  el gráfico, ves el valor exacto de cada punto.
- **Oportunidades recientes**: las últimas 5 oportunidades creadas en la
  organización, de cualquier vendedor, con empresa, monto y estado.
- **Mayores oportunidades abiertas**: las 5 oportunidades abiertas de mayor
  monto, en la moneda de la organización.
- **Proceso de venta**: cuántas oportunidades hay en cada etapa del proceso
  de venta predeterminado. Si todavía no hay un proceso marcado como
  predeterminado, la tarjeta lo avisa (ver
  [Oportunidades y procesos de venta](/ayuda/oportunidades-y-procesos-de-venta)).
- **Actividad reciente**: las últimas 8 actividades (llamadas, reuniones,
  tareas, notas), con a quién o a qué están relacionadas y quién las cargó.
  Un administrador ve las de todo el equipo; un usuario, solo las suyas.
- **Acciones rápidas** (solo administradores): atajos a **Nueva empresa**,
  **Nuevo contacto**, **Nueva oportunidad** y **Nueva actividad**.

## El menú {#menu}

El menú está en la columna de la izquierda. Arriba de todo, **Plataforma
CRM** te lleva siempre al Dashboard. Después vienen los accesos directos y
las secciones:

- **Dashboard**.
- **Agente interno**: el chat con el asistente de IA del equipo. Solo
  aparece si tenés acceso (ver [El agente interno](#agente-interno)).
- **Canjear cupón**: para escanear el QR de un cupón de descuento en el
  mostrador (ver [Cupones y QR](/ayuda/cupones-y-qr)).
- **CRM**: **Contactos** (con **Conversaciones**, **Empresas** y
  **Oportunidades** colgando de él), **Procesos de venta** y **Stock**.
- **Actividades**: **Mis tareas**, **Reservas** y **Calendario** para todos;
  **Actividades** (el listado completo del equipo), **Recursos** y **Tipos
  de servicio** solo para administradores.
- **Administración**: **QR** para todos; **Usuarios**, **Invitaciones**,
  **Fuentes de ingesta**, **Claves de ingesta**, **Eventos de ingesta**,
  **Organización**, **Sucursales** y **Campos de contacto** solo para
  administradores.
- **Agentes de IA** (solo administradores): el listado de agentes, y debajo
  **Base de conocimiento**, **Automatizaciones** y **Configurar agente
  interno**.
- **Plataforma**: solo lo ve el equipo de la plataforma, no el personal de
  la automotora.
- **Ayuda**: esta guía (ver [Ayuda](#ayuda)).

Cada sección se pliega o despliega tocando su título. La sección de la
pantalla en la que estás se abre sola, así siempre ves dónde estás parado.
En **Contactos** y **Agentes de IA** el título es a la vez un link: tocarlo
abre esa pantalla y despliega lo que cuelga de ella.

Al pie del menú está el [selector de tema](#tema), tu nombre con tu rol
(**Administrador** o **Usuario**) y el botón **Cerrar sesión**.

### Cerrar sesión

Tocá **Cerrar sesión** al pie del menú. Volvés a la pantalla de inicio de
sesión. Si no se pudo cerrar (por ejemplo, sin conexión), el sistema te lo
avisa ahí mismo para que vuelvas a intentar.

### El menú en el celular

En pantallas chicas el menú no entra al costado. En su lugar hay una barra
arriba con el botón de menú (las tres líneas) a la izquierda:

1. Tocá el botón para abrir el menú como un panel.
2. Elegí una opción: el panel se cierra solo al navegar.
3. Para cerrarlo sin elegir nada, tocá fuera del panel.

Todo lo demás (secciones, tema, cerrar sesión) funciona igual que en la
computadora.

## Tema claro y oscuro {#tema}

Al pie del menú hay tres botones: **Sistema**, **Claro** y **Oscuro**.

- **Sistema** (la opción inicial): la app sigue lo que tenga configurado tu
  computadora o tu celular, y cambia sola si cambiás eso.
- **Claro** y **Oscuro**: fijan el tema sin importar el sistema.

La elección se guarda en ese navegador y en ese dispositivo: en otra
computadora o en el celular podés tener una distinta.

## El agente interno {#agente-interno}

El agente interno es el asistente de IA **del equipo**: le preguntás cosas
del negocio y le pedís ayuda con el CRM. No es el agente que habla con los
clientes; ese se configura y se prueba desde
[Agentes de IA](/ayuda/agentes-de-ia).

Quién lo puede usar:

- los administradores, siempre;
- los usuarios a los que un administrador les marcó **Acceso al agente
  interno** en [Usuarios](/ayuda/usuarios-y-permisos#usuarios).

Si no tenés acceso, el ítem **Agente interno** no aparece en el menú.

Para que funcione, un administrador tiene que haberlo configurado antes en
**Agentes de IA → Configurar agente interno** (ver
[Agentes de IA](/ayuda/agentes-de-ia)). Hasta entonces, el chat muestra
**"Todavía no hay un agente interno configurado"**: si sos administrador,
con un botón para configurarlo; si no, pedíselo a un administrador.

Cómo usarlo:

1. En el menú, tocá **Agente interno**. El título de la pantalla es el
   nombre que le puso tu organización al agente.
2. Escribí en la caja de abajo (hasta 4000 caracteres). **Enter** envía el
   mensaje; **Shift + Enter** hace un salto de línea. También podés tocar
   **Enviar**.
3. Mientras el agente arma la respuesta ves **"Escribiendo…"** y no podés
   mandar otro mensaje. Cuando termina, la respuesta aparece en el hilo.
4. Para ver mensajes viejos, tocá **Ver mensajes anteriores** arriba del
   hilo.

Tené en cuenta:

- Cada persona tiene su propio hilo: tus mensajes no los ve el resto del
  equipo, y vos no ves los de otros.
- Qué puede hacer, además de conversar, depende de lo que habilitó el
  administrador: hoy puede **crear tareas** (quedan asignadas a vos, en
  [Mis tareas](/ayuda/actividades-y-agenda)) y **consultar la agenda** de
  turnos. Si le pedís una tarea y no dice a qué contacto u oportunidad va,
  te lo pregunta antes de crearla.
- Si un mensaje no se pudo enviar, el sistema te lo dice en el hilo y el
  texto vuelve a la caja para que lo reintentes.
- Si un administrador te saca el acceso mientras tenés el chat abierto, la
  próxima acción muestra un aviso.

> Lo que le pedís al agente interno pasa de verdad: una tarea que le pedís
> queda creada en el CRM. Está pensado para usar también desde el celular.

## Ayuda {#ayuda}

Esta guía está dentro de la app. Hay dos formas de llegar:

- **Ayuda** en el menú: abre la guía completa, con el índice de secciones
  (Primeros pasos, Contactos y consultas, Conversaciones, etc.).
- El ícono **?** de cada pantalla: abre la guía directamente en la parte que
  explica esa pantalla, para no tener que buscarla.

Arriba de la guía hay un buscador: busca sobre los **títulos** de las
secciones y de los temas (por ejemplo, "horario" te lleva a "Horario de
atención"), no sobre el texto completo. Los links dentro de la guía llevan
a otras secciones o a la pantalla de la app que corresponde.

Cuando la guía dice "solo un administrador puede…", es porque esa pantalla
o esa acción no está disponible para un usuario: no la vas a encontrar en
tu menú.
