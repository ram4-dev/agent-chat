# Evidencia de mejoras no funcionales

Tres mejoras sobre chore/native-verification-gaps, desde642a53c, con identidad de worktree registrada en42. No cambia código de producto, contratos, dependencias, flags ni condiciones de skip.

## Cobertura local añadida

Cuatro casos del receptor: aprobación pendiente, inicio incierto y cancelación no generan, recuperan salida ni publican; una finalización que llega después de cancelar se deriva a reconciliación, sin publicación. La prueba de reconciliación usa una evidencia sintética que el puerto de control reenviaría al servidor para su validación; no pretende demostrar una firma nativa válida.

Seis casos HTTP del adaptador Hermes desde un journal vacío: aprobación pendiente, cancelado, fallo, interrupción y dos resultados completed inválidos. No devuelven prueba terminal ni salida recuperable ni crean runs por POST. Usan servidor HTTP propio y claves sintéticas, sin importar el core Hermes ni leer su instalación.

Esto complementa los gates internos, pero no cubre la implementación nativa de los cinco E2E Hermes ni reemplaza el E2E de inferencia Codex. Esos seis siguen omitidos por dependencias/accesos externos.

## Documentación

Guía docs/external-validation.md enumera seis skips con archivo, propósito y dependencia; distingue Codex legacy con inferencia del receptor nativo no implementado. Tabla de Rama: runtime Codex con profiles, acceso y activación Hermes, opt-in real Codex, retorno/asociación Grok y host/red24/7. README enlaza la guía. Se corrige el estado documental de la revisión estática Hermes, conservando pendiente la aceptación personal.

## Verificación

Lint/typecheck/build y suite de unitarios/contratos/integración PASS.169 unitarios+15 contratos+216 integración. E2E completo:27 PASS en1.3min. Total427 PASS,6 skips explícitos. git diff --check PASS y hashes03/04r2 sin cambios. El E2E usa Node22.23.3, Portless agent-chat-verification-gaps y DB nueva verification-gaps-final.db. Se omiten explícitamente5 pruebas Hermes instalado y1 de inferencia real, con AGENT_CHAT_HERMES_SOURCE y AGENT_CHAT_REAL_CODEX ausentes. No hay nueva suite Python ni acceso a ~/.hermes.

Revisión independiente pendiente. Sin cambios OAuth, modelos/mensajes reales, push o PR. Los servicios de prueba propios se cierran al terminar; fuentes, datos y servicios del usuario se preservan. Worktree conservado para revisión.
