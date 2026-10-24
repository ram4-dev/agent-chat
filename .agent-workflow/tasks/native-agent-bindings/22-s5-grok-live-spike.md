# S5: bot nuevo y comprobación de identidad

Fecha2026-10-24. El usuario pidió probar Grok Bot creando un bot nuevo y autorizó expresamente AppleScript para activar la app y abrir Nuevo chat, porque CUA devolvía noWindowsAvailable y no podía intervenir personalmente. No se cambiaron bots, rutinas ni conexiones existentes.

## Resultado observado

La app mostró Crear nuevo Bot. Se creó Agent Chat Test con avatar azul y se verificó la conversación nueva y su saludo. Después CUA expuso el árbol accesible completo y permitió escribir e inspeccionar la respuesta. AppleScript terminó con timeout de respuesta AppleEvent(-1712); las acciones posteriores y la creación se verificaron en la UI, sin atribuir éxito al exit code de ese comando.

Se indicó al bot su rol de prueba en español, y una primera comprobación limitada a catálogo: sin leer mensajes/historiales, enviar, ACK, cambiar permisos, usar otras apps o crear rutinas. El bot informó conector agent-chat listo y siete herramientas legacy: get_agent_instructions, get_identity, get_inbox, ack_inbox, list_groups, read_messages, send_message.

Segunda comprobación autorizada: únicamente get_identity, sin las demás herramientas. El bot informó identidad Agent Chat grokbot, agente f91586ec-7d8e-4f2a-b35d-f4361f14ce4c, activo, scopes agent:read,agent:send,agent:inbox,agent:receive. Se verificó esa respuesta en su conversación; no se capturaron credenciales ni datos del dueño. Es evidencia del bot usando el conector existente, no un test independiente de transporte ni prueba de grant nativo.

La identidad reportada sigue siendo grokbot. No se creó ni emparejó todavía una identidad dedicada de Agent Chat para el bot nuevo. La diferencia entre IDs internos de Grok y Agent Chat no prueba por sí sola que un vínculo sea incorrecto: son dominios distintos. El dato operativo es la identidad/scopes efectivamente reportados; no asumir aislamiento por crear un bot.

## Pendientes

Implementar/verificar S5: vinculación nativa dedicada, rutina webhook del bot nuevo, devolución autenticada y recibo durable, y ruta alcanzable desde su nube. Primero debe resolverse el alcance por bot de la conexión, preservando la conexión y el receptor anteriores. No se creó ninguna rutina periódica ni webhook ni se publicó/ACK un mensaje desde el bot nuevo durante esta comprobación.

Documentación oficial reconsultada: https://docs.x.ai/grok-bot/bots y https://cursor.com/help/grok-bot/routines. La rutina webhook puede aceptar el disparo sin haber terminado el trabajo; un200 no sustituye un callback/recibo. No inferir disponibilidad24/7 ni conectividad cloud desde agent-chat.localhost. S4 cerrado por revisión independiente; aceptación personal Hermes y Codex siguen pendientes.

Sin cambios de código, tests o configuración de servicios, sin push/PR. Verificación de este incremento: inspección UI de creación y respuesta, lectura de documentos oficiales y git diff --check. Los391 PASS previos corresponden al incremento Hermes y no acreditan S5.
