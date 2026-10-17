# Guion: mostrar el Taller Demo

Cómo mostrarle el producto a una concesionaria o a un taller en una reunión de
10 a 20 minutos, sobre el **Taller Demo** (`docs/taller-demo.md`). Todo lo que
se ve es inventado y la demo está en **modo demo**: los mensajes se simulan y
nada sale de la plataforma, así que se puede tocar todo sin miedo.

## Antes de la reunión (5 minutos)

1. **Reiniciar la demo.** Plataforma → Organizaciones → en la fila del Taller
   Demo, **Reiniciar datos de demo** (solo un platform admin). Tarda unos tres
   minutos: hacelo antes de entrar a la reunión. Deja todo como recién creado, con fechas de hoy: el Dashboard
   del mes, las órdenes del día, los turnos de la semana que viene.
2. **Entrar como la administradora** (Valentina Rodríguez) en una pestaña. Si
   se quiere mostrar el menú corto de un vendedor, el vendedor (Martín Pereira)
   en otra ventana privada.
3. **Probar el agente una vez** (Agentes de IA → Asistente de ventas →
   **Probar agente**, con el contacto **Visitante Web**): si no contesta, usar el plan
   B del paso 7.
4. Tener a mano qué decir del **aviso fijo de arriba** ("Modo demo: los
   mensajes se simulan…"): "esto es una demo; en tu cuenta los mensajes salen
   por tu WhatsApp".

## Orden de pantallas y qué decir

1. **Dashboard.** "Lo que ve la gerencia a la mañana." Seis oportunidades
   abiertas por unos USD 98.000, siete creadas este mes contra cinco el pasado,
   dos ventas ganadas este mes, las tareas vencidas. Cambiar el período a la
   semana para mostrar la serie de ingresos.
2. **Conversaciones.** Abrir la de **WhatsApp** (Lucía Fernández, el Onix):
   "el asistente busca en el stock, contesta con precio y km, ofrece la prueba
   de manejo y deja la oportunidad creada; después entra un vendedor a
   confirmar". Después la de
   **Messenger** (turno de taller): "cuando el tema es del taller, el asistente
   deriva al encargado y la conversación queda transferida". Los salientes
   dicen **Simulado**.
3. **Oportunidades.** El proceso **Venta de autos** (Nuevo → Contactado →
   Prueba de manejo → Negociación → Ganada / Perdida). Arrastrar una tarjeta
   de etapa. Abrir la del Onix: contacto, unidad vinculada (reservada), tareas.
4. **Stock.** Diez unidades, una reservada y dos vendidas. "Lo que está
   publicado lo conoce el asistente: si cambiás un precio, el asistente lo
   sabe." Mostrar la Ranger **a consultar** y el Swift publicado **solo en
   pesos**.
5. **Contactos.** Abrir uno: canal de origen, campos propios ("Auto actual",
   "Forma de pago"), conversaciones, oportunidades y sus vehículos.
6. **Taller.**
   - **Resumen del taller**: seis autos en el taller, uno listo para retirar, uno
     esperando aprobación hace más de un día, services vencidos y por vencer,
     un turno cancelado, recambios.
   - **Órdenes** (tablero): mover una orden de **Recibido** a **En trabajo**;
     abrir la que espera aprobación ("Pastillas y discos de freno") y
     **Registrar aprobación** del cliente; abrir la **lista para retirar** y
     mostrar **Avisar al cliente**.
   - **Vehículos de clientes**: los que vienen de una venta ganada traen la
     oportunidad de origen; el próximo service se fija al entregar la orden.
   - **Recambios**: "clientes que compraron hace cuatro años: el sistema le
     deja la tarea al vendedor para ofrecerle cambiar el auto".
7. **El asistente en vivo** (Agentes de IA → Asistente de ventas →
   **Probar agente**, contacto **Visitante Web**). Mensajes sugeridos, en orden:
   - *"Hola, busco un auto chico para la ciudad, hasta 15 mil dólares"* →
     ofrece unidades del stock con precio y propone prueba de manejo.
   - *"Me interesa el Kwid, ¿puedo verlo el sábado?"* → registra la
     oportunidad y propone horario.
   - *"¿Y tienen taller para hacerle el service después?"* → contesta con la
     base de conocimiento (horarios, qué incluye el service).

   Después abrir **Conversaciones**: "esto es lo que ve el vendedor".

   **Plan B** si el asistente no responde (servicio de IA caído o sin
   saldo): volver a la conversación de WhatsApp del paso 2, que ya muestra al
   asistente buscando stock y creando la oportunidad, y contar lo mismo.
8. **Automatizaciones.** "Recordatorio de próximo service por WhatsApp siete
   días antes, tarea al vendedor cuando se acerca el recambio, tarea de
   agradecimiento cuando se gana una venta." La de **reseña por QR** está
   apagada: se explica, no se muestra.
9. **Menú de un vendedor** (opcional, la otra ventana): "un vendedor ve un menú
   más corto: trabaja contactos, oportunidades y tareas, sin la configuración".

## Después de la reunión

- No hace falta borrar nada: el próximo **Reiniciar datos de demo** deja la
  demo como nueva, incluidos los contactos y las oportunidades que se hayan
  agregado en la reunión.
- Los barridos del taller siguen corriendo sobre la demo (recordatorios,
  recambios): crean avisos y tareas simulados. Es normal.

## Lo que la demo no muestra

- **WhatsApp, Messenger o Instagram reales.** La demo no tiene número ni
  página: el asistente se muestra con el probador.
- **Google Calendar.** En modo demo no se puede conectar.
- **Invitar usuarios.** En modo demo solo un platform admin puede invitar.
- **Importar datos, cupones, cotizaciones y pagos**: existen en el producto,
  pero la demo no trae datos de ejemplo de eso.
