# Guion: mostrar el Taller Demo

Cómo mostrarle el producto a una concesionaria o a un taller en una reunión de
**unos 12 minutos**, sobre el **Taller Demo** (`docs/taller-demo.md`). Son
cinco momentos de unos dos minutos, pensados para vender: primero el dolor,
después cómo se resuelve. Lo que no entra va en [Si preguntan…](#si-preguntan).

Por qué 12 y no 10 (medido en dos ensayos, el 2026-10-17): el agente tarda
**10 a 22 segundos** por respuesta (unos 50 s en el momento 3) y algunas
pantallas tardan unos segundos en cargar. Las esperas suman cerca de 2
minutos: usalas para hablar.

Todo lo que se ve es inventado y la demo está en **modo demo**: los mensajes
se simulan y nada sale de la plataforma, así que se puede tocar todo sin miedo.

## Antes de la reunión (10 minutos)

1. **Reiniciar la demo** el mismo día de la reunión. Plataforma →
   Organizaciones → en la fila del Taller Demo, **Reiniciar datos de demo**
   (solo un platform admin). Tarda **unos 3 minutos**. Deja todo como recién
   creado, con fechas de hoy.
2. **Entrar al menos 2 minutos antes** como la administradora (Valentina
   Rodríguez) y dejar que cargue el **Dashboard**: la primera carga tarda unos
   5 segundos. Después de eso, el Resumen del taller del momento 1 aparece al
   instante. Si se quiere mostrar el menú de un vendedor, el vendedor (Martín
   Pereira) en una ventana privada aparte.
3. **Probar el agente una vez** (Agentes de IA → Asistente de ventas → **Probar
   agente**, con la contacta **Sofía Ramos**). Si no contesta, en el momento 3
   se usa el plan B. La prueba deja una conversación y una oportunidad: no
   molesta, pero si querés llegar limpio, reiniciá después.
4. Tener a mano qué decir del **aviso fijo de arriba** ("Modo demo: los
   mensajes se simulan…"): "esto es una demo; en tu cuenta los mensajes salen
   por tu WhatsApp".

## Los cinco momentos

### 1. El dolor: la plata que hoy se pierde

- **Pantalla:** Taller → **Resumen** ("Resumen del taller"). Señalar **Services vencidos**,
  **Services en los próximos 30 días**, **Recambios en los próximos 90 días** y
  **Recambios vencidos sin contactar**.
- **Antes de mostrar, preguntar:** *"¿Cuántos clientes que compraron un auto
  con ustedes vuelven a hacer el service acá?"*
- **Frase:** *"Cada uno de estos es un cliente que ya te compró y que hoy nadie
  llama. Esto es plata que hoy se pierde."*
- **Dolor que resuelve:** el cliente que compró y no vuelve, ni al taller ni a
  cambiar el auto, porque nadie lleva la cuenta de cuándo le toca.

### 2. Cómo se recupera: el sistema se acuerda por vos

- **Pantallas:**
  - **Automatizaciones** → **Recordatorio de próximo service**: *"siete días
    antes, le llega un WhatsApp al cliente; si no tiene WhatsApp, le queda la
    tarea a alguien para llamarlo"*. Para mostrar uno ya enviado:
    **Conversaciones** → **Jorge Méndez**, con el recordatorio del service de
    su Clio (marcado **Automatización · Simulado**) y su respuesta.
  - Taller → **Vehículos de clientes**: los autos de cada cliente, con su
    próximo service. Los que vienen de una venta dicen **Origen: Vendido por
    nosotros** en su ficha: *"vendiste el auto y el taller ya lo tiene
    cargado"*.
  - Taller → **Recambios** ("Recambios vencidos sin contactar"): los que compraron hace
    cuatro años. Seleccionar uno y tocar **Crear tarea al vendedor**.
- **Frase:** *"Nadie tiene que acordarse: el sistema le avisa al cliente cuando
  le toca el service y, a los cuatro años, le deja la tarea al vendedor para
  ofrecerle cambiar el auto."*
- **Dolor que resuelve:** depender de la memoria o de una planilla para volver
  a contactar al cliente; el recambio que se va a otra concesionaria.

### 3. El agente atendiendo, en vivo

- **Pantalla:** Agentes de IA → Asistente de ventas → **Probar agente**, con la
  contacta **Sofía Ramos**. Mandar, en orden (cada respuesta tarda 10 a 22
  segundos: aprovechá para contar qué está haciendo):
  1. *"Hola, busco un auto chico para la ciudad, hasta 15 mil dólares"* →
     saluda a Sofía y ofrece los hatchbacks del stock con precio y km (el
     **Renault Kwid** a USD 9.800 y el **Volkswagen Gol** a 11.500); guarda el
     presupuesto en la ficha.
  2. *"Me interesa el Kwid. ¿Puedo ir a probarlo el lunes a las 10?"* →
     **registra la oportunidad** del Kwid, consulta la agenda y ofrece un
     turno de **Prueba de manejo** con día y hora concretos. Pedí día **y**
     hora: en un ensayo, con solo el día ("¿puedo verlo el sábado?"), dejó la
     visita para un vendedor.
  3. *"Sí, perfecto, reservame ese horario."* → **reserva el turno** y lo
     confirma. Queda en **Reservas**, vinculado a la oportunidad.
  4. *"¿Y tienen taller para hacerle el service después?"* → contesta con la
     base de conocimiento: dirección, horarios y precios de referencia del
     taller.

  Si en el probador se ven abiertos los detalles técnicos de cada acción
  (argumentos y resultados en JSON), no te detengas ahí: pasá a
  **Conversaciones** → **Sofía Ramos**: *"esto es lo que ve el vendedor, con
  todo lo que se habló"*.
- **Frase:** *"Contesta a las 11 de la noche y un domingo, con tu stock y tus
  precios, y te deja el cliente listo para que lo llame un vendedor."*
- **Dolor que resuelve:** las consultas por WhatsApp e Instagram que se
  contestan tarde, o nunca, fuera de horario o con el vendedor ocupado.
- **Plan B** si el agente no responde (servicio de IA caído o sin saldo): abrir
  en **Conversaciones** la de **WhatsApp** de Lucía Fernández (el Onix), que ya
  muestra al agente buscando en el stock, ofreciendo la prueba de manejo y
  dejando la oportunidad creada, y contar lo mismo.

### 4. Del mensaje a la venta

- **Pantallas:**
  - **Oportunidades** → **Vista de embudo**: la que creó el agente en el
    momento 3 (la del Kwid; el título lo elige el agente, por ejemplo "Test
    drive Kwid Zen 1.0 — Renault Kwid…") está en **Nuevo**, asignada a
    **Martín Pereira**, el vendedor. Arrastrarla a **Contactado**, la columna
    de al lado (con una pantalla angosta, las columnas lejanas piden
    deslizar el tablero). Si no se usó el agente, la del Onix ya está en
    **Prueba de manejo**.
  - Abrir la oportunidad: contacto, unidad vinculada, monto.
  - **Stock**: *"lo que está publicado lo conoce el agente; si cambiás un
    precio, el agente lo sabe"*. Mostrar la Ranger **a consultar** (el agente
    no inventa el precio).
- **Frase:** *"El mensaje no se pierde en el celular de un vendedor: queda como
  una oportunidad, con el auto que le interesa, y la ves avanzar hasta la
  venta."*
- **Dolor que resuelve:** no saber qué pasó con cada consulta ni qué vendedor
  la tiene; el stock desactualizado en la cabeza de cada uno.

### 5. Cierre: lo que ve la gerencia cada mañana

- **Pantalla:** **Dashboard**. Unidades en stock y disponibles, el taller
  (autos adentro, listos, esperando aprobación), oportunidades creadas este
  mes contra el mes pasado, lo ganado y la tasa de cierre, ingresos por mes,
  las mayores oportunidades abiertas y el proceso de venta por etapa. Cambiar
  a **Semanal**: hay una venta ganada esta semana.
- **Frase:** *"Esto es lo que ve la gerencia cada mañana: cuánto hay en juego,
  cuánto se cerró y qué quedó sin hacer."*
- **Dolor que resuelve:** enterarse a fin de mes de cómo fue el mes, o
  armarlo a mano en una planilla.

## Cierre de la reunión

**Preguntas para hacer al final** (elegir dos o tres):

- *"De lo que vieron, ¿qué es lo que más les resolvería hoy?"*
- *"¿Cuántos vendedores y cuántos técnicos tienen?"*
- *"¿Con qué atienden hoy WhatsApp: un celular, varios, alguna herramienta?"*

**Próximo paso propuesto:** *"Hagamos una prueba con sus datos reales:
cargamos su stock y sus clientes, y en una semana lo ven funcionando con su
propio WhatsApp."*

## Si preguntan… {#si-preguntan}

Lo que no entra en los 10 minutos, para mostrar solo si sale la pregunta.

- **Órdenes y aprobaciones.** Taller → **Órdenes**: la vista arranca en
  **Lista**; elegí **Tablero** en **Vista**. Mover una orden de **Recibido** a
  **En trabajo** (pide confirmar); abrir la OS-0007, que espera aprobación
  ("Pastillas y discos de freno"), y **Registrar aprobación**: lo consultado
  hay que escribirlo, y con "Sumar al valor de la orden" el valor sube solo.
  Al entregar, la orden fija el próximo service del vehículo.
- **Avisar al cliente.** La OS-0009, lista para retirar (el Ford Fiesta de
  Nicolás Pereyra), ya está avisada: en la orden, **Avisos al cliente**; en
  **Conversaciones** → **Nicolás Pereyra**, el mensaje del encargado del
  taller, **Simulado**. Si tocás **Avisar al cliente**, la demo no puede
  mandar un WhatsApp nuevo (no tiene número): ofrece copiar el texto, llamar
  o **Marcar como avisado**.
- **Contactos.** Abrir uno: la ficha tiene sus datos, el canal de origen, los
  campos propios ("Auto actual", "Forma de pago") y sus vehículos del taller.
- **El menú de un vendedor** (la otra ventana): un vendedor ve un menú más
  corto, sin la configuración; trabaja contactos, oportunidades y tareas.
- **Las automatizaciones restantes.** **Venta ganada → tarea de
  agradecimiento** (dos días después de ganar una venta) y **Se acerca el
  recambio → tarea al vendedor**. La de **reseña por QR tras la venta** está
  apagada: se explica, no se muestra.
- **Otras conversaciones.** La de **Instagram** (precio de la Ranger, "a
  consultar") y la de **Messenger** (turno de taller: el agente deriva al
  encargado y la conversación queda transferida).

## Después de la reunión

- No hace falta borrar nada: el próximo **Reiniciar datos de demo** deja la
  demo como nueva, incluidos los contactos y las oportunidades que se hayan
  agregado en la reunión.
- Los barridos del taller siguen corriendo sobre la demo (recordatorios,
  recambios): crean avisos y tareas simulados. Es normal.

## Lo que la demo no muestra

- **WhatsApp, Messenger o Instagram reales.** La demo no tiene número ni
  página: el agente se muestra con el probador.
- **Google Calendar.** En modo demo no se puede conectar.
- **Invitar usuarios.** En modo demo solo un platform admin puede invitar.
- **Importar datos, cupones, cotizaciones y pagos**: existen en el producto,
  pero la demo no trae datos de ejemplo de eso.
