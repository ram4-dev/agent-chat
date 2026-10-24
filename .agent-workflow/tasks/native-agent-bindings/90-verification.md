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

Probe del Codex instalado con profile/configuración/workspace temporales y proveedor Responses falso. E2E del Hermes instalado con AIAgent original, profile temporal y proveedor HTTP falso separado del event loop; continuidad, aislamiento por sesión, resultados explícitos, idempotencia, conflicto de contenido y recuperación tras reinicio. Detalles, hallazgos del harness y capacidades aún pendientes en 07-native-capabilities.md.

- pnpm lint: PASS.
- pnpm typecheck: PASS.
- pnpm build: PASS.
- pnpm test:unit: 148 PASS.
- pnpm test:contracts: 15 PASS.
- pnpm test:integration: 147 PASS.
- pnpm test:e2e con AGENT_CHAT_HERMES_SOURCE y servidor Portless aislado: 23 PASS, 1 skip. El skip es el E2E legacy con inferencia Codex real, que exige opt-in AGENT_CHAT_REAL_CODEX_E2E=1; las nuevas pruebas no usan inferencia.
- Python fixture: compilación sintáctica y ejecución desde el E2E instalado satisfactorias.
- git diff --check: PASS.

Las primeras ejecuciones detectaron defectos del harness que fueron corregidos antes del PASS: stdin sin cerrar, metadata/tools en formato additional_tools, proveedor en el mismo event loop, selector de tab y descubrimiento de proxy/URL/CA de Portless. No se aumentaron timeouts para ocultar esas fallas ni se reemplazó AIAgent con un mock.

## Estado actual y límites

S0 parcial verificado; no se declaró completo ni se habilitó un adaptador nativo real. Faltan aprobación nativa, selección entre profiles y observación soportada de su actividad. Grok Bot todavía requiere elegir el bot, establecer callback y ruta de red desde su nube. La pregunta de nombre de bot está pendiente; no se solicitaron secretos en chat.

No se modificaron servicios, configuración personal o bases de producción; sí se iniciaron procesos temporales de prueba. No hubo modelos reales ni rutinas Grok Bot, push o PR. El receptor actual permanece separado de estos fixtures. La próxima acción es revisión del incremento S0 y cierre de sus checks pendientes, manteniendo bloqueada la habilitación de proveedores no verificados.
