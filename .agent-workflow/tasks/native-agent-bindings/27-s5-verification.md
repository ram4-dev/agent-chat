# S5: implementación y verificación determinista

## Incremento

Rama feat/grok-notifications, base40ab8b8 y worktree registrado en25. Diseño03/outline04r2 sin cambios; SHA-25607bdc25dde6134073442de0e8c324c3824a0ef9ed3ea6d50f63f5aeb4bdc9d31 ycc58e304142ea8a1f0c019da642916d264f771ff081aa99a8e92c1b1e95d8e99.

- Adaptador Grok del bridge, journal SQLite con FULL comprobado y consumo antes de un único POST; configuración inmutable por target/binding/revisión/bot/grupo/destino. Envelope de referencias opacas; sin texto, historial, tickets, URLs de retorno o tokens.
- Transporte productivo:HTTPS443, hosts exactos aprobados, DNS público completo, IP fijada al socket, Host/servername correctos y verificación TLS conservada. Sin redirects ni retries automáticos. Cancelación después de DNS no puede iniciar un envío tardío.
- Migración0011 aditiva:provider_started. native_grok_begin valida grant automático/scopes/membresía/binding/fence/pausa/remitente/proveedor/startKey y consume una autorización de tarea, distinta del envío webhook, en transacción FULL. El flag no se libera por tiempo ni reinicio.
- native_save exige consumo remoto para Grok además de evidencia terminal firmada/resultados inmutables. Se reutiliza el retorno MCP de S3 y su publicación+ACK atómica. native_running admite respuesta coherente después de un callback rápido ya guardado/terminado, sin reabrir el resultado.
- Un grupo por binding Grok hasta probar separación nativa. Sin reclasificar grants legacy, scopes OAuth nuevos por defecto o conexión real modificada.

## Evidencia ejecutada

Lint, typecheck, build y diff check PASS.159 unit+15 contratos+199 integración+26 E2E=399 PASS. Seis E2E omitidos:cinco requieren instalación Hermes que el usuario excluyó y uno requiere modelo Codex real por opt-in. No se leyó ni modificó ~/.hermes. El test de cleanup de discovery usa ahora un CLI sintético para no consultar la instalación personal.

E2E completo final45.8s sobre DB nueva .local-state/grok-notifications-recheck-20261024.db y Portless agent-chat-grok-notifications-check. El E2E nuevo de Grok usa navegador, OAuth/pairing sintéticos, servidor nativo, supervisor compilado, lógica productiva de despacho y webhook HTTP local falso. Solo su puerto de transporte se compone en el fixture; el factory productivo no expone bypass local. Su firmante es sintético, no prueba que Grok real ofrezca terminal verificable.

Se verifican200 sin resultado/ACK; controlador B vacío después de aceptación; retorno autenticado y pérdida de primera respuesta native_save; callback idéntico duplicado; webhook duplicado sin regenerar; silencio; pausa/reanudación. El proveedor falso guarda su resultado y prueba en SQLite separado antes de callbacks. Los tests del módulo cubren consumo único, reinicio, supresión, permisos/membresía, proveedor incorrecto y restricciones de grupo.

Los tests específicos de red interceptan únicamente DNS/HTTPS en su propio archivo y comprueban parámetros productivos de conexión, mezcla DNS pública/privada, redirect y aborto. La integración del journal no usa respuestas de un bot real. Captura .local-state/grok-notifications-e2e.png inspeccionada:respuesta, autores, silencio y reanudación correctos; la etiqueta legacy «sin receptor activo» sigue pendiente de S7 y no representa al controlador nativo.

## Fallo encontrado y tratado

Primera suite E2E:25 PASS,6 skip,1 fallo de readiness del servidor temporal del E2E nativo existente. Falló antes de signup, sin error de mensajería. La prueba aislada pasó13.1s. Se añadió diagnóstico del output del proceso y señal fixtureServerReady después del import/arranque real; el test espera esa señal antes de probar el endpoint, en lugar de usar solo el anuncio previo de URL de Portless. No se incrementaron timeouts ni se quitaron aserciones. La causa puntual del primer timeout no se reprodujo; la repetición completa pasó26/26 con seis skips. Logs temporales /tmp/grok-full-check.log, /tmp/grok-full-e2e.log y /tmp/grok-full-e2e-recheck.log.

## Límites y continuación

S5 implementado para despacho y protocolo de retorno determinista; no habilitado en producción ni aceptado con Grok real. Decisiones/bloqueos en26-s5-decisions.md:atestación terminal auténtica, despliegue y conexión automática separada, rutina/bearer seguros, mapping al bot y host24/7. Sin mecanismo terminal soportado, auto queda bloqueado. No se interpreta HTTP200 ni texto del modelo como finalización.

No se enviaron mensajes reales a terceros, no se modificaron conexiones OAuth existentes ni se borraron datos del usuario. Los fixtures cierran sus procesos/temporales sintéticos; las dos DB del servidor de verificación se conservan. Sin push ni PR. Revisión independiente de seguridad/protocolos pendiente antes de cerrar el incremento.
