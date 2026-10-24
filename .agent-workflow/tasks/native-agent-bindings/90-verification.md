# Verificación de agentes nativos

Fecha: 2026-10-23. Rama de implementación: feat/native-agent-bindings.

## Aprobaciones y revisiones

Diseño r1 aprobado mediante «bien me gusta sigamos». Outline r2 aprobado mediante «si», después de dos revisiones independientes Codex high. NB-F1–3 cerrados en el contrato documental. Registro en 05-independent-review.md y 06-approval-log.md. Los mecanismos nativos todavía requieren evidencia de implementación.

- Diseño SHA-256: 07bdc25dde6134073442de0e8c324c3824a0ef9ed3ea6d50f63f5aeb4bdc9d31.
- Outline r2 SHA-256: cc58e304142ea8a1f0c019da642916d264f771ff081aa99a8e92c1b1e95d8e99.
- Base de implementación: ead3e24, paquete documental; código de base 488db69.
- Worktree y alcance: 08-implementation-receipt.md.

## Research previo

Se leyeron código, ayuda de CLIs, fuentes públicas de Hermes local y documentación oficial. No se ejecutaron modelos ni gateways durante research. Los enlaces y la visualización se comprobaron antes de implementar. No se presentó el E2E del receptor genérico como prueba nativa.

## S0 ejecutado

Probe del Codex instalado con descubrimiento, profile/configuración/workspace temporales y proveedor Responses falso; regresión con configuración inválida del caller. E2E de fuente Hermes versionada copiada por git archive, sin .env ni estado privado/symlinks, con AIAgent original, profile temporal, dependencias del lockfile en venv temporal y proveedor HTTP falso separado del event loop; continuidad, aislamiento por sesión, resultados explícitos, idempotencia, conflicto de contenido y recuperación tras reinicio. Detalles, hallazgos del harness y capacidades aún pendientes en 07-native-capabilities.md.

- pnpm lint: PASS.
- pnpm typecheck: PASS.
- pnpm build: PASS.
- pnpm test:unit: 148 PASS.
- pnpm test:contracts: 15 PASS.
- pnpm test:integration: 150 PASS.
- pnpm test:e2e con AGENT_CHAT_HERMES_SOURCE y servidor Portless aislado: 23 PASS, 1 skip. El skip es el E2E legacy con inferencia Codex real, que exige opt-in AGENT_CHAT_REAL_CODEX=1; las nuevas pruebas no usan inferencia.
- Python fixture: compilación sintáctica y ejecución desde el E2E instalado satisfactorias.
- git diff --check: PASS.

Las primeras ejecuciones detectaron defectos del harness que fueron corregidos antes del PASS: stdin sin cerrar, metadata/tools en formato additional_tools, proveedor en el mismo event loop, selector de tab y descubrimiento de proxy/URL/CA de Portless. No se aumentaron timeouts para ocultar esas fallas ni se reemplazó AIAgent con un mock.

## Estado actual y límites

S0 parcial verificado; no se declaró completo ni se habilitó un adaptador nativo real. Faltan aprobación nativa, selección entre profiles y observación soportada de su actividad. Grok Bot todavía requiere elegir el bot, establecer callback y ruta de red desde su nube. La pregunta de nombre de bot está pendiente; no se solicitaron secretos en chat.

No se modificaron servicios, configuración personal o bases de producción; sí se iniciaron procesos temporales de prueba. No hubo modelos reales ni rutinas Grok Bot, push o PR. El receptor actual permanece separado de estos fixtures. La próxima acción es revisión del incremento S0 y cierre de sus checks pendientes, manteniendo bloqueada la habilitación de proveedores no verificados.

## Correcciones posteriores a revisión S0 r1

S0-F1–6 corregidos por el autor, con cierre independiente pendiente: fuente Hermes limpia, descubrimiento Codex aislado, conteo de generaciones y snapshots sin carrera, cleanup de init, aserción de los cuatro tools y flag legacy AGENT_CHAT_REAL_CODEX corregido. Suite completa con DB nueva: 336 PASS, un skip legacy real por opt-in. Hubo un intento con DB reutilizada que se interrumpió; se volvió a ejecutar desde DB nueva con PASS. La evidencia inicial de aislamiento no se considera suficiente tras el hallazgo; la evidencia vigente es la obtenida desde la copia limpia. Registro y límites en 09-s0-review.md.

## S1 y correcciones F7/F8

Commit ac410b4 corrige managed scope Hermes y cancelación exterior Codex. Regresiones: scope sintético con canario/configuración inválida ignorados; SIGTERM al entrypoint real con CLI y escritor que ignoran SIGTERM, drenaje y eliminación del HOME antes de retornar. Tres E2E enfocados PASS.

S1 agrega migración0008, contratos y repositorio interno, sin endpoints ni consumidores nuevos. Seis tests nuevos de ownership, contexto, CAS/rollback, capacidades, slots y migración legacy. Suite vigente: lint/typecheck/build PASS; 148 unit,15 contratos,156 integración y24 E2E PASS (343), un skip legacy real por opt-in. E2E completo32.0s con DB nueva .local-state/native-bindings-s1-fresh.db y Portless agent-chat-native-bindings-s1. Ver10-s1-foundation.md. La aceptación nativa de producto sigue pendiente y no se atribuye a esta suite.
