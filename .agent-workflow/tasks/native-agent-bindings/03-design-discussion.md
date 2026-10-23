# Diseño r1: identidades vinculadas a runtimes nativos

Estado: propuesta para revisión del dueño. Fecha: 2026-10-23.

## Cambio de dirección

El receptor actual conserva una conversación propia de Codex y elimina herramientas y configuración personal. El resultado solicitado es que Agent Chat sea un canal para agentes que el dueño administra en Hermes, Grok Bot o Codex.

Este diseño reemplaza el supuesto de worker genérico sin herramientas para los bindings nativos. Las herramientas disponibles y sus aprobaciones se resuelven en el runtime original. La capa de transporte no amplía esos permisos ni transforma un mensaje de grupo en una autorización del dueño.

## Modelo de identidad

| Entidad | Responsabilidad |
| --- | --- |
| `ChatIdentity` | Autor visible y membresías en Agent Chat, con ID estable |
| `RuntimeTarget` | Proveedor, host/conector y referencia local a profile o bot; configuración propiedad del runtime |
| `Binding` | Une una identidad con un target, una revisión y grupos autorizados; solo el dueño lo cambia |
| `ConversationMapping` | Relaciona binding+grupo con sesión/hilo nativo o modo de contexto explícito |
| `ConnectionGrant` | Conexión automática limitada al binding o conexión interactiva con identidades permitidas |
| `Delivery` | Evento, intento, claim, referencia de ejecución, resultado y recibo de publicación |

Un target local se distingue por ID del conector y referencia estable del profile; no por el nombre visible solamente. Renombrar o borrar un profile invalida la referencia hasta reconciliarla; no permite caer silenciosamente en `default`. Para Grok Bot, la ruta de rutina registrada queda asociada al bot declarado y debe demostrar esa asociación mediante pairing. No se presupone una API para enumerar bots.

Un profile de Codex incluye referencia de configuración y workspace, pero la sesión por grupo se crea o retoma aparte. El binding no apunta a la última sesión abierta. El inventario anuncia solo targets seleccionados por el dueño y metadatos permitidos, sin subir prompts, tokens ni archivos personales.

## Vinculación y operación

1. El dueño elige una identidad y un target en su host o cuenta.
2. Un challenge de un solo uso vincula la conexión con ese target y demuestra un viaje de ida y vuelta. Para un bot sin API de identidad, la UI explica qué asociación verificó el dueño y qué verificó el challenge.
3. La UI muestra proveedor, nombre nativo, host o nube, workspace cuando corresponda, grupos habilitados y capacidades comprobadas.
4. La conexión recibe un grant limitado a ese binding; no recibe autoridad para otras identidades ni para habilitar grupos nuevos.
5. Un test de diagnóstico comprueba recepción, contexto, herramientas permitidas y retorno. Solo entonces se habilita la recepción automática para los grupos elegidos.

Un cambio de target o configuración relevante incrementa la revisión. Con trabajo incierto en curso queda bloqueado el relevo de ese binding. Una pausa impide nuevos inicios y publicaciones; no afirma deshacer acciones ya realizadas ni detener una tarea nativa si su API no permite confirmarlo.

El dueño conserva la personalización donde ya la usa: herramientas, instrucciones y memoria del runtime. La UI ofrece revisar el target y la actividad. Crear una conversación nueva en un grupo es una acción explícita, respaldada por el runtime; no ocurre al abrir otra ventana de Codex.

## Transporte y protocolo común

La inbox durable sigue siendo la fuente de pendientes. Una notificación es un aviso; su pérdida no pierde el mensaje. Se mantienen las reglas existentes que producen eventos de inbox durante la migración. Cambiarlas no forma parte de esta propuesta.

Para conectores propios se prefiere long poll o stream saliente con recuperación por cursor. No se requiere un webhook público en cada computadora. Para Grok Bot, el dispatcher llama al webhook de una rutina del bot; el cuerpo inicial lleva una referencia opaca de entrega y versión, evitando copiar conversación o autoridad al webhook.

Operaciones conceptuales nuevas, todavía sin nombre definitivo de API:

- `claim`: obtiene un evento autorizado y una autorización de inicio, ligados a binding, revisión, controlador y grupo.
- `started`: registra o reconcilia la referencia nativa antes de considerar que el trabajo puede retomarse. Persistir intención precede al despacho.
- `complete`: guarda resultado inmutable y una decisión `reply` o `no_reply`; valida acceso y revisión vigentes.
- `publish`: publica con idempotencia y confirma el evento en una misma transacción local. Repetir devuelve el recibo existente.
- `status/reconcile`: consulta la ejecución nativa y el resultado durable; nunca regenera ante incertidumbre sin evidencia positiva de que no se inició.

La máquina de estados distingue `queued`, `claimed`, `start_uncertain`, `running`, `awaiting_approval`, `result_saved`, `done`, `needs_review` y `cancel_requested`. `done` conserva decisión, recibo y motivo de supresión cuando corresponda. Un HTTP aceptado no confirma la inbox. El silencio del proveedor no significa `no_reply`.

La política de concurrencia inicial es una tarea automática activa por target. Los grupos mantienen contexto separado; esperan en cola. Los límites nativos de concurrencia también se respetan. Una conexión obsoleta no puede completar trabajo de una revisión nueva.

Garantía ofrecida: publicación deduplicada y pendientes recuperables en Agent Chat. No se promete ejecución exactamente una vez de un modelo o de sus efectos externos. El runtime y sus herramientas deben manejar sus propias acciones idempotentes y aprobaciones. Ante inicio ambiguo se conserva el bloqueo, aunque una inferencia de coordinación duplicada ya haya ocurrido en un proveedor externo.

## Hermes: canal nativo como camino preferido

Recomendación: plugin de plataforma `agent_chat` en el gateway existente. El plugin recibe eventos mediante conexión saliente, construye el origen con profile y grupo estables y devuelve respuestas por el protocolo común. Se integra con las sesiones y autorizaciones del gateway.

No se habilita `trusted_inbound`. El transporte autentica Agent Chat y el binding; el evento conserva el ID real del remitente. El dueño autoriza qué grupos y remitentes pueden activar ese profile y el gateway aplica esa autorización. El plugin no ejecuta comandos de control de Hermes recibidos como texto ni suplanta al dueño para saltar allowlists.

El conjunto de herramientas del nuevo canal debe configurarse explícitamente con el equivalente elegido por el dueño; no se copia a ciegas el conjunto reducido del webhook ni se habilitan todas las herramientas. Configuración personal no garantiza que dos superficies de Hermes tengan defaults iguales.

Alternativa seria: conector hacia API de runs. Tiene mejor contrato documentado de idempotencia, consulta y continuidad, y puede ser más pequeño que un plugin. Antes de adoptarlo debe demostrar paridad de instrucciones, tools y aprobaciones con el profile, más acceso desde el host del conector. El spike compara ambas opciones con criterios verificables; si runs cumple, puede reemplazar al plugin sin cambiar identidad ni protocolo común. El relay experimental queda diferido.

La conversación se mapea por binding+grupo. No se promete una conversación de Telegram ya existente: eso mezclaría audiencias. Se conserva memoria del profile según las reglas nativas, pero se exige separación de transcript entre grupos. La prueba debe inspeccionar sesiones desde una superficie soportada de Hermes.

## Grok Bot: rutina del bot como receptor

Recomendación: una rutina webhook propiedad del bot seleccionado. No se crea otro bot ni se llama a la API de modelos en su lugar. El wake-up solo entrega referencias; la rutina reclama el evento y devuelve el resultado mediante una integración autenticada de Agent Chat accesible desde su entorno.

El camino de retorno preferido es MCP/connector de Agent Chat con grant del binding. Si esa cuenta no permite ese conector, puede usarse un helper de callback con credencial limitada. Ambos requieren prueba real antes de declarar el adaptador compatible. No se usa automatización de clicks como transporte permanente ni endpoints privados de la app.

El trigger puede duplicarse y un timeout no acredita que no inició el bot. El claim server-side impide que dos ejecuciones publiquen dos resultados para el mismo evento. Si la rutina no confirma inicio/resultado, queda `needs_review`; no se reenvía indefinidamente un webhook ambiguo.

La documentación confirma rutina por bot, pero no aislamiento de conversación por grupo en un mismo bot. La UI debe declarar `context_mode` como capacidad: `native_per_group`, `shared_bot_context` o `unsupported`. La primera versión exige `native_per_group` para habilitar un bot en varios grupos; si no se puede demostrar, permite un solo grupo por binding/bot y explica el contexto compartido nativo. Nunca presenta separación inexistente.

No se guardan tokens de varias identidades en archivos compartidos de la computadora del bot. La documentación dice que los bots de una cuenta comparten archivos y credenciales locales. Los grants permanecen en el backend del conector cuando la plataforma lo permite; un helper local requiere reconocer ese límite de confianza, sin prometer aislamiento entre bots de la misma cuenta.

## Codex profiles y modo interactivo

El target Codex se ejecuta con profile y workspace explícitos y conserva las reglas y herramientas configuradas. No aplica el catálogo recortado ni `--ignore-user-config`. Si la política requiere una aprobación que el adaptador no puede tramitar, informa bloqueo; no cambia a permisos más amplios para continuar.

Ese proceso tiene sus propias conversaciones. Abrirlo con un profile no lo convierte en una sesión visible en T3; el visor de Agent Chat muestra referencias y actividad soportada, y el acceso al transcript nativo se prueba por separado. Adoptar este hilo existente o inyectarle turnos queda fuera del diseño.

El modo interactivo usa una conexión distinta, concedida por el dueño, con una lista de identidades y grupos permitidos. Cada escritura requiere `as_agent_id` explícito o un contexto seleccionado visible y confirmado. El servidor comprueba grant, scopes y membresía en cada llamada. No se confía en que el modelo diga que está autorizado.

El envío interactivo queda auditado como tal y no confirma automáticamente eventos del receptor permanente. Por defecto no tiene `claim/complete/ACK` de automatización. Si el dueño quiere tomar un pendiente, debe usar una operación explícita de pausa y transferencia que respete trabajo en curso; el simple envío no equivale a tomar control.

## Permisos propuestos

| Actor | Puede | No obtiene por defecto |
| --- | --- | --- |
| Dueño autenticado | Vincular, habilitar grupos/remitentes, pausar, revocar, inspeccionar y reconciliar con evidencia | Bypass de una ejecución incierta |
| Conector automático | Leer/reclamar y completar eventos de su binding y revisión vigentes | Configurar target, ampliar grupos, ACK legacy o elegir otra identidad |
| Codex interactivo | Leer/escribir con las identidades y grupos concedidos | Cambiar bindings, consumir inbox automática o autorizarse identidades nuevas |
| Mensaje recibido | Aportar contenido y contexto | Modificar configuración, permisos o identidad |

Los nuevos grants/scopes se conceden con consentimiento explícito, fuera de defaults legacy. Los clientes actuales de una identidad conservan su contrato; no reciben selección múltiple ni autoridad automática por actualizarse.

## Disponibilidad, observabilidad y retención

Estados visibles separados: conector alcanzable, target verificado, grupo cubierto, rutina habilitada, esperando aprobación y trabajo incierto. Un webhook aceptado se muestra como aceptación, no como respuesta publicada. La UI indica el host que debe permanecer encendido y si el bot trabaja en nube.

Grok Bot necesita una ruta de retorno HTTPS accesible; `.localhost` no cumple ese requisito desde nube. El despliegue público o túnel autenticado se elige durante implementación con el dueño. Para disponibilidad real 24/7, tanto Agent Chat como sus conectores necesarios deben correr en infraestructura disponible; poner solo el bot en nube no alcanza.

Se registran evento, binding/revisión, origen automático/interactivo, referencia de ejecución, estado, errores redactados y recibo. No se publican razonamientos privados, secretos ni resultados completos de herramientas. El visor del dueño muestra entrada autorizada, respuesta, decisión y referencia nativa con frescura.

Propuesta de retención: resultados no publicados o inciertos se conservan hasta resolución explícita; no se purgan para liberar una reserva. Después de completar+ACK, copias operativas de cuerpos se purgan a los 7 días y registros de deduplicación sin cuerpo a los 30 días. Después de ese plazo un evento terminal no vuelve a generarse por reaparecer una notificación. Mensajes publicados siguen la política de conversaciones; el contexto nativo sigue la política del proveedor, y se informa que la purga de Agent Chat no lo elimina.

Backoff y límites de notificaciones evitan tormentas; se incluyen supresión de ecos propios y detección de ciclos entre bots antes de ampliar activaciones entre agentes. Los límites de frecuencia no equivalen a una cota económica: el consumo y las aprobaciones nativas siguen aplicando.

## Migración propuesta

Conservar historial, identidades y recibos actuales. Registrar el receptor genérico como target legacy. Vincular primero un target nativo de prueba; comprobar ida y vuelta y sus capacidades. Para cambiar una identidad real, pausar el binding anterior, reconciliar trabajos y activar el nuevo con otra revisión. No ejecutar ambos consumidores sobre la misma inbox. Mantener rollback al target anterior solamente cuando no exista ejecución incierta.

El receptor actual no se pausó ni se migró durante esta investigación.

## Pruebas exigidas antes de habilitar cada adaptador

1. Pairing de dos profiles/bots con nombres similares; responder desde el target elegido, rechazar target cambiado y mostrar configuración efectiva sin secretos.
2. Navegador → mensaje → inbox → runtime original → resultado → publicación+ACK. Mostrar la actividad en Hermes/Grok Bot mediante superficie soportada; no inferirla del texto de respuesta.
3. Dos mensajes con continuidad por grupo y dos grupos con aislamiento declarado. Si Grok Bot no puede aislar contexto, impedir configurar el segundo grupo para ese bot.
4. Herramienta de prueba permitida sobre un directorio temporal y aprobación nativa cuando aplique. Rechazar una acción fuera del permiso sin ampliar políticas.
5. Caída antes/después del inicio, recepción HTTP perdida, reinicio de conector/gateway y estado nativo expirado. Recuperar resultado original o mantener incertidumbre, sin regenerar por timeout.
6. Webhook duplicado, callback duplicado y callback viejo tras cambio de binding: una publicación o rechazo verificable. ACK solo al resultado confirmado.
7. Pausa/revocación/remitente no autorizado: no iniciar trabajo nuevo ni revelar contenido revocado. No afirmar que una acción externa en curso fue revertida.
8. Codex interactivo elige entre identidades concedidas; otra identidad es rechazada. Su publicación no modifica claims del receptor.
9. Rutina pausada, host caído, pérdida de red y límite del proveedor: estados honestos y pendientes recuperables. Prueba desde la red real de Grok Bot.
10. Unit, contratos, integración, lint, typecheck, build y E2E con adaptadores falsos deterministas, más aceptación real separada para cada runtime. Los tests del worker genérico no se cuentan como aceptación nativa.

## Decisiones del usuario y propuestas

Confirmado por el usuario: conservar identidad, tools y prompts; priorizar Hermes y Grok Bot permanentes; permitir uso explícito desde Codex; hacer research y diseño antes de implementar.

Propuesto en r1: target estable separado de conversación; canal nativo para Hermes con comparación contra runs; rutina webhook para Grok Bot; grants interactivos separados; un solo grupo por bot si no demuestra aislamiento; no relevo ante ejecución incierta; migración sin cambiar el receptor durante research.

Pendiente de evidencia, sin bloquear la discusión del contrato: bot concreto de Grok Bot, interfaz de retorno disponible en esa cuenta, capacidades efectivas de Hermes y ruta de red del despliegue. Deben cerrarse con spikes acotados antes de activar el adaptador correspondiente. Si no hay retorno soportado o paridad nativa, se informa incompatibilidad; no se sustituye por otro modelo.

Registro de aprobación:

- Gate: `native-agent-bindings/design-r1`.
- Decisión solicitada: aprobar el contrato y recomendaciones anteriores para preparar un outline con spikes y aceptación.
- Exclusiones: implementación, activación de rutinas, migración de servicios, publicación de endpoints y gastos de pruebas reales nuevos.
- Artefacto: este archivo, r1; hash en `90-verification.md`.
- Dueño: Ramiro.
- Estado: propuesto. No se registró aprobación de r1.
