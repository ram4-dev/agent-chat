# Correcciones S4-F1/F2

Snapshot previo8f093d2; rama feat/native-agent-bindings y worktree existente autorizado por08. Dictamen r1 recibido y registrado en19. No se altera diseño03/outline04 ni se modifica producción.

## S4-F1: autor nativo

Cliente y fingerprint usan el campo HTTP author, que Hermes original normaliza y pasa internamente como turn_author. El JSON de texto sigue siendo dato no confiable y no sustituye esa atribución. La prueba HTTP exige únicamente author/input/session_id, sin sobrescribir configuración nativa.

El fixture observa agent._turn_author y agent.session_id de los AIAgent originales en el momento de la petición al proveedor falso. No reemplaza métodos ni intercepta run_conversation. El E2E obtiene IDs desde las sesiones humanas de Agent Chat y exige que cada uno llegue al agente correcto, que sean distintos y compartan sesión, también tras reiniciar el gateway/controlador. La recuperación con almacén B vacío sigue sin generar otra completion.

Los journals del prototipo no publicado con el campo anterior conservan su fingerprint y requieren reconciliación explícita. No hay migración que regenere/reenvíe una creación antigua con otro cuerpo. No se activaron profiles personales con ese prototipo.

## S4-F2: purga continua

Mantenimiento cada hora, además de los puntos existentes. El timer usa unref y se cancela explícitamente en close antes de cerrar SQLite. Un fallo de mantenimiento emite un error sin contenido privado y se vuelve a intentar en el ciclo siguiente.

La regresión mantiene vivo el mismo runtime, confirma un resultado, conserva otra copia pendiente, avanza ocho días con Date/intervalos controlados y comprueba SQLite directamente: cuerpo/evidencia confirmados ausentes; pendiente presente; ambas claves/tombstones conservadas. El cierre deja cero timers. No se altera el temporizador HTTP ni se simulan respuestas mediante mocks globales. El plazo es siete días más la cadencia horaria, incluso sin nuevas entregas.

## Evidencia

Lint/typecheck/build y regresión de integración enfocada PASS. Suite unit153, contratos15, integración193 PASS. E2E reforzado de producto PASS32.2s; suite E2E completa30 PASS en2.2min, un skip legacy real por opt-in. Total391 PASS; revisión independiente de cierre pendiente. DB nueva native-s4-r2-verification.db y Portless agent-chat-native-s4-r2-check. Hermes original d923a5eb487a17c0a68801bba9ef0f56c81040a8, proveedor falso, perfiles y managed scope temporales. Aceptación personal, S0 global, Grok y Codex siguen pendientes; sin push/PR.
