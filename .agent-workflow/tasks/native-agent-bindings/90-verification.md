# Verificación del research y diseño

Fecha: 2026-10-23. Base de código: `488db69`, `feat/mcp-inbound-e2e`.

## Ejecutado

- Inspección de worker, receiver, autenticación MCP, handlers, automation, scopes e inbox y E2E existente.
- Ayuda/versiones de Codex y Hermes; metadatos públicos de la aplicación Grok Bot.
- Fuente y documentación local de Hermes en `d923a5eb487a`, incluyendo webhook, sesiones, API de runs, plugins y relay experimental.
- Documentación oficial de OpenAI y Grok Bot/Cursor, enlazada en research.
- Revisión de coherencia entre research y propuesta: no se identifica profile con sesión; no se equipara aceptación HTTP con finalización; no se promete aislamiento por bot ni ejecución exactamente una vez.

## No ejecutado

No se llamaron modelos, bots, rutinas o gateways; no hubo OAuth ni mensajes de prueba. No se leyeron archivos de credenciales, configuraciones privadas, logs de bots o bases personales. No se cambiaron servicios.

Lint, typecheck, build, unit, integración y E2E no se ejecutan en esta fase: solamente se agregan documentos. No se presenta el PASS del receptor genérico anterior como evidencia del nuevo diseño. La aceptación real y la matriz de fallas están definidas en la discusión de diseño.

## Estado del gate

Research completado con gaps explícitos. Diseño r1 aprobado por Ramiro mediante «bien me gusta sigamos», registrado en `06-approval-log.md`. La revisión de r1 encontró tres major, sin critical ni controlling. Se incorporaron en r2 las restricciones WebSocket y los criterios bloqueantes de terminal y sesión Hermes; r2 completó la revisión independiente Codex high sin hallazgos nuevos: NB-F1–3 cerrados en el contrato documental, con recibo y disposiciones en `05-independent-review.md`. La siguiente acción es aprobación humana del outline r2 exacto antes de implementar. Los mecanismos de Hermes y el callback/red de Grok Bot siguen sujetos a pruebas bloqueantes en S0. No hay implementación autorizada por este outline todavía.

SHA-256 de `03-design-discussion.md` r1: `07bdc25dde6134073442de0e8c324c3824a0ef9ed3ea6d50f63f5aeb4bdc9d31`.

Comprobaciones documentales: enlaces locales revisados por existencia y documentos identificados; `git diff --check` sin errores. Los archivos nuevos aparecen únicamente dentro de este paquete. La visualización HTML se verificó con `html_preview` en 728 px y 360 px; la prueba móvil recorre las tres pestañas y comprueba ausencia de desborde horizontal. Sin errores de consola.

Outline r1 histórico SHA-256: `b0c63ed1be578382274a37e785cc8a8c1e0e8292d59c47353fa33158cc43b4b4`. Outline r2 actual SHA-256: `cc58e304142ea8a1f0c019da642916d264f771ff081aa99a8e92c1b1e95d8e99`. El diseño aprobado conserva su hash original. Se revisaron por existencia las referencias locales del paquete y se comprobó que todos los cambios siguen limitados a documentos del task packet.

Las fuentes externas pueden cambiar; la instalación de Hermes quedó identificada por commit. No se hicieron commits, push ni PR en esta fase.
