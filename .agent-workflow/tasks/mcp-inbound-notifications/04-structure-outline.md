# Outline r3: recepción automática de mensajes

Fecha: 2026-10-23. Base: diseño r3 aprobado por Ramiro con «bien aprubeo».
Estado: completo para revisión independiente, sin aprobación de implementación.
Repo inspeccionado: feat/ui-redesign, HEAD 50d0fa6. Archivos nuevos citados abajo
son destinos propuestos, no implementaciones existentes.

## Alcance y orden

Primero demostrar el puente local por WS y un turno real; después añadir el
transporte webhook remoto sobre la misma cola. Un hilo por agente/grupo, respuesta
automática en grupos habilitados y resultado válido `no_reply`. No se modifica
esta conversación ni se añaden menciones, autocompletado o una migración de MCP.

Cada slice incluye pruebas y un resultado observable. Un fallo de una condición
bloqueante detiene los slices dependientes; nunca se sustituye por un prompt que
prometa aislamiento ni por un worker falso en la aceptación funcional final.

## S0 — Demostrar control y aislamiento de Codex

Resultado: fixture reproducible que crea un hilo propio, inicia un turno, recibe
salida estructurada y comprueba que no dispone de herramientas de shell, archivos,
red (incluida búsqueda web) ni conectores ajenos, integrados o MCP. Usar App Server del propietario o API del host, sin retomar el hilo actual.
La inspección del hilo se hará desde el visor del dueño descrito en S4;
no se promete que aparezca como conversación de T3.

Archivos: pruebas nuevas de adaptador en `tests/integration/`, documentación de
capacidad en `90-verification.md`; adaptador y fixture en el paquete nuevo
`apps/bridge/`. Verificar antes el esquema real de App Server y las opciones de
restricción; no inventar flags. Capturar versión, opciones efectivas y herramientas
anunciadas, sin tokens ni mensajes privados. Sin herramientas MCP dentro del
worker: el puente entrega datos y publica el resultado validado.

Checks: prueba negativa con instrucciones para ejecutar comandos, leer archivos
acceder a red y llamar conectores; no deben existir llamadas ni cambios de archivos.
La aprobación exige evidencia del mecanismo del runtime que deshabilita esas
capacidades, configuración efectiva y catálogo completo, tanto al crear como al
retomar un hilo. Una respuesta que rechaza instrucciones no demuestra aislamiento.
Si alguna capacidad no puede excluirse o verificarse, S0 falla y bloquea auto. Probar
inicio de turno perdido y reconciliación por ID/historial, thread ocupado y salida
inválida. Un sandbox de escritura por sí solo no prueba ausencia de herramientas.

Prueba real: un turno con modelo y presupuesto acotado, usando un hilo de prueba,
no grupos reales. Si el host no permite imponer permisos mínimos, detenerse y
volver con evidencia y alternativa; no cambiar de proveedor ni ampliar permisos.
Se requiere fijar modelo y presupuesto antes de ese gasto; el diseño no aprueba
un monto o modelo concreto. No bloquear las pruebas deterministas por esa decisión.

## S1 — Inbox con consumidor autorizado y exclusión entre procesos

Resultado: un consumidor efectivo por agente/grupo, con lease y fencing del lado
del servidor. La identidad y conexión OAuth se obtienen del contexto autenticado;
no se aceptan agent_id arbitrarios enviados por el cliente.

Archivos existentes: módulos `inbox` y `agents`, repositorio de inbox, adaptador MCP,
contratos MCP y composición de servicios. Archivos nuevos: repositorio de leases,
migración SQL siguiente disponible y pruebas contracts/unit/integration.

Contrato: acquire/renew/release por grupo, conexión e instancia de consumidor;
TTL 30 s, renovación cada 10 s con reloj del servidor, fencing monótono persistente
y comparación transaccional. La identidad de instancia y los permisos se fijan
en los contratos de recuperación y autorización de esta r2, más abajo.
El fencing se comprueba antes de procesar, publicar y confirmar, y no basta con
un mutex del puente. La publicación automática debe pasar por una operación que
valide lease y publique en la misma transacción; comprobar lease en una llamada
y publicar mediante send_message sin comprobación atómica no sirve.

Mantener la vía legacy de clientes interactivos compatible. El puente usa una
clase de conexión distinta sin autoridad para send_message ni ack_inbox legacy;
solo sus operaciones automáticas con fencing. ACK manual explícito de un cliente
interactivo o del dueño cierra únicamente el evento y deja evidencia auditable. El procesamiento
automático revalida que el evento siga pendiente al publicar; si el ACK manual ganó,
no publica. Si la publicación ganó, el ACK manual no crea una segunda salida.
Una grant revocada o membresía quitada impide renew, publicación y ACK automáticos.
El resultado de una generación en curso se descarta para publicación tras perder
lease o permisos. No se promete cancelar una petición externa ya enviada.

Añadir filtro opcional por grupo a get_inbox para evitar inanición por backlog de
grupos deshabilitados, manteniendo el contrato anterior al omitirlo. No usar cursor
como ACK ni marcar como procesados eventos fuera del binding habilitado.

Checks: dos conexiones y dos procesos compiten, lease expira y se reasigna, un
worker antiguo intenta publicar/ACK, revocación entre lectura y publicación,
ACK manual concurrente, publicación idempotente y páginas de grupos deshabilitados.
E2E: el harness autentica dos consumidores; solo uno publica al recuperar el inbox.
Stop: no avanzar si la exclusión depende de memoria local o de dos llamadas separadas.

## S2 — Puente durable, OAuth propio y recuperación

Resultado: proceso explícito del dueño, conexión WS saliente y recuperación MCP.
OAuth propio reutiliza la identidad seleccionada; nunca se extraen tokens de Codex.

Archivos nuevos: `apps/bridge/` con módulos de configuración, OAuth/almacén opaco,
cliente MCP/WS, SQLite local, bindings, jobs y planificador. Actualizar workspace,
scripts, TS y configuración de tests cuando el paquete lo requiera.

Persistir jobs únicos por agente/evento y binding por agente/grupo, thread_id,
estado y fencing. SQLite es cola local y caché; el registro del servidor descrito
abajo es autoritativo para resultados y asignación de runtime. Estados según
diseño, con salidas persistidas local y remotamente antes de publicar.
Orden por secuencia por grupo; un turno activo por agente y por hilo. Arranque:
receptor + barrido de inbox + deduplicación; reconciliación periódica y reconexión
con backoff. Backlog paginado con filtro de grupo y permiso vigente.

Tokens fuera de SQLite de jobs, logs y repo; utilizar almacén seguro del sistema
con interfaz opaca, refresh coordinado por conexión. Revalidar refresh y revocación.
Una caída del almacén seguro pausa el binding, no recurre a texto plano. No leer
.env provisionados. Los secretos administrados se inyectan mediante vault-env.

Retención: aplicar la matriz por almacén y estado de r3, más abajo. Un resultado
generado o publicado sin ACK todavía es trabajo pendiente, no un job purgable.
No se borra contenido recuperable mientras pueda necesitarse para publicación. Cola durable máxima
1000 eventos por binding: al alcanzarla se pausa la ingesta local sin ACK y se
recupera después desde inbox; nunca se descartan mensajes para liberar espacio.

Checks: reinicio en cada transición, disco lleno, socket perdido, refresh rechazado,
duplicados y backlog, cola llena, pausado y reanudado. Unit/integration con clock y
worker falsos deterministas. E2E: puente detenido recibe backlog al reiniciar, sin
mensaje humano adicional. Aún sin activación automática en grupos de uso cotidiano.

## S3 — Turnos, publicación y ACK

Resultado: conectar adaptador probado S0 con S1/S2, un hilo persistente por binding,
salida `reply`/`no_reply`/`needs_review` validada por esquema, publicación idempotente.

Archivos: adaptador y coordinador en `apps/bridge/`, contratos de salida y tests.
Solo mensajes humanos disparan turnos inicialmente. Mensajes de agentes se registran
como ignorados y se confirman sin activar modelos; no hay cadenas agente-agente.
No se requiere mención. Un reply máximo por evento. No_reply es terminal persistido;
needs_review conserva pendiente. Las entradas se encolan, sin steer por defecto.

Conservar exactamente texto y clave estable por evento al reintentar publicación.
ACK automático solo después de respuesta publicada confirmada o no_reply persistido,
con fencing vigente. Si se pierde el resultado de iniciar un turno, reconciliar
antes de reintentar; ante ambigüedad needs_review. Limitar 30 activaciones/hora
por agente, sin acumular créditos tras reinicio; pausa visible al agotarse. El
presupuesto económico y modelo deben quedar fijados antes de la prueba real.

Checks: duplicados, salida inválida, crash después de generar/publicar/ACK, respuesta
perdida de publish y de turn/start, revocación y pérdida de lease durante generación,
mensajes de otros agentes, no_reply y cola con turno ocupado. E2E determinista usa
worker falso; se reporta por separado y nunca como prueba de modelo real.

## S4 — Estado y prueba funcional local con modelo real

Resultado: dueño puede habilitar grupos, pausar y ver autorizado, receptor conectado,
worker disponible, procesando, pausado o error, con IDs de hilo/turno y motivo.

Archivos: estado del puente y rutas autenticadas para administrar bindings, UI
existente de agentes/grupos en `apps/web/`, contratos HTTP y pruebas de accesibilidad.
El puente registra heartbeat autenticado; no se infiere disponibilidad por el socket.
Las operaciones de administración son del dueño, no tools disponibles al worker.
Sin heartbeat vigente se muestra desconectado; expira el lease de mensajería,
pero no se libera automáticamente una reserva de turno cuyo estado sea incierto.

Visor elegido: vista del dueño en Agent Chat, con entrada, salida validada, decisión,
estado de turno, eventos y errores por hilo. El puente sincroniza ese registro de
aplicación con el servidor mediante API autenticada; no se expone razonamiento
interno del modelo. Si no puede sincronizar, la vista muestra su última actualización
y estado no disponible, nunca un hilo supuestamente vacío. Verificar dueño y
membresía al leer; el worker y otros miembros no acceden al visor. Debe poder
abrirse desde cada binding y pausarse el grupo correcto; no solo mostrar IDs.
El visor refleja el contexto suministrado por la aplicación y las salidas efectivas;
no se presenta como copia de datos internos no expuestos por Codex.

Checks: autorización de dueño, labels/roles/foco, habilitar/pausar, presupuesto
agotado, permisos revocados, contador autorizado y ningún token/cuerpo en logs.
E2E: navegador visible en entorno de prueba aislado detrás de Portless. Persona
crea/abre grupo, añade agente, habilita binding, envía mensaje; sin escribir una
orden en Codex se observa turno real y respuesta en español con identidad correcta.
Capturas de configuración, mensaje entrante, procesamiento, respuesta/no_reply,
pausa, error y recuperación. Probar dos grupos con hilos distintos, turno ocupado,
bridge apagado y revocación. Abrir ambos hilos en el visor, comprobar separación,
contexto persistente tras reinicio y pausa del binding correcto. Datos de prueba
identificados, no mensajes a terceros.
Stop: sin modelo/presupuesto definidos o sin aislamiento S0 no hay aceptación real.

## S5 — Webhook HTTP firmado como transporte remoto

Resultado: transporte alternativo de avisos sobre los mismos jobs, sin duplicar
modelo ni ACK cuando WS y HTTP entregan el mismo event_id.

Archivos: migración outbox, módulo y dispatcher servidor, receptor HTTP del puente,
configuración de destinos por dueño y tests. Los callbacks solo llevan IDs.
Outbox y evento se guardan en la misma transacción. Registro por destination_id
preaprobado; no URLs de un modelo. OAuth/scope de administración explícito antes
ofrecer herramientas administrativas. Revocación pausa nuevas entregas.

Firma Standard Webhooks sobre bytes originales, ID estable y timestamp por intento,
rotación de claves, reloj 5 min. HTTPS verificado, sin redirects; validar IPv4/IPv6
y DNS en cada conexión, sin salto a redes privadas/metadata. Excepción local
estrecha documentada, jamás desactivar validación global de TLS. Timeout 5 s,
16 KiB, backoff con jitter 1 s–5 min y horizonte 24 h; mostrar fallo/redelivery.
202 solo tras commit local del aviso; persistencia fallida devuelve 5xx. Reintento
y redelivery mantienen ID y no confirman inbox. Recuperar inbox aunque el suscriptor
se registre después del mensaje.

Checks: firma errónea, replay, key rotation, cuerpo modificado, duplicados, 429/5xx,
timeouts, retry agotado, crash entre commit y respuesta, DNS rebinding, redirect,
IPv6 y URL interna, revocación y outbox creada antes de revocar. E2E local con
receptor tras Portless y mismo flujo de S4; prueba remota requiere destino autorizado
y accesible. Si no existe, documentar bloqueo externo, sin afirmar entrega remota.

## Contratos que cierran los hallazgos de r1

Estos contratos precisan las garantías del diseño r3; son propuestas para aprobar
con el outline, no funciones existentes. Cualquier desviación que debilite estas
garantías vuelve al diseño antes de implementar.

### Recuperación y resultado autoritativo — F1

Agregar en S1 un registro de procesamiento único por `(agent_id, event_id)` en el
servidor: binding, runtime/thread, instancia, fencing, reserva de turno, decisión,
texto de salida, clave idempotente y recibo de publicación. Estados diferenciados:
reserved/running, generated, published, no_reply, ignored, manually_acknowledged,
acknowledged y needs_review. Guardar message_id real y estado previo al ACK;
manual ACK no puede fingir un resultado publicado. Las salidas se escriben una
sola vez; si difieren en un retry, responder conflicto sin mutación.

La operación automática de publicación valida permiso vigente, evento pendiente,
lease/fence y resultado guardado, y crea mensaje + recibo en la misma transacción.
No se deduce éxito solo de una clave que dio conflicto. Una consulta autenticada
por evento devuelve el recibo y contenido originalmente publicado. `no_reply` e
`ignored` también se guardan en servidor antes del ACK automático.

Con dos SQLite locales independientes: A publica, pierde respuesta y cae; B
adquiere lease, consulta recibo, recupera mensaje y completa ACK con su fencing,
sin volver a generar. Si solo existe generated, B usa el texto remoto exactamente.
Si no hay resultado y no puede reconciliarse el turno del runtime original, queda
needs_review: no se regenera. En grupos revocados se deniega consulta de contenido.
Los recibos/decisiones sin cuerpo se conservan mientras exista su evento, incluso
tras purgar contenido; la política de borrado del puente no borra deduplicación.

### Propiedad de runtime y exclusión de generación — F2

Separar lease de mensajería de reserva de ejecución. Cada proceso registra una
instancia aleatoria única por arranque; el servidor emite una capacidad privada
vinculada a conexión/instancia, que no se comparte en el token OAuth. Compartir
OAuth entre procesos no les da la misma instancia ni su capacidad. Las credenciales
de instancia se almacenan opacamente y no son accesibles al worker.

Cada binding se fija a un runtime propietario y thread persistidos en servidor.
El runtime tiene un único controlador verificado (exclusión local entre procesos
y propiedad del proceso App Server). Un segundo puente puede recuperar un recibo
y hacer ACK, pero no retomar a la fuerza un hilo ni iniciar otra generación. No
hay migración automática del runtime entre máquinas en este alcance.

Antes de turn/start se reserva transaccionalmente un slot global por agente con
instancia, runtime, grupo y evento. Solo un slot activo por agente, incluso entre
grupos y conexiones. La reserva se guarda ANTES de enviar turn/start. Se registra
turn_id al recibirlo. Ni TTL del lease ni pérdida de heartbeat liberan ese slot:
un turno puede seguir corriendo. Una petición de inicio con resultado ambiguo
mantiene el slot bloqueado hasta reconciliar el runtime original.

Un controlador vencido no puede conseguir otra reserva ni publicar. Si recibió
permiso antes de una partición puede terminar el turno ya reservado; ningún otro
controlador inicia uno nuevo mientras no se demuestre fin/quiescencia de ese turno.
En recuperación, solo el controlador propietario reconciliado o el procedimiento
limitado de recuperación del dueño descrito en r3 puede cerrar su reserva. La
recuperación nunca vuelve a consumir una autorización de inicio ya gastada. Si no puede determinar si el turno sigue activo, todos los
grupos del agente quedan needs_review para generación, sin impedir recuperar
recibos terminales. Las solicitudes duplicadas de inicio nunca reutilizan una
reserva para otro turno. El limitador de 30 activaciones/hora también se persiste
centralmente por agente con reloj servidor, no por proceso.

Cambiar runtime/hilo requiere pausa, evidencia de que el controlador anterior
terminó y que no hay turnos activos o iniciables, y restauración verificada del
contexto. Sin esa evidencia se mantiene bloqueado; no hay botón de forzar relevo
que permita dos escritores. La resolución manual no puede borrar una reserva
incierta y luego habilitar un turno sin demostrar quiescencia.

Checks adicionales: dos procesos comparten OAuth, dos grupos compiten por slot,
partición con generación en curso, turno enviado sin respuesta, lease reasignado,
segundo almacén sin contexto y replay de una autorización de inicio. Un test debe
contar invocaciones del adaptador y comprobar que el nuevo consumidor no genera.

### Autoridad de ACK y scopes — F3/F5

Nueva clase de conexión `bridge`, fijada por el servidor durante consentimiento
explícito del dueño. La clase no puede pedirse como parámetro por llamada ni
convertirse mediante refresh. Grants antiguos siguen siendo clase interactiva;
no se migran ni reciben autoridad automática por defecto. Registrar un cliente DCR
por sí solo no concede la clase bridge ni habilita grupos.

| Operación | Actor y permiso obligatorio | Control adicional |
|---|---|---|
| Lecturas get_identity/get_groups/read_messages/get_inbox | Interactivo según contrato actual; bridge con agent:read/agent:inbox según operación | Membresía y conexión vigentes |
| WS /ws/agent | Conexión con agent:receive | Identidad, expiración y revocación vigentes |
| Lease, reserva, resultados y recibos automáticos | Solo clase bridge con nuevo bridge:process | Binding habilitado y conexión/instancia autorizadas |
| Publicación automática | Solo bridge con bridge:process y agent:send | Resultado guardado, evento pendiente y fence en transacción |
| ACK automático | Solo bridge con bridge:process y agent:inbox | Resultado terminal o recibo, evento/instancia/fence en transacción |
| send_message/ack_inbox legacy | Solo clase interactiva según autoridad legacy vigente | Denegación explícita de clase bridge antes del handler legacy |
| Habilitar/pausar, ACK manual del dueño y visor | Sesión HTTP del dueño autenticada | Propiedad y defensa CSRF; no accesible al worker |
| Aprobar modelo/presupuesto y revocar política | Sesión HTTP del dueño autenticada | Política versionada; no existe autorización predeterminada |
| Reconciliar/cerrar reserva y recuperar controlador | Sesión HTTP del dueño + prueba técnica del runtime | Solo metadatos, incluso pausado/revocado; sin lectura de contenido ni autoridad de publicación |
| Destinos, suscripciones y redelivery HTTP | Sesión HTTP del dueño | Destino preaprobado, sin tools administrativas MCP en este alcance |

Scopes nuevos no se añaden a la lista que concede todos al omitir scopes. Separar
la lista legacy por defecto de permisos bridge explícitos; obtener consentimiento
nuevo para bridge:process y mostrar agente/grupos/autoridad antes de concederlo.
Una clase bridge no puede pedir ni ejercer una vía legacy, incluso si presenta un
token con agent:send o agent:inbox. Reducir scopes, quitar membresía o revocar grant
invalida operación automática y renovación, incluidos recibos con contenido.
La capacidad de instancia no sustituye OAuth ni permite saltar esos controles.

ACK manual cierra solo ese evento; no invalida el lease entero del grupo. En la
misma transacción marca manually_acknowledged si no había resultado terminal y
suprime publicación posterior de ese evento. No libera un slot de generación
activo. Si publicación/no_reply ganó, conserva el resultado y lo confirma. ACK
automático requiere una decisión terminal persistida y nunca usa la ruta legacy.
El bridge viejo con fence vencido falla incluso si intenta ack_inbox o send_message
legacy. Si un dueño utiliza otra conexión interactiva, esa es su acción explícita;
no se entrega esa credencial al puente ni al worker.

Checks: grants antiguos sin privilegios nuevos, consentimiento rechazado, scope
omitido o insuficiente, reducción por refresh, cliente bridge intentando cada vía
legacy, dos instancias con misma conexión, ACK manual vs reply/no_reply, ACK
manual durante generación sin liberar slot y revocación concurrente al commit.
Omitir filtro de grupo en get_inbox conserva el contrato de lectura anterior.

### Evidencia del worker y visor — F4/F6

S0 valida herramientas integradas, MCP y red mediante configuración efectiva del
runtime también al retomar; pruebas adversarias solas no lo acreditan. S4 provee
visor de aplicación autorizado por dueño. Ni un ID de hilo ni una conversación
creada por un App Server externo equivalen a un hilo visible de T3. Probar apertura,
separación de contexto, salida no_reply, estado incierto, pausa y control de acceso.

## Precisiones de r3 tras la segunda revisión

### Inicio de turno, consumo y reconciliación — F7

El único despachador que puede llamar turn/start pertenece al runtime propietario.
Su exclusión se impone con bloqueo de proceso y almacenamiento durable del runtime;
no se entrega una autorización a dos despachadores. Cada reserva tiene start_id
único y una autorización de un solo uso, ligada a instancia y época de controlador.
Antes de escribir al canal App Server, el despachador hace compare-and-set durable
`unused -> consumed` y fsync del registro start_id/request_id/thread_id/época.
Sin commit confirmado NO envía. Una autorización consumed jamás vuelve a unused,
ni tras crash ni al cambiar de controlador. El despachador rechaza replay de esa
autorización incluso después de cerrar el slot. El servidor conserva su tombstone.

La escritura del request al canal no se reintenta. Fallo entre consumed y write
puede perder una ejecución: se acepta esta pérdida de disponibilidad antes que
arriesgar dos inicios. Timeout o desconexión NO habilitan retry. Se persiste la
correspondencia con el turn_id devuelto por la respuesta de ese request y sus
eventos. S0 debe demostrar correlación inequívoca mediante el protocolo real del
runtime y registro de su transporte; no se inventa soporte idempotente de Codex.
Un mismo runtime tiene un solo start en vuelo y no comparte ese canal con usuarios.

Evidencia válida de cierre: resultado terminal positivo del turno correlacionado,
o prueba técnica soportada por el runtime de que esa autorización no puede producir
ahora ni después un turno activo. Historial vacío, estado idle momentáneo, ausencia
de turn_id, caída de heartbeat, término del cliente local o botón de confirmación
del dueño NO constituyen esa prueba. Si hay request enviado pero sin correlación
recuperable, conservar slot y gasto reservado en needs_review; no iniciar otro.
El dueño no puede eludir esta condición con un force-unlock.

Antes de cerrar una reserva se invalida su época/autorización para todo despacho
posterior; el despachador guarda el tombstone antes de devolver evidencia. No se
elimina un proceso antiguo suponiendo que la petición remota terminó. La recuperación
no reabre su canal ni retransmite requests. Si S0 no puede demostrar exclusión,
consumo durable, correlación y cierre positivo con la versión instalada, auto queda
bloqueado. No prometer disponibilidad bajo fallos que el host no permite reconciliar.

Checks S0/S3: request retrasado, crash tras consumed antes de write, tras write
antes de turn_id, replay de la MISMA instancia durante el turno y tras cierre,
request antiguo entregado después de un intento de cierre. Verificar que el slot
no se libera por idle y que no existen dos turn/start por start_id, contando todos
los despachadores, no solo el nuevo consumidor.

### Modelo, presupuesto y autorización antes de generar — F8

Añadir en S1/S4 una política versionada aprobada por el dueño en HTTP: modelo Codex
exacto, grupos, moneda, presupuesto por período, límite por turno y límites efectivos
de contexto/entrada/salida, incluido razonamiento facturable. Sin política aprobada
el presupuesto es cero y no se ejecuta ningún turno real, incluidas pruebas S0.
La orden de usar Codex selecciona proveedor para el trabajo; no fija un monto de
consumo automático. La habilitación de una prueba real requiere esa política y una
acción explícita de iniciar prueba con el costo máximo mostrado al dueño.

Antes de cada start, el servidor valida política vigente/modelo/grupo y reserva en
la misma transacción del slot el costo máximo conservador del turno y un crédito
de activación. Nunca basar el costo en 30 turnos/hora. Estimar con tarifa vigente
verificada y versionada, sin descuentos supuestos, acotando TODOS los tokens y
costos posibles por capacidades efectivas del runtime. Rechazar exceso de contexto
antes de enviar, sin truncarlo silenciosamente. Herramientas externas no habilitadas.
Si tarifa o máximos verificables faltan, o el runtime no permite imponer todos los
límites necesarios para esa cota, se bloquea el inicio; no se presenta una estimación
como límite de gasto garantizado. S0 incluye esta comprobación de capacidad.

Contabilidad central persistente por agente/política: presupuesto aprobado menos
gasto confirmado menos reservas inciertas. Solo iniciar si la cota completa cabe
en saldo y límite por turno. Al recibir uso terminal verificable se concilia y
libera únicamente la diferencia demostrada; ante uso/precio incierto se conserva
toda la reserva. No se libera por timeout, reinicio, revocación ni cambio de período.
El nuevo período resta también obligaciones no resueltas del anterior; no permite
eludir gasto incierto cambiando política o modelo. Reducir presupuesto no cancela
consumo ya iniciado; bloquea nuevas reservas si no hay saldo. Si no puede imponerse
la cota tras actualización del host o precios, auto se pausa antes del siguiente
inicio y exige nueva política validada.

Checks: política ausente/no aprobada/revocada, modelo distinto, límite de contexto,
reserva concurrente, máximo insuficiente, cuenta reiniciada, cambio de período con
uso incierto, pérdida de respuesta del runtime y cambio de capacidades/tarifa.
La prueba real permanece deshabilitada hasta fijar monto y modelo aprobados y
pasar estos controles. Las suites deterministas no disparan gasto de modelo.

### Recuperación limitada del controlador y cierre — F9

Separar permisos de iniciar/publicar de la facultad de cerrar una reserva segura.
La sesión HTTP del dueño puede solicitar recuperación incluso si el binding está
pausado o su grant revocada. El endpoint solo acepta evidencia técnica de cierre
de F7 y devuelve IDs/estado, no mensajes ni salidas revocadas. Una casilla que diga
«terminó» no es evidencia suficiente. El controlador anterior tampoco puede usar
esta vía para iniciar, publicar o leer tras revocación.

En reinicio del mismo runtime: la instancia nueva adquiere exclusión de proceso,
lee el registro durable del despachador y se autentica ante el servidor mediante
una capacidad de recuperación del runtime en almacén seguro, distinta del token
OAuth y de la capacidad efímera de instancia. Es una capacidad limitada para
presentar pruebas de cierre de sus reservas, no acceder a inbox ni generar. El
servidor permite verificar esas pruebas sin reactivar una grant revocada. El dueño
confirma la recuperación, el servidor invalida época/capacidades previas y asigna
nueva época/instancia, siempre bajo las condiciones de no despacho pendiente de F7.
Si falta el registro, la capacidad segura, la exclusión o la evidencia positiva,
no se realiza relevo ni se libera el slot.

La nueva instancia puede cerrar reservas seguras con autorización de recuperación;
no vuelve a consumir permisos de inicio antiguos. Reanudar procesamiento exige
grant bridge válida, scopes, binding habilitado y presupuesto aprobado. Pausa o
revocación no impiden registrar fin/uso y cerrar reserva probada, pero impiden
nueva generación, publicación y lectura de contenido. Una salida de un turno cuya
autoridad fue revocada no se publica por recuperación.

Checks por transición: pausa, revocación, reinicio con instancia nueva y grant
antigua inválida; cierre probado funciona sin revelar contenido; prueba falsa,
evidencia incompleta, controlador viejo y request retrasado fallan. Todos los
cierres conservan auditoría y tombstones. El dueño no puede habilitar otra máquina
sin el protocolo de quiescencia y restauración de contexto de F2.

### Retención por almacén y estado — F10

| Almacén / estado | Contenido recuperable | Metadatos y deduplicación |
|---|---|---|
| SQLite puente, pendiente/generated/published sin ACK/blocked/needs_review | Conservar hasta confirmación o resolución segura | Conservar mientras siga pendiente |
| Servidor, salida generated o published sin ACK, no_reply/ignored pendientes | Conservar salida inmutable hasta ACK o cierre manual seguro | Recibo/decisión distinguen publicación de ACK manual |
| SQLite y registro remoto de job confirmado por ACK | Purgar copia de entrada/salida a los 7 días desde ACK, nunca desde generación | Logs operativos 30 días; recibo/evento, clave/hash y tombstones mientras exista evento |
| Visor sincronizado del dueño | Misma copia/retención que registro remoto, sin duplicado independiente | Tras purga muestra «contenido vencido», IDs/decisión/fechas, no hilo vacío |
| Mensaje publicado de Agent Chat | Sigue política de mensajes existente; no lo borra el GC del puente | Recibo enlaza message_id, sin segunda copia del texto tras purga |
| Runtime Codex del dueño | Historia/contexto propios; NO los borra el GC de jobs | Su gestión queda bajo el dueño; se documenta por separado |

Un job con resultado terminal pero sin ACK no se considera completado para purga.
ACK manual durante generación no purga mientras la reserva siga incierta; el plazo
comienza solo al cerrar tanto evento como reserva de forma segura. Tombstones de
autorizaciones y start_id no caducan mientras pueda existir un permiso/request
reproducible; no se hereda la ventana de 30 días de logs. La política aplicada a
credenciales no cambia: quedan fuera de tablas de jobs/visor/logs.

Después de purgar una copia terminal no se regenera: el evento está confirmado y
el recibo lo acredita; si se consulta un published previo, se devuelve message_id
y estado, y contenido solo si sigue autorizado y disponible en mensajes. Pending
generated conserva el texto para retry exacto incluso tras 7/30 días y con un SQLite
nuevo. Probar esto con reloj controlado, además de GC concurrente con ACK/revocación,
contenido vencido en visor y persistencia de deduplicación tras todas las purgas.
El borrado de contexto del runtime por el dueño puede impedir continuidad; en ese
caso no se recrea hilo silenciosamente, se pausa hasta restauración verificada.

## Validación y gates

Antes de código: fresh Worktrunk worktree según skill, identidad y rama registradas,
conservar documentos de este paquete y trabajo ajeno; sin push ni PR. Revisión Codex
independiente del hash exacto; hallazgos críticos/controlantes exigen una nueva revisión y otra
revisión. El gate de implementación necesita aprobación explícita del outline.

Por slice: tests de comportamiento pertinentes, lint, typecheck y build; E2E del
flujo afectado con dependencias iniciadas por el agente. Al cierre ejecutar con
Node 22 `pnpm verify`: lint, typecheck, unit, contracts, build, integration y E2E.
Incorporar el nuevo paquete a estas suites; comprobar que descubren sus tests.
No contar suites sin archivos como éxito. Repetir validación manual real tras
cambios en activación/publicación. Actualizar README con arranque Portless, OAuth,
pausa/recuperación, límites, tests y limitación de menciones.

Registrar comandos/resultados, capturas, versiones y bloqueos externos en
`90-verification.md`. No existe evidencia de implementación en este outline.

Gate ID: inbound-outline-r3
Decision / allowed mutation: revisión independiente del outline; no implementar
Explicit exclusions: código, nuevos workers, credenciales, callbacks y gasto de modelo
Owning artifact / revision or hash: este archivo / r3; SHA-256 en 05-independent-review.md
Decision owner: Ramiro
Approved by / trusted identity: pendiente
Approved at: pendiente
Status: proposed
Invalidated by: hallazgos controlantes, revisión de diseño o cambio de alcance

Cambio r1 → r2: cierra por contrato F1–F6 de revisión Codex; requiere otra
revisión del hash exacto. Todo el trabajo y las revisiones usan Codex por orden
del usuario «hacelo todo con codex». Sin cambios de código ni evidencia funcional.

Cambio r2 → r3: consumo durable de inicio y evidencia positiva de cierre (F7),
política aprobada y reservas de presupuesto antes de generar (F8), recuperación
limitada sin autoridad de publicar (F9) y retención por estado/almacén (F10).
Sigue pendiente la revisión independiente de esta revisión y aprobación humana.
