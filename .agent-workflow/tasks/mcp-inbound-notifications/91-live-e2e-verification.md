# Recepción automática local: implementación y prueba real

Fecha: 2026-10-23. Rama: feat/mcp-inbound-e2e.
Base: 91794f3, desde feat/mcp-inbound-notifications. Worktrunk y autorización en
10-live-e2e-receipt.md. Sin push ni PR; worktrees anteriores preservados.

## Resultado

Receptor local con gpt-6.1-sol, un hilo por agente/grupo, respuestas automáticas y
opción no_reply. El servidor mantiene reservas, autorización de inicio de un uso,
salida inmutable y recibos. Publicación y ACK se confirman en la misma transacción.
El supervisor reinicia el control plane; el estado se conserva. La UI permite
activar/pausar e inspeccionar resultados, hilos y errores desde Mis agentes.

Transporte: espera MCP despertada por hub (máximo 10 s), más reconciliación del
inbox. No se extrajeron tokens de Codex. El modelo está separado de las llamadas
MCP y antes de activar exige preflight local con cero herramientas en start/resume.
La prueba del preflight usa respuestas falsas locales y no consume inferencia.

## Suite final

Comando: `AGENT_CHAT_REAL_CODEX=1 pnpm verify`, con Node 22 en PATH.
Resultado: EXIT 0. Log local /tmp/agent-chat-live-close-final-verify.log.

| Validación | Resultado |
|---|---|
| lint | PASS |
| typecheck, incluido bridge y tests | PASS |
| build de todos los paquetes | PASS |
| unit | 147 PASS, 11 archivos |
| contracts | 15 PASS, 2 archivos |
| integration | 142 PASS, 16 archivos |
| E2E Chromium | 22 PASS, 33.2 s; incluye el modelo real, sin skips |
| Total | 326 tests PASS |
| git diff --check | PASS |

Los E2E normales no consumen modelo: el caso real requiere AGENT_CHAT_REAL_CODEX=1.
Aquí sí se habilitó y se ejecutó, además de corridas previas con navegador visible.
No se cuentan workers falsos como prueba de inferencia real.

## Recorrido con navegador y ejecutable reales

1. Registro humano, OAuth con SDK oficial y consentimiento de agente Scout.
2. Crear Codex real y Codex separado; agregar el mismo agente a ambos.
3. Lanzar **supervisor.js -> main.js -> CodexControl** como subprocess real,
   con estado local persistente y token de test obtenido por OAuth en memoria.
   No se llama processNext manualmente en este E2E. La credencial no se imprime.
4. Mensaje desde navegador: recordar AZUL-427. Aparece la respuesta generada por
   Codex y el evento queda confirmado.
5. Matar el PID real de App Server. Enviar el siguiente mensaje **antes** de que
   el nuevo controlador esté listo. El supervisor reinicia, procesa el pendiente,
   recuerda AZUL-427 y mantiene el mismo threadId.
6. Enviar a Codex separado: respuesta real y threadId diferente.
7. Abrir actividad de Codex: respuestas publicadas y continuidad observables.
8. Caso determinista adicional: pausar desde UI y comprobar estado/actividad.

Capturas guardadas en docs/evidence/automatic-replies:

- [real-codex-01-group.png](../../../docs/evidence/automatic-replies/real-codex-01-group.png): grupo y receptor preparado.
- [real-codex-02-incoming.png](../../../docs/evidence/automatic-replies/real-codex-02-incoming.png): mensaje humano.
- [real-codex-03-answer.png](../../../docs/evidence/automatic-replies/real-codex-03-answer.png): primera respuesta real.
- [real-codex-04-context.png](../../../docs/evidence/automatic-replies/real-codex-04-context.png): respuesta posterior al reinicio en el mismo hilo.
- [real-codex-05-activity.png](../../../docs/evidence/automatic-replies/real-codex-05-activity.png): visor de actividad.
- [real-codex-06-separated-group.png](../../../docs/evidence/automatic-replies/real-codex-06-separated-group.png): otro grupo, hilo separado.

## Fallos encontrados y corregidos

- Origen público de OAuth no coincidía con HTTPS detrás del proxy: fijar
  PUBLIC_ORIGIN al origen exacto del test/servicio, sin modificar el proxy global.
- Owner pause podía revertirse con credencial de agente: configuración MCP solo
  inicializa; una configuración existente solo cambia mediante sesión del dueño.
- Recuperación devolvía contenido revocado: revalidar membresía y devolver bloqueo
  global sin contenido cuando el grupo ya no está autorizado.
- Conexión revocada quedaba fijada: recovery del dueño permite reemplazo de grant
  revocada, rota claims pendientes y mantiene running/needs_review bloqueados.
- Grupo retirado frenaba los restantes: filtrar tanto en arranque como en polling.
- Control plane muerto se reutilizaba: exit con error y reinicio supervisado.
- Cobertura por agente se confundía con cobertura por grupo: heartbeat por binding.
- Lock PID incompleto bloqueaba reinicios: flock de kernel con helper Python y
  liberación al cerrar stdin/morir el proceso. Hay regresión de exclusión y reapertura.
- UI decía publicado sin messageId: distinguir confirmado sin publicación.
- Recovery admitía identificador no UUID: mismo validador que MCP; 400 sin mutación.
- Long poll del proceso muerto tomaba el siguiente evento: controller epoch invalida
  solicitudes anteriores; cierre HTTP propaga abort al SDK; handler comprueba la
  cancelación antes de claim y tras espera. Regresión HTTP real con socket cerrado.
- Reserva sin modelo confundida con inicio consumido: started=0 recuperable;
  runtime_begin valida epoch/pausa/ACK y consume una sola autorización. Inicio
  incierto consumido no se repite. Regresiones de ticket y reserva huérfana.
- SIGTERM podía iniciar modelo al despertar: señal de apagado propagada y chequeada
  tras wait/context/begin; prueba exige cero llamadas a worker.run.
- Arranque de servicios desde Desktop no quedó listo: desplegar artefactos y
  dependencias fuera del checkout, en Application Support. Al mover el estado fue
  necesario conservar instanceId: el instalador ahora copia la identidad existente
  junto con la base inicial. No se forzó un claim ni se borraron jobs ambiguos.

## Revisión independiente

Todas las rondas con Codex gpt-6.1-sol, reasoningEffort high, serviceTier default,
solo lectura. IDs de task (prefijo común node:delegated-task:command%3Amcp%3A1bd8506e-58f0-4b1b-8ef4-39ee3ce5c936%3Adelegate-task%3A):

- mcp-inbound-live-review-20261023: 8 hallazgos, corregidos.
- mcp-inbound-live-review-r2-20261023: arranque/UUID y falta de prueba de entrypoint;
  corregidos y probado supervisor real con caída de control.
- mcp-inbound-live-review-r3-20261023: cancelación y SIGTERM; corregidos con regresiones.
- mcp-inbound-live-review-r4-20261023: sin defectos nuevos concretos; ambos hallazgos
  de cancelación/apagado cerrados. No atribuye ejecución de suite al revisor.

## Entorno dejado funcionando

UI/API: https://agent-chat.localhost
Grupo habilitado: prueba, 01a168db-a911-7d62-ac72-a7a92ee65710.
Agente existente: test, 01a168db-d187-7cc0-a671-b2acf4db41c1.

LaunchAgents de usuario instalados y observados running:
local.agent-chat.server y local.agent-chat.receiver. No dependen de una terminal
ni del proceso de esta tarea. Receptor ready, heartbeat del grupo menor a 15 s,
inbox pendiente 0 y liveness HTTP 200. No había mensajes pendientes nuevos en ese
grupo al habilitarlo; la evidencia de respuesta real corresponde al E2E aislado.

Runtime, logs y estado: /Users/ramiro/Library/Application Support/Agent Chat.
Base canónica: .../data/agent-chat.db. Base original conservada en el worktree
feat-agent-chat-s7-s9; backup privado adicional en .local-state/backups del checkout.
El empaquetado usa pnpm deploy --legacy --prod y comprobó el binding SQLite con
Node 22 antes de instalar. Assets/migraciones/rutas se configuran explícitamente.
El instalador restaura además la metadata de dependencias de pnpm offline después
de deploy; se corrigió el fallo no-TTY observado al volver a ejecutar lint desde
el workspace. La comprobación final de lint y typecheck volvió a pasar.
No se guardan credenciales en los plists; OAuth permanece administrado por Codex.

## Límites efectivos y alcance

Es una implementación local con un runtime fijado por agente, no un hospedador de
agentes remotos. La variante de webhook HTTP remoto del research queda pendiente.
No se migró el protocolo MCP ni se añadió autocompletado de menciones.

Hay 30 eventos procesables por hora/agente, timeout de worker de 120 s y un turno
simultáneo. No se promete límite preventivo USD. Los turnos ambiguos permanecen
bloqueados para revisión: ni revocar/reconectar ni un timeout los regeneran. El
recovery requiere dueño y grant anterior revocada, y no fuerza un turno incierto.
Los servicios corren durante la sesión de usuario; no encienden un Mac apagado.
