# Correcciones de revisión de controles y copia de prueba

Continuación del incremento registrado en35, worktree /Users/ramiro/Desktop/projects/agent_chat.feat-codex-native-controls y rama feat/codex-native-controls. Fuente81fa746, limpia antes de las correcciones. Se preserva el checkout fuente y main.

## P1 y P3: publicación exclusiva y limpieza propia

Las rutas de entrada y sus formas absolutas se validan y rechazan espacios exteriores. El destino final nunca se pasa a better-sqlite3: el backup se genera en un directorio privado hermano del destino. Antes de publicarlo se fija modo0600. link publica atómicamente y falla si ya existe el destino, incluso si otro proceso lo crea mientras se genera el backup. No se reserva un archivo final vacío.

La apertura de la fuente y el backup quedan dentro de try/finally. Se cierra el handle y se elimina exclusivamente el directorio temporal creado por esa ejecución. Un error no elimina ni sobrescribe un archivo del usuario. Una copia publicada conserva su enlace final cuando se retira el temporal.

Regresión ejecuta el CLI real con espacios/tabulación exteriores y destino existente, verifica el contenido original, prueba fuente inexistente y corrupta, comprueba ausencia de destino incompleto/temporales y permite reintentar con éxito. Comprueba contenido SQLite y permisos0600 del resultado.

## P2: error accesible dentro del diálogo

Mientras hay una confirmación abierta, feedback se renderiza dentro de Modal con role=alert. El aviso exterior se conserva solo cuando no hay diálogo pendiente. La regresión E2E exige el alert dentro del diálogo tras un conflicto de cancelación, antes de volver y probar confirmación sin publicar. No cambia las operaciones ni su autorización.

## Verificación

Lint/typecheck/build/diff-check PASS.165 unitarios+15 contratos+209 integración PASS. E2E completo:27 PASS en1.3min. Total416 PASS; se mantienen cinco skips de Hermes instalado y uno de modelo real. Sin lectura de ~/.hermes ni inferencia/mensajes reales. Servidor propio Node22.23.3 con Portless y DB nueva codex-controls-review-fixes.db; los servicios del usuario se preservan.

S6 automático sigue no implementado/no habilitado por el gate de profiles de la versión instalada; Grok real mantiene sus decisiones/capacidades pendientes para Rama. Esta corrección no modifica OAuth. Revisión independiente de cierre pendiente. Sin push ni PR.
