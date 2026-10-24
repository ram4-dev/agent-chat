# S4: adaptador Hermes por profile

## Alcance

Rama feat/native-agent-bindings, worktree y autorización de continuidad registrados en08. Base856cf0e. S3-F1 cerrado por revisión independiente de d52f498, registrada en17. Diseño03 y outline04r2 conservan sus hashes aprobados.

Se elige el transporte runs del outline. El adaptador usa el API nativo del profile y una extensión de consulta registrada mediante el hook soportado de plugins. El profile, target, endpoint y firmante vienen de configuración del dueño. Los mensajes no seleccionan módulos, prompts, herramientas, modelo ni política de aprobación. El toolset del canal sigue siendo una elección explícita del dueño.

La sesión estable usa binding+grupo+generación y conserva el remitente real en turn_author. Agregar o alternar participantes no cambia la sesión. El cuerpo del evento incorpora trusted_inbound=false como dato y no despacha comandos administrativos del gateway.

## Gates Hermes NB-F2/F3

- Terminación: el código nativo inspeccionado persiste completed después de esperar al ejecutor. El plugin comprueba estado persistido, completed, partial/interrupted y tarea activa antes de ofrecer resultado. Los módulos relevantes tienen hashes fijados; otra versión bloquea la capacidad.
- Aprobación: no es resultado terminal. Se observó waiting_for_approval, herramienta sin ejecutar y entrega sin publicar hasta aprobar el request_id correcto. Un ID incorrecto es rechazado.
- Silencio: se reconoce únicamente la señal explícita del filtro nativo fijado. Un resultado vacío o desconocido no confirma la inbox.
- Cancelación: la prueba reproduce cancelled con workerCount>0 después de cancelar el handler. No se firma como quiescente. El adaptador declara cancel=false; fallo/interrupción/cancelación conservan incertidumbre.
- Despacho tardío: la ausencia de clave nativa permanece unknown. La recuperación nunca repite el POST de creación. La reserva consumida del controlador y del servidor no caduca por timeout.
- Sesión: dos participantes comparten historial del mismo grupo; el segundo grupo usa otra sesión. Dos profiles temporales conservan personas e historiales diferentes. El reinicio del gateway conserva el resultado y el contexto del primer grupo.

## Recuperación y almacenamiento

El hook de plugins añade GET con autorización y resolución de profile nativas. Consulta directamente la tabla de idempotencia fijada y status_for_run de lectura; no invoca lookup nativo porque ese método también poda/escribe. Verifica el fingerprint original y no expone un resultado de otro cuerpo. Nunca crea ni reserva una clave.

El E2E corta la llamada native_running antes de llegar al servidor: Agent Chat conserva run_ref=null, Hermes ya completó. Luego cierra controlador A, reinicia el gateway y arranca controlador B con SQLite vacío. B recupera por clave, firma el resultado, publica y confirma sin ninguna completion nueva en el proveedor reiniciado.

Journal Hermes local con FULL comprobado, identidad inmutable y consumo antes de POST. Resultados/evidencias se guardan antes de devolver terminal. Pendientes sin recibo se conservan; con recibo se purgan cuerpos/evidencia tras7 días y permanecen tombstones. Inicio consulta hasta100 recibos locales pendientes; falta de autorización conserva el contenido pendiente. Contexto/retención del propio Hermes se rigen por su configuración nativa.

## Evidencia y límites

Pruebas con Hermes original d923a5eb487a17c0a68801bba9ef0f56c81040a8, código versionado archivado, HOME/managed scope temporales y proveedor falso. No se modificó AIAgent ni el adaptador API nativo. El proveedor, fault injection y observación de workers están en un servidor de fixture separado. La herramienta terminal de aprobación solo elimina un directorio vacío temporal del fixture.

El recorrido de producto usa navegador, OAuth, pairing automático, servidor real, supervisor compilado, adaptador desplegable y gateway Hermes. Capturas .local-state/hermes-01-recovered.png y hermes-02-approval-silence.png; la segunda inspeccionada visualmente: autores, respuesta aprobada y silencio sin publicación correctos. Estado legacy de conexión no acredita receptor nativo; su UI sigue en S7.

Aceptación con profile personal, herramienta temporal inocua y superficie nativa elegida por el dueño pendientes. Se solicitó nombre del profile; la selección no bloquea implementación aislada, pero sí activación personal. S0 permanece parcial para aceptación global. Grok bot requiere selección/callback/red y Codex profile corresponde a S6. No hay activación persistente, inferencia pagada, cambios de perfiles personales, push ni PR.

## Verificación final

Lint/typecheck/build/diff check PASS. Unit153, contratos15, integración193 y E2E30 PASS:391 tests. Un skip legacy de inferencia real por opt-in (AGENT_CHAT_REAL_CODEX), sin confundirlo con el E2E Hermes ejecutado. E2E completo2.2min, DB nueva .local-state/native-s4-verification-20261023.db, Portless agent-chat-native-s4-check. Node26.11.1 produjo el aviso OIDC de runtime no LTS; no se atribuye validación Node22. Logs temporales /tmp/agent-chat-s4-verify.log y /tmp/agent-chat-s4-e2e.log. Revisión independiente pendiente.
