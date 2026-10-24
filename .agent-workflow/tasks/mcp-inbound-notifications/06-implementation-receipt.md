# Implementación: identidad y autorización

Usuario aprobó outline r3 con «si» después de la revisión independiente Codex.
Hash aprobado: 674508d821b87ee9698d06a92df858f8f8476cdb8cbbb5aff66b693ee4e3d53b.
Fecha de aprobación: 2026-10-23. El outline se conserva sin editar ese hash.

Source repo: /Users/ramiro/Desktop/projects/agent_chat.feat-ui-redesign
Source branch: feat/ui-redesign
Source commit: 50d0fa61b8dadd468d9e4f4e480a45a2d3b34b63
Worktrunk command: wt switch --create feat/mcp-inbound-notifications --base feat/ui-redesign --format json --yes
Implementation branch: feat/mcp-inbound-notifications
Implementation worktree: /Users/ramiro/Desktop/projects/agent_chat.feat-mcp-inbound-notifications
Estado de limpieza: conservar worktree para continuar; no merge, push o PR.
Documentos no versionados copiados del worktree de diseño; originales preservados.

Gate activo: S0, comprobar capacidades sin iniciar generaciones. La aprobación
del outline habilita implementación de slices sujetos a sus condiciones; no fija
modelo/monto ni autoriza una prueba real con gasto por sí sola. Todo con Codex.
No iniciar slices dependientes si S0 falla aislamiento/control/cota económica.

## Revisión S0 de Codex

Task ID: node:delegated-task:command%3Amcp%3A1bd8506e-58f0-4b1b-8ef4-39ee3ce5c936%3Adelegate-task%3Amcp-inbound-s0-capability-review-20261023
Provider codex / gpt-6.1-sol, reasoningEffort high, serviceTier default.
Estado terminal: completed. Solo lectura; 9/9 tests entonces presentes pasaron.
Veredicto: diagnóstico parcial honesto, S0 no aprobado; S1 debe seguir bloqueado.

- P1: aislamiento completo start/resume no demostrado. disabledPluginIds no filtra
  capacidades según esquema local; no usarlo como aislamiento.
- P1: consumo único, correlación y cierre requieren evidencia. clientUserMessageId
  no documenta idempotencia; unsubscribe no acredita fin del turno.
- P1: rollout_budget acepta configuración en 0.164.0 con enabled, limit_tokens y
  reminder_at_remaining_tokens. Eso no demuestra corte/cobertura/sobrepaso.
- P2: reproducido ejecutable que ignora SIGTERM en --version/generate-json-schema;
  timeout de execFile no terminaba. Corregido timeout con SIGKILL en ambas fases,
  con dos pruebas nuevas contra procesos que ignoran SIGTERM (pendientes de cierre).

Siguiente investigación segura: implementación upstream exacta rust-v0.164.0 del
presupuesto de rollout, sin inferencia. No iniciar S1 ni afirmar ausencia global
de soporte basándose en campos que no aparecen en un esquema.

## Estado después de auditoría

S0 produjo diagnóstico ejecutable y evidencia negativa del gate, no un worker listo.
La auditoría de fuente fijada a rust-v0.164.0/6aaac694 muestra cómputo de presupuesto
al completar respuesta; no prueba reserva preventiva ni techo monetario. Véase
08-runtime-audit.md. Se detienen S1–S5 por la condición aprobada, no por el antiguo
cupo de Pi. No falta permiso genérico para implementar; faltan garantías técnicas
que el plan exige antes de avanzar y política de modelo/monto para prueba real.

Gate ID: inbound-implementation-r3
Decision / allowed mutation: ejecutar slices aprobados sujetos a S0 verificado
Owning artifact: 04-structure-outline.md r3 / hash 674508d821b87ee9698d06a92df858f8f8476cdb8cbbb5aff66b693ee4e3d53b
Decision owner / Approved by: Ramiro, mensaje «si»
Approved at: 2026-10-23
Status: approved
Explicit exclusions: saltar condiciones de S0, gasto no aprobado, push y PR
Estado efectivo: S0 no pasa; diagnósticos/checks guardados, S1–S5 no iniciados.
