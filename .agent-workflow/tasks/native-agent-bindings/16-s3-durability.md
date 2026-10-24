# S3-F1: durabilidad del servidor

## Hallazgo y corrección

La revisión de126ced9 identificó que el servidor abría WAL sin fijar synchronous. El build de better-sqlite3 usa NORMAL como default de WAL. SQLite documenta que en ese modo un commit puede perderse después de una caída del sistema o pérdida de energía; FULL agrega sincronización del WAL por commit. Fuente: [PRAGMA synchronous](https://sqlite.org/pragma.html#pragma_synchronous).

createDatabase ahora fija FULL antes de configurar WAL, comprueba que el valor efectivo es2 y solo después devuelve la conexión. Si la configuración falla, cierra el handle y propaga el error antes de aceptar trabajo. La búsqueda en apps/server/src confirma que las conexiones escritoras del servidor se crean mediante esta fábrica; los repositorios, OAuth y servicios comparten el handle recibido. No hay migración de datos ni opción pública para degradar la política. La regresión comprueba el valor efectivo en una conexión, en otra simultánea y al reabrir; la política es por conexión.

## Modelo de pérdida de commits

La prueba nueva compila un VFS pequeño con los headers incluidos en better-sqlite3. Se carga únicamente en un subproceso de prueba, manteniendo vivo su loader. Todas las operaciones de SQLite se delegan al VFS original. Después de cada xSync exitoso, el wrapper conserva una imagen del archivo sincronizado. El estado inicial se obtiene de una DB sana, cerrada y checkpointed antes de crear el claim.

El escritor usa createDatabase y el módulo nativeDelivery compilados del servidor. Obtiene un claim, consume begin y comunica el ACK; un marcador externo representa el despacho ya ocurrido. El padre mata el proceso sin checkpoint ni cierre y reconstruye otra DB usando solo las imágenes sincronizadas. No copia writer.db, sus bytes volátiles ni su SHM. El controlador B comienza sin journal local y usa el servicio real para recuperar la entrega.

Tres escenarios:

- NORMAL antes del claim: se pierde claim+begin; B recibe otra startKey y puede autorizar un segundo inicio. Control negativo que reproduce la primera variante del hallazgo.
- FULL para el claim y NORMAL para begin: se conserva el claim pero se pierde el consumo; B conserva startKey y puede volver a iniciar. Control negativo de la segunda variante.
- Política corregida FULL: la recuperación conserva started y startKey; otro begin se rechaza. El almacenamiento local A no interviene.

La prueba verifica el modo efectivo y que el VFS observó sincronizaciones en los escenarios con commits FULL. El primer intento del harness no reconocía el alias /var frente a /private/var y falló los controles positivos. Se normalizó la ruta y se agregó el contador para acreditar que la captura está activa. No se debilitó ninguna expectativa para obtener PASS.

Esto modela pérdida de escrituras no cubiertas por xSync. No se apagó físicamente la Mac ni se certificó su hardware; la garantía depende del contrato de sincronización del VFS/OS/dispositivo. El modelo cubre el fallo concreto de WAL sin sync por commit, además de los E2E de caídas de proceso existentes.

## Requisitos y verificación

El test requiere POSIX y cc; en esta Mac se usó el compilador ya instalado. No descarga dependencias ni carga la extensión en el proceso de Vitest o en el servidor operativo. README documenta el requisito y el comando aislado, precedido por pnpm build.

Verificación actual del autor en Node26.11.1: lint, typecheck, build y git diff --check PASS. 152 unit,15 contratos,192 integración y26 E2E PASS(385); un skip legacy real por opt-in AGENT_CHAT_REAL_CODEX. E2E49.4s en DB nueva .local-state/native-bindings-s3-durability-fresh.db con Portless agent-chat-native-bindings-s3-durability. El caso de supervisor y proveedor persistente separado pasó en12.8s. No hubo inferencia real ni cambios de producción, push o PR. El servidor temporal se cierra al terminar.

S3-F1 corregido por el autor; cierre independiente pendiente. S0 sigue parcial y S4 no comienza hasta cerrar el hallazgo. Se mantienen los hashes aprobados del diseño y outline.
