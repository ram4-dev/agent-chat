# Implementación de agentes nativos

- Repo fuente: /Users/ramiro/Desktop/projects/agent_chat.feat-mcp-inbound-e2e.
- Rama fuente: feat/mcp-inbound-e2e.
- Base: ead3e24 (documentación aprobada; código de base 488db69).
- Rama de implementación: feat/native-agent-bindings.
- Worktree: /Users/ramiro/Desktop/projects/agent_chat.feat-native-agent-bindings.
- Creación: Worktrunk, 2026-10-23; se conserva para reanudar.
- Gate outline-r2 aprobado por Ramiro mediante «si». SHA-256 cc58e304142ea8a1f0c019da642916d264f771ff081aa99a8e92c1b1e95d8e99.
- Inicio: S0, fixtures aislados, sin migrar ni activar el receptor real.

## Primer incremento

Se agregan probe Codex desde entrypoint compilado, cliente de diagnóstico Hermes runs, fixture Python con AIAgent original y proveedor HTTP falso, helpers de ciclo de vida y pruebas unitarias/integración/E2E. Comandos y requisitos en docs/native-runtime-capabilities.md y README.

Checks: lint/typecheck/build PASS; 148 unit, 15 contratos, 147 integración y 23 E2E PASS. Un E2E legacy de inferencia real omitido por opt-in. Evidencia y límites en 07-native-capabilities.md. S0 permanece parcial; no se presenta la integración de notificaciones nativas como terminada.

Servidor aislado de pruebas: http://agent-chat-native-bindings.localhost:1356, DB .local-state/native-bindings-e2e.db del worktree. Se conserva durante el trabajo. Los fixtures Hermes iniciados por tests se cierran; se cerró también la instancia manual del spike. Ningún LaunchAgent existente se modificó.

## Correcciones de revisión S0

Se corrigen los seis findings del harness con dos regresiones nuevas de aislamiento/cleanup y E2E fortalecidos. Checks: lint/typecheck/build PASS; 148 unit + 15 contratos + 149 integración + 23 E2E PASS, un skip legacy real por opt-in. El E2E completo se ejecutó contra http://agent-chat-native-bindings-r2.localhost:1356 con DB .local-state/native-bindings-r2-fresh.db nueva del worktree. No se migraron datos reales ni se habilitaron adaptadores.

Verificación final tras controlar procesos hijos Codex: 148 unit + 15 contratos + 150 integración + 23 E2E PASS (336), un skip legacy real. Lint/typecheck/build PASS. Servidor vigente del harness: http://agent-chat-native-bindings-r3.localhost:1356, DB .local-state/native-bindings-r3-fresh.db. Los dos servidores anteriores del harness se cerraron, conservando sus bases como evidencia local; producción intacta.
