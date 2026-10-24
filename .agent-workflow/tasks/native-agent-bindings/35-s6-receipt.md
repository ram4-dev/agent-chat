# S6 y continuación S7: Codex nativo, controles y migración de prueba

Solicitud: implementar integración nativa Codex y después controles y migración aislada. Sin push/PR, cambios OAuth o acceso a ~/.hermes. Grok real queda anotado para Rama.

Fuente: feat/native-notification-status,2e04ceb. Worktrunk creó feat/codex-native-controls en /Users/ramiro/Desktop/projects/agent_chat.feat-codex-native-controls. Fuente limpia y preservada; no se trabaja en main. Dependencias instaladas con lockfile. Worktree se conserva para revisión.

Codex se ejecutará con profile, workspace y CODEX_HOME explícitos, conservando configuración/modelo/herramientas del dueño. La vía legacy no se reutiliza. App Server ofrece inicio/resume, eventos de finalización y aprobaciones; se contrastó documentación oficial y esquema generado por el binario instalado en HOME temporal. No se configura un profile personal ni se usa inferencia real en este incremento.

La autoridad de resultados nativos debe persistir separada del journal del receptor. No se reenvía un inicio ambiguo, no se considera idle como evidencia terminal y no se libera reserva por timeout. Sin evidencia terminal y ausencia de trabajo activo, se conserva el bloqueo. Aprobaciones no soportadas quedan bloqueadas, nunca autoaprobadas.

## Resultado de capacidad Codex

La versión0.164.0 rechaza --profile para App Server. El selector legacy profile=... también es rechazado; los esquemas start/resume/config-read no ofrecen selector. Se retiró el prototipo no operativo antes de registrar el incremento: no se entrega un adaptador que aparente preservar el profile. Se implementa diagnóstico aislado fail-closed y regresión de dos profiles CLI temporales con proveedor falso. La activación automática Codex permanece bloqueada, con alternativas/requisitos en docs/codex-native-status.md. No se cambió ninguna instalación/configuración global.

Se continuó el trabajo independiente autorizado: controles nativos de pausa/activación/cancelación/supresión, preparación de consentimiento interactivo de varias identidades por grupo y ensayo de migración/rollback en copia. No se modifican endpoints OAuth ni registros existentes. El consentimiento nuevo se prueba únicamente en fixtures propios.
