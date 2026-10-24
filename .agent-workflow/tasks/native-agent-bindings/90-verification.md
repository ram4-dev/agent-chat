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

## Correcciones S4-F1/F2

Revisión r1 encontró major de autor y minor de retención ociosa. El cliente/fingerprint ahora envían author; el E2E observa _turn_author en AIAgent original y comprueba IDs exactos de ambos humanos en la misma sesión, también tras reinicio. Mantenimiento horario elimina cuerpos/pruebas confirmados vencidos sin reinicio, preserva pendientes y tombstones, y se detiene en close. Regresión de ocho días con temporizadores controlados y comprobación directa de SQLite.

Lint/typecheck/build/diff check PASS;153 unit+15 contratos+193 integración+30 E2E=391 PASS, un skip legacy real por opt-in. Suite E2E completa2.2min, DB nueva native-s4-r2-verification.db, Portless agent-chat-native-s4-r2-check. Detalles en20-s4-review-fixes.md. Revisión independiente r2 pendiente; aceptación personal y S0 global permanecen pendientes.

## S5: notificaciones webhook de Grok

Implementación aislada en feat/grok-notifications desde40ab8b8. Journal de despacho FULL/consumo único, envelope opaco, HTTPS/DNS/IP/TLS restringidos, native_grok_begin remoto separado, callbacks nativos durables y publicación+ACK existentes. Prueba desde navegador con supervisor real y webhook falso, duplicados, respuesta perdida, B vacío, pausa y silencio. Guía docs/grok-notifications.md y plantilla integrations/grok/agent-chat-routine.md.

Lint/typecheck/build/diff check PASS;159 unit+15 contratos+199 integración+26 E2E=399 PASS,6 skips explícitos para no tocar Hermes ni usar modelo real. E2E final45.8s. Primer intento tuvo un timeout de readiness en el servidor temporal de un test nativo existente; se mejoró sincronización/diagnóstico y pasó la repetición completa sin aumentar timeouts. Evidencia y límites en27-s5-verification.md. Activación real bloqueada por decisiones/capacidades de26; conexiones reales y producción intactas. Revisión independiente pendiente.

## Corrección S5-F1

R1 de7df1c25 encontró un minor documental:binding/revisión/target no son campos de get_identity. La plantilla y guía ahora verifican identidad/clase/scopes en esa herramienta y mapping/grupo en native_delivery. Fixture añade la consulta real por MCP y el E2E exige identity_verified en cada entrega sintética. Sin cambiar respuestas productivas o permisos.

Lint/typecheck/build/diff check PASS;159 unit+15 contratos+199 integración+26 E2E=399 PASS,6 skip explícitos. E2E completo44.1s, DB nueva grok-r2-verification-20261024.db y Portless agent-chat-grok-r2-check. S5-F1 corregido por autor; sin inventar revisión independiente adicional. R1 sin hallazgos mayores. Activación real y decisiones de26 siguen pendientes; restricciones del usuario intactas.

## S7: observabilidad nativa de consulta

Incremento independiente desde737b60d en feat/native-notification-status. API del dueño con membresía actual, señal de controlador diferenciada de ejecución/entrega, panel en español con capacidades/cobertura/actividad y recibos, errores/vacíos/foco móvil. No habilita consumidores ni cambia conexiones. Detalles de alcance y evidencia en30-s7-observability-receipt.md,31-s7-observability-verification.md y docs/native-notification-status.md.

Lint/typecheck/build/diff check PASS;162 unit+15 contratos+204 integración+27 E2E=408 PASS,6 skips explícitos (5 Hermes instalado,1 Codex real). E2E final48.6s con Portless agent-chat-native-status, Node22.23.3 y DB nueva. Capturas desktop/móvil/publicación inspeccionadas. Revisión independiente pendiente. S6 y resto de S7/S8 no se declaran bloqueados por Grok. Activación real sigue sujeta a26; sin OAuth/~/.hermes/mensajes reales/push/PR.

## Correcciones S7-F1/F2/F3

Revisión r1 encontró tres hallazgos medios. Vencimiento por completed_at incluso para supresión sin resultado, polling secuencial con timeout visible de ocho segundos y pausa separada del estado pendiente. Regresión de supresión a ocho días y casos unitarios de pausa con incertidumbre/ejecución/cancelación. E2E de respuesta demorada cuatro segundos sin solapamiento, consulta retenida con error/reintento y los tres estados pausados.

Lint/typecheck/build/diff check PASS;165 unit+15 contratos+205 integración+27 E2E=412 PASS,6 skips explícitos por restricciones sobre Hermes/modelo real. E2E completo1.2min en Portless agent-chat-native-status, Node22.23.3 y DB nueva native-status-fixes.db. Evidencia en33-s7-review-fixes.md. Correcciones del autor pendientes de revisión independiente. Sin OAuth/~/.hermes/mensajes reales/push/PR.

## S7-F3-r2: pausa con bloqueo externo

R2 cerró F1/F2 por inspección y dejó un medio: pausa oculta si jobs=[] y blockedElsewhere=true. Aviso ampliado al bloqueo externo, regresión de integración con pausa y ausencia de contenido ajeno y E2E con ambos indicadores/actividad vacía. Captura inspeccionada. Detalles en34-s7-external-block-pause.md.

Lint/typecheck/build/diff check PASS;165 unit+15 contratos+205 integración+27 E2E=412 PASS,6 skips explícitos. E2E1.2min en Portless/Node22, DB nueva native-status-r3.db. Cierre independiente pendiente. Sin OAuth/~/.hermes/mensajes reales/push/PR. Se cierra solo el servidor temporal propio; servicios anteriores conservados.

## Cierre independiente del incremento de observabilidad S7

R3 cerró S7-F3-r2 por inspección estática de5d3afdd contra e6991f0, sin nuevos hallazgos. F1/F2 mantienen cierre r2. Hashes protegidos y árbol limpio verificados por reviewer; no ejecutó suites. Última suite del autor:412 PASS,6 skips explícitos, lint/typecheck/build PASS. Este cierre documental no cambia código ni requiere repetir esa suite.

Registro completo en32-s7-review.md. Se cierra este incremento de consulta; quedan S6, restoS7/S8 y aceptación real. Grok continúa sin habilitar hasta demostrar terminal/challenge/red y definir operación24/7. Sin push, PR, OAuth, ~/.hermes ni mensajes reales.

## S6: gate Codex y trabajo independiente de controles/migración

Nueva rama feat/codex-native-controls desde2e04ceb, Worktrunk aislado. Codex0.164.0 App Server rechaza --profile; esquema no tiene selector y selector legacy también se rechaza. S6 automático permanece bloqueado: no se entrega adaptador que ignore el profile o suplante políticas/modelo. Diagnóstico sin inferencia y prueba de dos profiles CLI con proveedor falso/personas/herramientas distintas. Esto no acredita receptor nativo ni aceptación personal.

Se completó trabajo independiente: controles nativos de activación/pausa y cancelación/supresión con confirmación/errores; consentimiento interactivo UI para varias identidades del grupo con conexión separada; ensayo de copia/migración/rollback con fuente readonly, guardas de quiescencia, publicación+ACK idempotentes y legado conservado y pausado. No se modifican OAuth existentes. Detalles en35/36 y docs/codex-native-status.md,docs/native-trial-migration.md.

Lint/typecheck/build/diff-check PASS;165 unit+15 contratos+208 integración+27 E2E=415 PASS,6 skips explícitos (Hermes instalado/modelo real). E2E final1.2min con Node22.23.3, Portless agent-chat-codex-controls y DB nueva codex-controls-final-r2.db. Selección de dos identidades, errores/reintentos y controles probados en navegador; captura de consentimiento sin challenge inspeccionada y alineación de checkboxes corregida. Revisión independiente pendiente. Sin push/PR/OAuth/~/.hermes/mensajes reales. Grok real y decisiones de Rama permanecen anotados en26/36 y guía de migración.

## Correcciones de copia y error modal

Revisión r1 de622156f encontró P1 destino recortado por SQLite, P2 error fuera del diálogo y P3 destino incompleto retenido. Copia en temporal privado con ruta validada, permisos0600 y publicación por enlace atómico sin reemplazo; limpieza exclusiva del temporal ante error. Regresión CLI de espacios, destino existente, fuentes inválidas, limpieza y reintento. Alert de acción ahora dentro del diálogo; E2E lo exige con selector del diálogo.

Lint/typecheck/build/diff-check PASS;165 unit+15 contratos+209 integración+27 E2E=416 PASS,6 skips explícitos. E2E final1.3min, Portless agent-chat-codex-controls/Node22.23.3 y DB nueva codex-controls-review-fixes.db. Detalles en38-controls-review-fixes.md. Cierre independiente pendiente. S6 y Grok reales mantienen sus bloqueos, sin OAuth/~/.hermes/mensajes/push/PR.

## Cierre independiente de controles y ensayo de copia/migración

R2 cerró P1/P2/P3 por inspección estática de8633c66 contra81fa746, sin nuevos hallazgos. Hashes protegidos, árbol limpio y diff-check verificados; no ejecutó suites. Última suite del autor:416 PASS,6 skips explícitos, lint/typecheck/build PASS. El cierre documental no modifica código ni requiere repetir esa suite.

Registro en37-codex-controls-review.md. Se cierra el incremento de controles/consentimiento y ensayo aislado; S6 automático sigue bloqueado/no implementado, con evidencia en docs/codex-native-status.md. Grok real y Hermes personal siguen pendientes. No se autoriza producción ni se declara cierre global. Sin push, PR, OAuth, ~/.hermes ni mensajes reales.

## Coexistencia interactiva durante turno automático activo

Pendiente explícito S6 independiente de profiles/credenciales: escritura interactiva mientras existe job automático. Rama feat/native-coexistence desde d51cf92. Nueva regresión reprodujo colisión: un envío público con clave native:<eventId> impedía finish por conflicto de idempotencia. Helper central preserva claves automáticas existentes y reserva ese prefijo frente a send_message legacy/nativo. No cambia OAuth, autorización, estados ni datos persistidos; las colisiones históricas requieren revisión del dueño.

Integración y navegador con supervisor real/webhook falso verifican turno running, envío explícito, replay sin auditoría duplicada, conflicto e identidad no concedida rechazados, revocación interactiva, ledger/claim/fence/inbox intactos y finalización automática original una sola vez. Todos los datos/conexiones son fixtures temporales, sin inferencia o mensajes reales. Detalles en39/40 y docs/native-trial-migration.md.

Lint/typecheck/build/diff-check PASS;165 unit+15 contratos+210 integración+27 E2E=417 PASS,6 skips explícitos. E2E completo1.3min con Portless/Node22 y DB nueva. Revisión independiente pendiente. S6 automático, Hermes personal, Grok real y host24/7 siguen pendientes con accesos/decisiones indicados en40. No se declara cierre global; sin push a main, PR, OAuth o ~/.hermes.

## Cierre independiente de coexistencia

R1 de e3a2a05 contra d51cf92 terminó sin hallazgos concretos. Preserva claves automáticas y atomicidad de publicación/ACK/recibo; restricción pública y regresiones de claim/inbox/auditoría inspeccionadas. Hashes protegidos, árbol limpio y diff-check verificados por reviewer; no ejecutó suites. Última suite del autor:417 PASS,6 skips explícitos, lint/typecheck/build PASS.

Registro completo en41-coexistence-review.md. Cierre acotado al incremento; S6 automático y pendientes externos de40 continúan abiertos. Esta actualización solo documental no requiere repetir suites. Sin push, PR, OAuth, ~/.hermes ni mensajes reales.

## Mejoras internas no funcionales

Rama chore/native-verification-gaps desde642a53c, Worktrunk registrado en42. No quedó otra funcionalidad interna identificada sin gates externos; se aplicaron tres mejoras autorizadas:4 tests de bloqueo/reconciliación del receptor,6 tests HTTP del adaptador Hermes ante evidencia no terminal o inválida y guía del inventario de6 skips/decisiones de Rama. Solo tests/documentación, sin código de producto, contratos, dependencias o cambios de flags.

Lint/typecheck/build/diff-check PASS;169 unit+15 contratos+216 integración+27 E2E=427 PASS,6 skips explícitos. E2E final1.3min con Portless agent-chat-verification-gaps, Node22.23.3 y DB nueva verification-gaps-final.db. Los doubles locales no acreditan Hermes real ni inferencia Codex, por lo que no se retiran los skips. Detalles en43 y docs/external-validation.md. Revisión independiente pendiente; sin push/PR/OAuth/~/.hermes/mensajes reales.

## Cierre independiente de mejoras no funcionales

R1 de1ce0313 contra642a53c terminó sin hallazgos concretos. Tests de bloqueo/reconciliación, rechazo de evidencia HTTP incompleta y limpieza de recursos inspeccionados; matriz de5 skips Hermes+1 Codex legacy coincide con fuentes. Hashes protegidos, árbol limpio y diff-check verificados por reviewer; no ejecutó suites. Última suite del autor:427 PASS,6 skips explícitos, lint/typecheck/build PASS.

Registro en44-verification-gaps-review.md. Cierre acotado a tests/docs; esta actualización documental no requiere repetir la suite. S6 automático y aceptaciones reales siguen pendientes, con decisiones/accesos en docs/external-validation.md. Sin push, PR, OAuth, ~/.hermes o mensajes reales.
