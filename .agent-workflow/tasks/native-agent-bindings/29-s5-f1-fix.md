# Corrección S5-F1: contrato de la plantilla

Revisión r1 de7df1c25:un minor, sin critical/controlling/major. get_identity no expone binding/revisión/target. Se corrigen pasos1–3 de la plantilla:validar identidad/clase automática/scopes con get_identity y validar binding/revisión/target/startKey, identidad y grupo esperado con native_delivery antes de native_grok_begin. Se aclara la distinción también en la guía.

El webhook falso ahora ejecuta get_identity sobre MCP real y comprueba identidad esperada, grupo visible, clase automática y los cuatro scopes nativos. Antes de ejecutar la tarea valida identidad/grupo y mapping contra native_delivery. Se registra identity_verified en su DB sintética y el E2E exige que todas las entregas lo hayan pasado. No cambió la superficie productiva get_identity ni el protocolo de permisos para acomodar la documentación.

Verificación del autor:lint/typecheck/build/diff check PASS;159 unit+15 contratos+199 integración+26 E2E=399 PASS;6 skips explícitos(cincos casos Hermes excluidos y un modelo real Codex opt-in). E2E completo44.1s contra DB sintética nueva .local-state/grok-r2-verification-20261024.db, Portless agent-chat-grok-r2-check. Logs /tmp/grok-r2-check.log y /tmp/grok-r2-e2e.log. El servidor temporal se cierra al terminar; datos existentes/DB anteriores se conservan.

S5-F1 corregido y validado por el autor; no se atribuye un dictamen independiente r2 que no se ejecutó. R1 completó la revisión de seguridad/protocolos sin hallazgos mayores. La corrección es de plantilla y fixture, sin cambios funcionales de servidor/bridge ni permisos. La aceptación real sigue bloqueada por las capacidades/decisiones de26; no se habilitó el bot real.

Restricciones respetadas:no mensajes reales ni cambios OAuth existentes, sin acceso a ~/.hermes ni borrado de información del usuario; sin push/PR. Worktree/branch permanecen disponibles para continuar.
