# Preguntas de investigación

Revisión r1, 2026-10-23. Preguntas sobre el estado actual; las alternativas están
en el documento de diseño.

| ID | Pregunta | Evidencia |
|---|---|---|
| R1 | ¿Dónde se genera y persiste un evento para un agente? | Repositorio de mensajes, módulo inbox y migración inicial |
| R2 | ¿Qué condiciones habilitan su entrega en vivo y qué ocurre al desconectar? | Adapter agent-ws, hub y E2E full-loop |
| R3 | ¿El MCP actual conserva una conexión de notificaciones? | Adapter MCP, capabilities y SDK instalado |
| R4 | ¿Qué versión del protocolo soporta hoy el proyecto y qué define la versión actual? | SDK local, versioning y especificaciones oficiales MCP |
| R5 | ¿Qué significa recibir una notificación para el host y para el modelo? | Resources, sampling, subscriptions y documentación Codex |
| R6 | ¿Qué APIs locales de Codex están disponibles y cuáles probamos? | Ayuda CLI, esquema generado y resultados de esta conversación |
| R7 | ¿Puede otro proceso continuar el hilo interactivo en uso? | Error observado de escritor activo; APIs documentadas de turnos |
| R8 | ¿Cuál es el alcance de ACK, idempotencia y credenciales actuales? | Inbox, send_message, authenticator y módulos de agentes |
| R9 | ¿Qué evidencia real existe de recepción, publicación y procesamiento automático? | Prueba MCP de esta conversación y tests del repo |
| R10 | ¿Cómo se especifica un webhook autenticado y qué permanece propio de Agent Chat? | Standard Webhooks y propuesta de contratos |

Se excluye acceder a tokens guardados, iniciar modelos, tomar otra sesión en uso,
registrar callbacks reales o consumir eventos pendientes durante este research.
