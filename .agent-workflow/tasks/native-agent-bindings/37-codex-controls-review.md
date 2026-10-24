# Revisiones independientes de controles, ensayo y gate Codex

Estado actual: P1/P2/P3 cerrados estáticamente en r2, sin nuevos hallazgos. Los estados pendientes de abajo forman parte del registro histórico de las rondas.

R1 completada: P1 destino con trim, P2 error fuera del diálogo y P3 reserva retenida al fallar. Correcciones del autor en curso. Snapshot622156f1be2f4d8c26e515ebb22ea2fdf7f75da4 contra2e04ceb, rama feat/codex-native-controls, worktree aislado registrado en35. Solo lectura, Codex gpt-6.1-sol, reasoningEffort=high/serviceTier=default, async/shared.

- clientRequestId:native-bindings-codex-controls-review-r1-20261024.
- taskId:node:delegated-task:command%3Amcp%3A1bd8506e-58f0-4b1b-8ef4-39ee3ce5c936%3Adelegate-task%3Anative-bindings-codex-controls-review-r1-20261024.

Brief incluye contrato/hashes03/04r2, alcance no completado de S6, contraevidencia instalada sobre AppServerprofiles, controles/consentimiento, módulo offline y backup, regresiones/counters y restricciones. No usar childThreadId paraotra ronda. Sin escrituras,delegación,suites,servicios,modelos,OAuth,mensajes ni acceso a ~/.hermes/configuración privada.415 PASS son evidencia delautor. No aprobación humana ni aceptación real de adaptadores.

Servidor temporal propio cerrado. Se preservan servicios del usuario y worktrees fuente. Sin push/PR.


## Dictamen r1

Revisión estática de622156f contra2e04ceb, HEAD81fa746 solo documental. Hashes protegidos coincidentes; árbol limpio. Sin suites, servicios ni cambios del reviewer.

P1 alto: better-sqlite3 recorta el destino después de reservar otro nombre literal con wx y puede sobrescribir un archivo existente. P2 medio: error de cancelación/supresión fuera del diálogo inerte durante showModal. P3 bajo: fuente o backup fallidos dejan una reserva incompleta que impide reintentar. Hallazgos aceptados, pendientes de cierre independiente.

S6 automático se mantiene expresamente no implementado/no habilitado; no se considera un defecto adicional del incremento entregado. No se reabren S7-F1/F2/F3 ni cambian endpoints de autorización.415 PASS pertenecen al autor.

## Solicitud r2

En curso, sin dictamen. Snapshot8633c66d8e0b5375878d827efad5f808537715a2 contra81fa746. Nueva delegación solo lectura, Codex gpt-6.1-sol, reasoningEffort=high/serviceTier=default, async/shared. Incluye brief original, hallazgos aceptados y respuestas/regresiones, hashes protegidos y restricciones.

- clientRequestId:native-bindings-codex-controls-review-r2-20261024.
- taskId:node:delegated-task:command%3Amcp%3A1bd8506e-58f0-4b1b-8ef4-39ee3ce5c936%3Adelegate-task%3Anative-bindings-codex-controls-review-r2-20261024.

416 PASS y6 skips son evidencia del autor. Servidor temporal cerrado, servicios previos conservados. S6 automático y aceptaciones reales siguen pendientes; sin OAuth/~/.hermes/mensajes/push/PR.


## Dictamen r2 recibido: cierre del incremento

Sin nuevos hallazgos concretos sobre8633c66d8e0b5375878d827efad5f808537715a2 contra81fa746. P1 alto cerrado: temporal privado, validación, modo0600 y publicación por link sin reemplazo. P2 medio cerrado: alert dentro del diálogo, exigido por E2E tras409. P3 bajo cerrado: finally sobre apertura/backup y limpieza exclusiva del temporal, con regresión de fuentes inválidas y reintento.

Reviewer verificó hashes protegidos inicio/cierre y snapshot, árbol limpio y diff-check PASS. HEAD0d71d14 era solo documental. Revisión exclusivamente estática, sin escrituras, suites o servicios.416 PASS y6 skips son evidencia del autor.

No quedan hallazgos abiertos de estas dos rondas para controles y ensayo de migración. El marcador y módulo offline no autorizan producción. S6 automático sigue no implementado/no habilitado; Grok real y Hermes personal conservan sus pendientes. No es aprobación humana, aceptación real ni cierre global de S6/S7/S8.
