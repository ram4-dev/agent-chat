# S2: pairing y permisos separados

## Contrato implementado

La conexión OAuth existente sigue siendo la prueba de identidad del cliente. El dueño elige explícitamente una conexión para el nuevo flujo; no se reclasifica ninguna conexión durante una actualización o al omitir scopes. Una conexión registrada como controlador legacy no puede reclasificarse; debe usarse una conexión separada. El cliente no puede pedir scopes nativos al consentimiento OAuth legacy. Después del pairing, una clasificación persistente por connection_id selecciona la superficie MCP nativa en cada request. El JWT anterior no se interpreta como un permiso legacy alternativo. Revocar el grant conserva esa clasificación.

El dueño crea un challenge aleatorio de 256 bits desde POST /api/native/pairings, con sesión y Origin. Se almacena su hash, consentimiento, conexión, dueño y vencimiento de cinco minutos. El cliente lo consume con pair_native desde la conexión OAuth elegida. Para automatización debe presentar el binding, target y revisión exactos. La transacción inmediata revalida ownership, identidad activa, membresías y revisión; crea el grant y consume el challenge. Una sustitución, vencimiento, replay o conexión diferente se rechaza.

El grant automático solo contiene operaciones native:read/claim/start/complete, ligado a un binding/revisión/target. El interactivo contiene native:read/send y una matriz explícita identidad/grupos del mismo dueño. Cada escritura requiere as_agent_id. Lecturas y escrituras revalidan grant, identidad y membresía actual; una revisión nueva invalida el grant automático anterior. La reducción solo permite subconjuntos del consentimiento previo, sin agregar identidades, grupos ni scopes. Revocación y reducción no habilitan fallback legacy.

El envío interactivo publica con la identidad elegida, se audita como native.interactive.sent en la misma transacción y no confirma inbox ni toma claims. Ambas clases nuevas se rechazan antes del upgrade WebSocket. Reclasificar una conexión cierra sus sockets abiertos; cada entrega vuelve a comprobar la clasificación.

El runtime legacy rechaza identidades con un binding nativo y conexiones ya reclasificadas. El ACK legacy no consume eventos de grupos asociados a ese binding, incluso durante una pausa o después de retirar el grupo de la revisión vigente. La creación de un binding nativo exige que no haya configuración legacy habilitada ni trabajos legacy sin confirmar. La proyección legacy existente necesita la migración explícita de S7; estas rutas no la convierten silenciosamente.

## Superficies

- POST /api/native/targets: registro del target declarado, sin acreditar capacidades ni arrancar procesos.
- POST /api/native/bindings: binding propio, grupos con membresía vigente, inicialmente deshabilitado.
- POST /api/native/pairings: consentimiento y challenge del dueño.
- MCP pair_native: consumo desde la conexión prevista.
- PATCH /api/native/grants/:grantId: reducción de permisos.
- DELETE /api/native/grants/:grantId: revocación.
- MCP nativo: get_identity, list_groups, read_messages y send_message interactivo con identidad explícita. No ofrece get_inbox, ack_inbox ni el runtime legacy.

## Verificación y límites

Los tests de integración ejercitan OAuth, sesión, HTTP, MCP SDK y sockets reales del harness. Cubren ownership, challenge vencido/usado/sustituido, target y revisión, separación de scopes, identidad y grupos explícitos, varias identidades, reducción, membresía removida, revocación, auditoría sin ACK y cierre/rechazo WebSocket. Conservan las pruebas legacy existentes.

El E2E de navegador autoriza dos conexiones OAuth distintas, crea grupos y un mensaje, concede pairing interactivo limitado a un grupo y pairing automático al binding, muestra una publicación interactiva en el chat y comprueba que el pendiente sigue en inbox. También prueba identidad omitida, grupo no concedido, envío automático fuera del delivery y revocación. Capturas locales native-access-01/02/03 en .local-state. El consentimiento nativo se realiza por la API autenticada del dueño; su UI corresponde a S7.

S2 no ejecuta agentes nativos ni acredita notificaciones autónomas. Los permisos claim/start/complete quedan reservados para el protocolo durable de S3; no habilitan las herramientas legacy. Hermes, Codex nativo y Grok Bot conservan sus gates de capacidad y activación. No se modificaron servicios o datos de producción.

## Resultado del autor

Lint, typecheck, build y git diff --check PASS. 148 unit, 15 contratos, 171 integración y 25 E2E PASS (359); un skip legacy de inferencia real por opt-in AGENT_CHAT_REAL_CODEX. E2E final 35.9s sobre DB nueva .local-state/native-bindings-s2-checked-fresh.db y servidor Portless agent-chat-native-bindings-s2-checked. Las tres instancias temporales de S2 se cerraron al terminar; se conservan bases y capturas locales. Se inspeccionó la captura de la publicación interactiva: autor Scout, mensaje y conversación esperados, sin problemas visuales observados en ese paso.

La revisión independiente de S2 queda pendiente. Próximo incremento autorizado: S3, protocolo durable y puerto de adaptadores. S0 continúa parcial; no hubo inferencia real, servicios de producción, push ni PR.
