# S7-F3-r2: pausa con turno fuera del grupo

Continuación del mismo incremento en /Users/ramiro/Desktop/projects/agent_chat.feat-native-notification-status, rama feat/native-notification-status, fuente e6991f0e43eafe1c5aee091ac82abbd136f8614a. Worktree limpio antes del fix; fuente y main conservados.

El aviso de pausa se muestra también cuando blockedElsewhere es verdadero y no hay jobs locales. El resumen sigue indicando el bloqueo externo. No se devuelve ningún identificador, entrada o salida del otro grupo.

La regresión de integración existente ahora pausa el binding antes de consultar el otro grupo y exige enabled=false, bloqueo y lista vacía. El E2E añade una respuesta sintética con esa combinación y comprueba ambos indicadores visibles, actividad vacía y captura native-status-paused-other-group.png.

Este cambio no modifica polling, retención, permisos ni protocolos de entrega. F1/F2 conservan el cierre estático r2. Lint/typecheck/build/diff check PASS;165 unitarios+15 contratos+205 integración+27 E2E=412 PASS,6 skips explícitos (5 Hermes instalado,1 Codex real). E2E completo1.2min con Node22.23.3, Portless agent-chat-native-status y DB nueva native-status-r3.db. Captura del bloqueo externo pausado inspeccionada; hashes03/04r2 sin cambios. Revisión independiente pendiente; sin declaración de cierre global ni aceptación real de proveedores.

Se conserva el worktree; no se toca OAuth ni ~/.hermes, no hay mensajes reales, push o PR.
