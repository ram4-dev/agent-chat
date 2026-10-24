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

## Cierre del hallazgo S1-F1

S0-F7/F8 cerrados por la revisión independiente de 4837624. S1-F1 corregido por el autor: continuidad histórica compatible y rechazo atómico de ambigüedad; cierre independiente pendiente. Cuatro regresiones adicionales. Lint/typecheck/build PASS; 148 unit, 15 contratos, 160 integración y 24 E2E PASS (347), un skip legacy real por opt-in. E2E 31.9s sobre DB nueva native-bindings-s1-fix-fresh.db y Portless agent-chat-native-bindings-s1-fix. La corrección no altera migración0008 ni los servicios de producción.

## S2: pairing y separación de autoridad

S1-F1 cerrado por revisión independiente de 64b30a4, sin nuevos defectos concretos. Se implementa S2 con migración0009, módulo native-access, HTTP del dueño, clasificación persistente de conexiones OAuth y superficie MCP nativa separada. No se amplían defaults OAuth legacy. WS rechaza ambas clases nuevas y cierra sockets reclasificados; ACK/runtime legacy no consumen trabajo del binding nativo. Once tests de integración nuevos y un E2E de navegador. Detalles en 12-s2-authorization.md.

Verificación final: lint/typecheck/build y diff --check PASS; 148 unit, 15 contratos, 171 integración, 25 E2E PASS (359), un skip legacy real por opt-in. E2E 35.9s, DB nueva native-bindings-s2-checked-fresh.db y Portless agent-chat-native-bindings-s2-checked. Se cerraron solamente los tres servidores temporales propios de S2. La publicación interactiva se inspeccionó en captura; la UI de consentimiento nativo y los adaptadores reales siguen pendientes de sus slices. Revisión independiente de S2 pendiente.

## S3: entregas durables y supervisor

S2 cerrado por revisión independiente de455c261, sin hallazgos. S3 implementa migración0010, controladores/épocas, reserva por target, inicio y cancelación de consumo único, resultados inmutables, publicación+ACK atómica, recibos y reconciliación limitada con evidencia Ed25519. No se libera una ejecución incierta por heartbeat, timeout o muerte del controlador. Hay retención terminal ejecutable y tombstones; la operación real del proveedor sigue su gate. Activación entre agentes bloqueada hasta verificar ciclos y límite de30 inicios/hora/target, sin promesa económica. Detalles en14-s3-delivery.md.

Verificación final del autor: lint/typecheck/build/diff check PASS; 152 unit,15 contratos,188 integración,26 E2E PASS(381), un skip legacy real por opt-in. E2E45.2s en DB nueva native-bindings-s3-checked-fresh.db y Portless agent-chat-native-bindings-s3-checked. El E2E nuevo de12.7s usa el supervisor compilado, caída después del despacho, respuesta de publicación descartada, dos estados locales y proveedor persistente separado; no regenera, conserva conversación y prueba no_reply/pausa/reanudación. Reconciliación HTTP probada tras revocar OAuth, evidencia contradictoria rechazada y regresión de long poll después del cierre físico del transporte.

Se inspeccionó la captura02: flujo y autores correctos; la etiqueta de conexión legacy no representa aún al receptor nativo y se mantiene pendiente para S7. Los fallos previos de arranque/cleanup fueron del harness; quedaron corregidos sin aumentar timeouts ni reducir aserciones. S0 parcial y aceptación real pendientes; producción sin cambios, sin modelos reales ni push/PR. Revisión independiente de S3 pendiente.

## Corrección S3-F1: sincronización de commits

Revisión r1 de126ced9 encontró un major: consumo de inicio o claim podía perderse en WAL/NORMAL después de una caída del host. createDatabase fija y comprueba FULL en cada conexión antes de devolverla y cierra el handle si falla. Nueva regresión de conexiones independientes/reapertura y tres escenarios de VFS aislado: dos controles NORMAL reproducen la autorización duplicada tras perder commits y FULL conserva el consumo, con B sin estado local. El modelo restaura únicamente bytes observados tras xSync; no es una prueba de corte físico de energía. Fuente, mecanismo y límites en16-s3-durability.md.

Lint/typecheck/build/diff check PASS;152 unit,15 contratos,192 integración,26 E2E PASS(385), un skip legacy real por opt-in. E2E49.4s sobre DB nueva native-bindings-s3-durability-fresh.db y Portless agent-chat-native-bindings-s3-durability, con supervisor12.8s. README actualizado con requisito POSIX/cc y ejecución aislada. S3-F1 espera revisión independiente r2; S4 sigue pendiente de ese cierre. Producción intacta, sin modelos reales, push ni PR.

## S4: Hermes runs por profile

S3-F1 cerrado independientemente en d52f498. Adaptador Hermes, plugin de recuperación de lectura fijado por hashes, sesiones binding+grupo+generación, perfil exacto, aprobaciones nativas y no_reply explícito. Cancelación con ejecutor activo reproducida; cancel=false y reserva incierta preservada. E2E real de producto con proveedor falso desde navegador y supervisor, respuesta perdida antes de registrar run_ref, reinicio del gateway y controlador B vacío sin regenerar. Dos personas comparten sesión y otro grupo no comparte historial; dos profiles conservan personas/historias separadas.

Lint/typecheck/build/diff check PASS;153 unit+15 contratos+193 integración+30 E2E=391 PASS, un skip legacy de modelo real por opt-in. E2E2.2min contra DB nueva native-s4-verification-20261023.db y Portless agent-chat-native-s4-check. Captura de aprobación/silencio inspeccionada. Detalles en18-s4-hermes.md y docs/hermes-native-adapter.md. Revisión independiente pendiente. S0 sigue parcial y aceptación/activación del profile personal, Grok y Codex pendientes. Producción intacta; sin push/PR.
