# Codex nativo, controles y ensayo de migración

## Alcance y límite S6

Codex0.164.0 verificado mediante codex --version. App Server rechaza --profile antes de arrancar; el selector legacy profile=... también se rechaza y los esquemas start/resume/config-read no contienen selección de profile. El prototipo que usaba esa combinación se retiró, sin commit ni activación. Se entrega diagnóstico sin inferencia con HOME/CODEX_HOME temporales, y prueba de dos profiles CLI contra proveedor falso con personas distintas y herramientas anunciadas. No se considera un adaptador automático funcional ni aceptación personal. La vía nativa con el contrato completo sigue bloqueada por esa capacidad; no se actualiza Codex global ni se copian/aplanan perfiles para eludirlo.

Docs oficiales consultados: App Server y configuración avanzada, más esquema generado por la versión local. Contrato y comandos en docs/codex-native-status.md. Elegir una vía de host alternativa que conserve selección y aprobaciones requiere evidencia de capacidad; modificar esas garantías requiere revisión de diseño. Rama no necesita intervenir para ejecutar estos fixtures.

## Trabajo independiente implementado

Panel nativo: activación/pausa para todos los grupos de una revisión, con cobertura/capacidades verificadas. Acciones por entrega: pedir cancelación y confirmar sin publicar, con explicación y confirmación; errores no se presentan como éxito ni liberación de reserva. Usa endpoints existentes; no cambia autorización ni OAuth.

Consentimiento interactivo: selección de conexión separada y varias identidades del grupo actual, lectura/envío explícitos, challenge con vencimiento. Se prepara desde navegador; el cliente tiene que consumirlo por pair_native. No selecciona silenciosamente una identidad ni consume inbox. E2E usa cuentas/conexiones sintéticas nuevas, no conexiones personales.

Migración: helper SQLite backup abre fuente readonly y reserva destino exclusivo. Módulo de ensayo no expuesto por HTTP/MCP, usado solo en copia desechable. Prueba pausa legacy, quiescencia, nueva selección nativa desactivada, consentimiento sintético, un consumidor, respuesta+ACK/recibo idempotentes y rollback a revisión legacy nueva y pausada. Rechaza legacy activo y rollback con turno incierto. Mantiene historial, conversación legacy y valores OAuth de fuente/copia. No se borran datos del usuario.

## Verificación

Lint, typecheck, build y diff-check PASS.165 unitarios,15 contratos y208 integración PASS. Suite E2E completa inicial:27 PASS,6 skips,1.3min. Repetición final posterior al ajuste visual de checkboxes y ampliación de selección explícita de dos identidades:27 PASS,6 skips,1.2min. Total415 PASS. Lint/typecheck posteriores también PASS.

Los seis skips son los cinco E2E que importan Hermes instalado y uno de modelo Codex real. Se excluyen con AGENT_CHAT_HERMES_SOURCE y AGENT_CHAT_REAL_CODEX ausentes: sin acceso a ~/.hermes ni inferencia real. No hay suite Python independiente nueva. El módulo de migración y el CLI de copia se ejercitan en integración con DB temporales.

Capturas del consentimiento antes de generar challenge, actividad, pausa y bloqueos están en .local-state. No se capturan códigos de asociación. Se detectó y corrigió alineación de checkboxes en la revisión visual. Las verificaciones se ejecutan con servidor Node22.23.3, Portless agent-chat-codex-controls y DB nueva codex-controls-final-r2.db.

## Pendientes y decisiones de Rama

S6 automático queda bloqueado en esta versión: seleccionar un host/runtime que permita el profile exacto y demostrar aprobaciones, correlación, resultado durable y quiescencia. No se sustituye esa garantía por el CLI legacy. La aceptación de un profile personal sigue requiriendo elegirlo explícitamente.

Grok real mantiene los requisitos de26-s5-decisions.md: retorno terminal durable verificable, asociación bot/rutina, callback público y grant automático separado. Rama debe definir el host persistente24/7 y autorizar despliegue/asociación cuando se demuestre el retorno. Nada de ello se activa por pasar los tests. Hermes personal tampoco se activa.

Revisión independiente pendiente. No hay push, PR, cambios OAuth ni acceso a ~/.hermes. Worktree conservado. Los servicios temporales propios se cierran al terminar; servicios anteriores del usuario se preservan.
