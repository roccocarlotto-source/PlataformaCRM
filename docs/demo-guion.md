# Guion: mostrar el Taller Demo

Cómo mostrarle el producto a una concesionaria o a un taller en una reunión de
**10 minutos**, sobre el **Taller Demo** (`docs/taller-demo.md`). Son cinco
momentos de unos dos minutos, pensados para vender: primero el dolor, después
cómo se resuelve. Lo que no entra va en [Si preguntan…](#si-preguntan).

Todo lo que se ve es inventado y la demo está en **modo demo**: los mensajes
se simulan y nada sale de la plataforma, así que se puede tocar todo sin miedo.

## Antes de la reunión (5 minutos)

1. **Reiniciar la demo.** Plataforma → Organizaciones → en la fila del Taller
   Demo, **Reiniciar datos de demo** (solo un platform admin). Tarda unos tres
   minutos: hacelo antes de entrar a la reunión. Deja todo como recién creado,
   con fechas de hoy.
2. **Entrar como la administradora** (Valentina Rodríguez). Si se quiere
   mostrar el menú de un vendedor, el vendedor (Martín Pereira) en una ventana
   privada aparte.
3. **Probar el agente una vez** (Agentes de IA → Asistente de ventas → **Probar
   agente**, con el contacto **Visitante Web**). Si no contesta, en el momento
   3 se usa el plan B.
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
    tarea a alguien para llamarlo"*.
  - Taller → **Vehículos de clientes**: los autos de cada cliente, con su
    próximo service. Los que vienen de una venta traen la oportunidad de
    origen: *"vendiste el auto y el taller ya lo tiene cargado"*.
  - Taller → **Recambios** ("Recambios vencidos sin contactar"): los que compraron hace
    cuatro años. Seleccionar uno y tocar **Crear tarea al vendedor**.
- **Frase:** *"Nadie tiene que acordarse: el sistema le avisa al cliente cuando
  le toca el service y, a los cuatro años, le deja la tarea al vendedor para
  ofrecerle cambiar el auto."*
- **Dolor que resuelve:** depender de la memoria o de una planilla para volver
  a contactar al cliente; el recambio que se va a otra concesionaria.

### 3. El agente atendiendo, en vivo

- **Pantalla:** Agentes de IA → Asistente de ventas → **Probar agente**, con el
  contacto **Visitante Web**. Mandar, en orden:
  1. *"Hola, busco un auto chico para la ciudad, hasta 15 mil dólares"* →
     ofrece unidades del stock con precio y km (hay un **Renault Kwid** a USD
     9.800, un **Volkswagen Gol** a 11.500 y un **Fiat Cronos** a 14.900) y
     propone una prueba de manejo.
  2. *"Me interesa el Kwid, ¿puedo verlo el sábado?"* → registra la
     oportunidad y propone horario (el Kwid está en Casa Central, que abre los
     sábados de 9 a 13).
  3. *"¿Y tienen taller para hacerle el service después?"* → contesta con la
     base de conocimiento: horarios del taller y qué incluye el service de
     10.000 km.

  Después abrir **Conversaciones** → la conversación del Visitante Web: *"esto
  es lo que ve el vendedor, con todo lo que se habló"*.
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
  - **Oportunidades** → **Vista de embudo**: la oportunidad que quedó creada
    en el momento 3 (o la del Onix), en su etapa. Arrastrarla a **Prueba de
    manejo**.
  - Abrir la oportunidad: contacto, unidad vinculada, tareas.
  - **Stock**: *"lo que está publicado lo conoce el agente; si cambiás un
    precio, el agente lo sabe"*. Mostrar la Ranger **a consultar** (el agente
    no inventa el precio).
- **Frase:** *"El mensaje no se pierde en el celular de un vendedor: queda como
  una oportunidad, con el auto que le interesa, y la ves avanzar hasta la
  venta."*
- **Dolor que resuelve:** no saber qué pasó con cada consulta ni qué vendedor
  la tiene; el stock desactualizado en la cabeza de cada uno.

### 5. Cierre: lo que ve la gerencia cada mañana

- **Pantalla:** **Dashboard**. Oportunidades abiertas (unos USD 98.000),
  creadas este mes contra el mes pasado, ventas ganadas, tasa de cierre, tareas
  vencidas. Cambiar a **Semanal** para la serie de ingresos.
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

- **Órdenes y aprobaciones.** Taller → **Órdenes** en **Tablero**: mover una
  orden de **Recibido** a **En trabajo**; abrir la que espera aprobación
  ("Pastillas y discos de freno") y **Registrar aprobación** del cliente; abrir
  la **lista para retirar** y mostrar **Avisar al cliente**. Al entregar, la
  orden fija el próximo service del vehículo.
- **Contactos.** Abrir uno: canal de origen, campos propios ("Auto actual",
  "Forma de pago"), conversaciones, oportunidades y sus vehículos.
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
