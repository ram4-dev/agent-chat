# Correcciones S7-F1, S7-F2 y S7-F3

Continuación de la revisión r1 en el worktree registrado /Users/ramiro/Desktop/projects/agent_chat.feat-native-notification-status, rama feat/native-notification-status, fuente dd57fbab87851847ba94c58e1ac229fed3494bc7. El worktree estaba limpio y se conserva para revisión. No se modifica el checkout fuente ni main.

## Correcciones

S7-F1: el vencimiento se calcula desde completed_at para toda entrega done, independientemente del hash o cuerpo de resultado. La vista oculta entrada y salida al superar siete días aunque no haya corrido el mantenimiento; conserva recibo y referencias. La regresión suprime un claim antes del inicio y comprueba visibilidad inicial y ocultamiento a ocho días, antes y después de retención.

S7-F2: la siguiente consulta se agenda tres segundos después de terminar la anterior. El timeout de ocho segundos produce un error visible y retira el estado anterior. Durante una consulta aparece Actualizando estado nativo, sin presentar el contacto anterior como una comprobación actual. El desmontaje o cambio de grupo cancela la consulta y los timers. El E2E demora cuatro segundos la respuesta y exige una sola consulta y carga completada; luego retiene otra respuesta, comprueba timeout/reintento y recuperación.

S7-F3: el resumen conserva el estado del turno pendiente y muestra la pausa por separado. Cada entrega distingue inicio incierto, procesamiento y cancelación pendientes. Tres casos unitarios verifican pausa concurrente; el navegador también representa esos tres estados mediante respuestas sintéticas de la vista, sin ejecutar ni activar un proveedor.

Los cambios no modifican claims, publicación, autoridad, OAuth ni retención de los mensajes históricos originales. No se accede a ~/.hermes ni se envían mensajes reales.

## Validación

Lint, typecheck y build PASS.165 unitarios,15 contratos y205 integración PASS. E2E completo:27 PASS en1.2min. Total412 PASS. Servidor Node22.23.3 mediante Portless agent-chat-native-status y DB nueva .local-state/native-status-fixes.db. Se conservan los seis skips explícitos: cinco requieren Hermes instalado y uno inferencia Codex real. Hashes03/04r2 sin cambios; git diff --check PASS.

Revisión independiente de las correcciones pendiente. No se declara cierre global del plan ni aceptación real de adaptadores.
