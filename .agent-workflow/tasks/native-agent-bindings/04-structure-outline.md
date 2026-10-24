# Outline r2: agentes nativos

Fecha: 2026-10-23. Base: `488db69`, `feat/mcp-inbound-e2e`.
Diseño aprobado: SHA-256 `07bdc25dde6134073442de0e8c324c3824a0ef9ed3ea6d50f63f5aeb4bdc9d31`, registro en `06-approval-log.md`.
Estado: r2 incorpora los tres hallazgos major de la ronda 1; pendiente de nueva revisión independiente. No autoriza implementación.

## Reglas comunes y dependencias

Antes de escribir código: cargar `worktree-first-development`, crear un worktree nuevo desde la base con Worktrunk y registrar ruta, rama y commit. Preservar este paquete en la rama base mediante commit documental antes de separar la implementación. No tocar `main`, hacer push ni abrir PR. El receptor actual sigue operando hasta una migración explícita y verificada.

Secuencia: S0 → S1 → S2 → S3. S4, S5 y S6 dependen de S3 y se ejecutan secuencialmente. S7 integra capacidades y migración de prueba; S8 cierra verificación y operación. Se verificará cada slice antes de continuar. Ningún fallo de un adaptador habilita un reemplazo genérico ni obliga a bloquear adaptadores independientes ya verificados.

Todos los slices de código deben pasar lint, typecheck, build, unit, contratos, integración y el E2E pertinente con entorno aislado. Al cierre se ejecuta la suite completa. Si un slice solo cambia documentación, verificar referencias y consistencia. Nuevos tests deben quedar descubiertos por la suite; cero tests no cuenta como PASS.

Servidores locales mediante Portless y nombre aislado del entorno productivo. SQLite, perfiles, archivos y servicios de pruebas en directorios temporales. No leer valores secretos ni usar perfiles personales para pruebas destructivas. Secretos mediante `vault-env` o entrada privada soportada; las salidas registran referencias y errores redactados.

## S0. Pruebas de capacidades, sin migración

Resultado: decisiones de adaptador respaldadas por fixtures y evidencia reproducible. Se crean `07-native-capabilities.md` y fixtures versionados, sin declarar compatible un proveedor solo por ayuda o documentación.

Archivos previstos: `apps/bridge/src/adapters/`, `tests/integration/native-capabilities.test.ts`, fixtures bajo `tests/fixtures/native-runtimes/`; posible plugin aislado en `integrations/hermes/` si es necesario para comparar el canal. Los nombres finales se fijan al explorar el worktree.

Hermes: comparar canal de gateway contra API de runs en la versión instalada, con profile temporal y proveedor falso que registre la solicitud efectiva sin inferencia. Confirmar profile, instrucciones no sensibles, toolsets, workspace, sesión, observación y política de aprobación; comparar con la superficie nativa seleccionada, no con todos los defaults de Hermes. La prueba no modifica el core instalado. Probar dos grupos, reinicio e idempotencia conservando el almacén temporal. Preferir canal; aceptar runs si cumple todos los criterios y registrar la decisión antes de S4. Relay experimental queda fuera.

Hermes, criterio bloqueante de finalización: demostrar correlación durable delivery → ejecución → eventos intermedios → resultado terminal. El retorno de `handle_message` solo acredita despacho; un `send` puede ser progreso o solicitud de aprobación. Separar esas señales del resultado final mediante el hook de finalización del procesamiento y su outcome, o el estado terminal de runs si ese camino se selecciona. Debe existir evidencia explícita para `no_reply`; nunca inferirlo de ausencia de texto o timeout. Persistir decisión y salida antes de confirmar la entrega. Probar aprobación → respuesta final, varios envíos del mismo turno, silencio intencional y reinicio después de terminar pero antes de guardar el resultado en Agent Chat. Si el runtime perdió el resultado o no puede acreditar terminación, conservar `needs_review`, sin ACK, nuevo inicio ni liberación por silencio.

Hermes, criterio bloqueante de sesión: fijar una estrategia compartida por binding+grupo que conserve el remitente real para autorización y auditoría. `group_sessions_per_user=True` puede separar a los participantes; un grupo estable en SessionSource no basta. El spike debe demostrar un namespace/identificador de conversación del adaptador o un `session_id` explícito en runs que imponga el mapping sin cambiar globalmente otros canales. No suplantar a todos los participantes con un mismo ID. Si el plugin no puede lograrlo mediante mecanismos soportados, no aprobar ese camino. Probar participantes A y B alternando en el mismo grupo con la misma sesión, otro grupo con sesión distinta y ambas propiedades tras reinicio.

Grok Bot: preparar servidor falso con el contrato oficial webhook y callbacks; fijar el contrato de pairing y la rutina de prueba. La aceptación real requiere un bot elegido por el dueño, acceso de retorno soportado y una ruta HTTPS alcanzable desde nube. Este slice puede preparar todo localmente; no habilita rutinas ni publica red por su cuenta. Registrar capacidades desconocidas como no verificadas. La selección de un bot concreto y cualquier nueva exposición de red son datos/acciones necesarios antes de la prueba real, no motivos para bloquear S1–S3.

Codex: comprobar selección explícita de profile+workspace y crear/retomar sesión en un fixture temporal. Usar transporte falso para registrar tools y reglas efectivas sin activar herramientas contra el sistema real. Documentar que no adopta este hilo T3. La prueba con modelo real solo usa el profile/host de prueba que el dueño seleccione y límites operativos declarados; no implica garantía monetaria.

Checks: E2E determinista del harness de capacidades desde su entrypoint, proveedor falso y dos targets de nombres similares. Prueba manual pendiente por runtime: actividad visible en superficie nativa soportada y herramienta inocua sobre un directorio temporal. Parar la habilitación del adaptador si no puede preservar selección/permisos, obtener resultado o declarar honestamente el contexto. No inferir éxito de una respuesta que afirma su propia identidad.

## S1. Entidades y migración compatible

Resultado: identidad, target, binding versionado, conversación y delivery dejan de depender del tipo de hilo/modelo de Codex.

Archivos: `packages/contracts/src/`, módulo automation y repositorios correspondientes; nueva migración numerada en el directorio que ya carga `migrateFromDirectory`; tests de schema/migraciones/contratos. No editar migraciones aplicadas.

Target: ID, proveedor, ID de conector/host, referencia opaca local al profile/bot y capacidades verificadas con versión. Binding: identidad, target, revisión, habilitación y grupos/remitentes permitidos. ConversationMapping: binding+grupo+generación de conversación, referencia nativa y `context_mode`. Delivery: evento, revisión, controlador/época, estado, clave de inicio, referencia nativa, resultado inmutable, recibo, fechas y error redactado.

Representar el receptor existente como `legacy_codex` sin arrancar un segundo consumidor. La migración no cambia el modelo ni pausa el receptor por sí misma. Resultados e inbox conservan IDs y recibos. No sincronizar cuerpos de perfiles ni secretos al servidor.

Checks: migrar DB anterior con jobs pendientes/terminales y verificar que su ruta legacy sigue funcionando; rollback lógico sin revertir esquema; E2E de lectura UI/MCP previa sobre DB migrada. Un bot con contexto compartido no admite más de un grupo; la restricción se impone en servidor con transacción, no solamente en UI. Parar ante pérdida de historial o cambio implícito de identidad.

## S2. Pairing y autorización separada

Resultado: conector automático de un binding y cliente interactivo tienen autoridades distintas y revocables.

Archivos: módulos agents/automation, OAuth/grant-claims e interactions, autenticación y handlers MCP/HTTP, transporte `apps/server/src/adapters/agent-ws/index.ts`, contratos compartidos; tests de OAuth, MCP, WebSocket y permisos.

Pairing: challenge aleatorio, limitado en tiempo, un solo uso y ligado al dueño, identidad, target y revisión previstos. Consumirlo atómicamente; un challenge no autoriza otro target. En Grok Bot mostrar que la asociación de bot es declarada por el dueño y probada mediante el retorno de esa rutina; no afirmar identidad criptográfica nativa si no está disponible.

Grant automático: binding/revisión y operaciones de leer, reclamar, registrar ejecución y completar. Sin configuración, selección de identidades ni ACK/envío legacy. Grant interactivo: lista explícita de identidades y grupos, lectura/envío según consentimiento; sin claims ni ACK automático. Scopes nuevos fuera del default que hoy concede scopes existentes al omitirlos. Validar estado actual del grant, identidad y membresía en cada operación, incluidos callbacks.

WebSocket: en la primera versión rechazar explícitamente los nuevos grants automáticos e interactivos en el upgrade/autenticación, antes de suscribirse o entregar cualquier mensaje, aunque reutilicen el verificador criptográfico de MCP. Esos clientes usan exclusivamente las operaciones autorizadas MCP/HTTP de este contrato. No degradar un grant nuevo a credencial legacy ni derivar suscripciones solo de membresías. Los grants legacy mantienen el comportamiento existente y las comprobaciones vigentes de conexión, identidad y membresía. Soportar nuevos grants en WebSocket en el futuro requerirá su autorización completa por grupo y revocación antes de cada entrega, y queda fuera de este outline.

Clientes legacy mantienen una identidad y sus contratos anteriores. Al existir binding automático, el ACK interactivo legacy no puede consumir un evento que pertenece a ese binding: debe devolver conflicto; la intervención del dueño es una operación distinta. No otorgar nuevos permisos a grants antiguos ni transformar automáticamente la credencial global de Codex en una credencial multiidentidad.

Checks: E2E login/consentimiento/pairing/revocación, challenge repetido o sustituido, scopes insuficientes, intento de escribir como identidad ajena y conexión vieja tras nueva revisión. Añadir pruebas WebSocket con identidad miembro de A+B y grant nuevo limitado a A: el socket se rechaza para ambas clases nuevas y no entrega contenido. Repetir tras reducir grupos o revocar el binding manteniendo membresía; no permitir reconexión ni entrega con la credencial anterior. Verificar que modificar una credencial legacy a nueva clase invalida cualquier socket abierto antes de entregar otro mensaje, mientras el tráfico legacy autorizado sigue funcionando. Errores no filtran contenido revocado. Parar ante ambigüedad de autoridad o ampliación silenciosa de scopes.

## S3. Delivery durable y puerto de adaptadores

Resultado: cola independiente del proveedor, estados y recibos recuperables, con adaptador falso ejecutable desde el mismo supervisor que se desplegará.

Archivos: módulo automation, MCP/HTTP, `apps/bridge/src/receiver.ts`, supervisor y nuevo puerto de runtime; contratos y tests de receiver/automation, nuevo E2E de bindings.

Puerto conceptual: describir capacidades, entregar/iniciar, observar/consultar, recuperar resultado y solicitar cancelación. La ausencia de una operación se declara como capacidad, no se emula con una respuesta inventada. El servidor persiste claim e intención antes del despacho; estado incierto no libera slot por heartbeat o timeout. Un resultado duradero se recupera desde servidor con otro almacén local sin regeneración.

Una tarea automática activa por target, aunque varios grupos/bindings lo referencien. El servidor impone el cupo; el proceso conserva el ID de controlador y la época. El nuevo controlador consulta la ejecución nativa o conserva `needs_review`; no reutiliza una autorización de inicio consumida. Estados: `queued`, `claimed`, `start_uncertain`, `running`, `awaiting_approval`, `result_saved`, `done`, `needs_review`, `cancel_requested`.

El único publish autorizado consume el resultado inmutable y valida binding/revisión, grant, membresía y pausa en la transacción de publicación+ACK. Recibos distinguen publicado, `no_reply` y supresión por intervención explícita. Un callback repetido idéntico devuelve el mismo recibo; contenido diferente para la misma entrega genera conflicto. Un intento viejo nunca publica bajo una revisión nueva.

Cancelación de HTTP, long poll y shutdown se propaga hasta antes del claim y del inicio. Cancelar una espera no prueba quiescencia de un runtime. Recuperar un slot incierto requiere evidencia positiva de finalización/cancelación del runtime o una resolución del dueño que mantenga explícita la incertidumbre sin permitir otro inicio sobre ese target. La operación limitada de reconciliación sigue disponible tras pausa/revocación sin devolver cuerpo revocado ni restaurar permisos de publicación.

Retención conforme diseño: preservar pendientes/inciertos y cuerpos recuperables; purgar cuerpos operativos siete días después de completar+ACK; conservar deduplicación sin cuerpo 30 días. Mantener marca terminal mínima ligada al evento/inbox mientras exista una posible repetición, para que una notificación antigua no regenere tras purgar recibos. La retención del proveedor no se extiende por este mecanismo.

Checks: E2E de supervisor real con adaptador falso, navegador y ACK; dos procesos y dos almacenes locales independientes; respuesta de publicación perdida; caída antes/después del inicio; callback tardío; SIGTERM al despertar; grupo revocado; pausa concurrente; dos grupos en el mismo target; retención y replay. Parar si se requiere regenerar para saber si publicó o liberar slot por mera ausencia de actividad.

## S4. Adaptador Hermes

Resultado: un profile real responde como agente nativo y mantiene sesión por grupo mediante el camino seleccionado en S0.

Archivos: `integrations/hermes/` si el camino es plugin; adaptador Hermes bajo bridge si es runs; manifiestos y docs de instalación; fixtures Python descubiertos por un comando explícito si se introduce Python; tests TS de contrato, integración y E2E. No instalar globalmente durante tests.

Canal: IDs reales del remitente, profile fijado y grupo estable en SessionSource, conexión saliente y callbacks por entrega. Implementar la correlación terminal y política de sesión aprobadas en S0. El callback de envío se clasifica como progreso, aprobación o salida; no completa la entrega por sí solo. El hook terminal/outcome confirma finalización y `no_reply` explícito; el resultado se registra duraderamente antes de ACK y liberación del slot. Si no puede reconciliarse tras reinicio, queda `needs_review`. Mantener una sesión por binding+grupo para todos sus remitentes autorizados, sin tocar la partición de otros canales. `trusted_inbound=false`; allowlists/grupos del dueño se traducen sin suplantar su ID. No despachar comandos administrativos de Hermes desde texto de terceros. Toolset de este canal configurado explícitamente por el dueño, conservando permisos y aprobaciones nativas.

Si se elige runs: `session_id` fijo por grupo, sin sobrescribir instrucciones ni modelo del profile, autenticación del profile y consulta del `run_id`. Usar clave idempotente durable con el mismo cuerpo; después de vencer la retención nativa no reintentar una creación incierta. El fallo o `interrupted` después de un inicio no habilita repetir efectos externos; guardar el estado y pedir reconciliación.

Checks: E2E determinista con Hermes real/proveedor falso desde el entrypoint de despliegue; dos perfiles y dos grupos; dos participantes alternando en un grupo comparten sesión mientras el otro grupo conserva una diferente, también tras reinicio; aprobación seguida de respuesta final, múltiples envíos y silencio intencional con un solo resultado terminal; caída después del terminal y antes de persistir en Agent Chat; reinicio gateway; grant revocado; prompt y toolset esperados; aprobación pendiente sin elevar permisos. Aceptación real separada con profile elegido, herramienta inocua temporal y actividad inspeccionada en su UI/historial soportado. Parar si el transporte altera persona, cae en profile default o no devuelve resultado recuperable.

## S5. Adaptador Grok Bot

Resultado: una rutina del bot elegido despierta con un evento y publica por el retorno autenticado, sin crear otro bot.

Archivos: dispatcher/adaptador Grok Bot bajo bridge, contratos de wake-up/callback, handlers autenticados, plantilla de instrucciones de rutina y pruebas deterministas; documentación de pairing, acceso de red y límites.

La URL de rutina y bearer se guardan mediante referencia segura; nunca se imprimen ni incluyen en prompts/logs. El dispatcher no acepta una URL o destino aportado por un mensaje de chat. Configuración owner-only con validación HTTPS y destinos aprobados; bloquear destinos locales/privados o redirecciones fuera del destino aprobado para este adaptador cloud. La política de red local de Hermes se trata aparte.

Wake-up contiene referencias opacas de delivery, binding/revisión y versión; no un token general ni historial completo. La rutina usa una conexión preconfigurada de Agent Chat limitada al binding para reclamar el evento y consultar contexto autorizado. Debe comprobar autorización de inicio antes de ejecutar la tarea o usar herramientas para el mensaje. La inferencia necesaria para coordinar esa comprobación no queda cubierta por una promesa de ejecución única.

HTTP 200 registra aceptación. Un timeout deja inicio incierto y no reenvía automáticamente. Un rechazo inequívoco permite retry con backoff solo cuando el contrato demuestra que no inició; casos desconocidos quedan para revisión. Callbacks old/replay se rigen por S3. La rutina no interpreta contenido de grupo como instrucciones para cambiar sus credenciales/configuración.

El retorno usa MCP/connector soportado por la cuenta o helper autenticado limitado. No persistir credenciales de varias identidades en el filesystem compartido de Grok Bot. Si solo existe helper con ese límite de confianza, declarar capacidad y solicitar aceptación concreta antes de activar. Sin retorno soportado: adaptador no compatible, pendientes preservados.

Checks: E2E determinista desde dispatcher real contra webhook falso, callbacks duplicados/perdidos, pausa de rutina y límites; sin ACK al aceptar. Aceptación real: bot seleccionado, rutina ligada mediante challenge, mensaje desde navegador, procesamiento visible en ese bot y callback desde su nube a la ruta elegida. Declarar contexto compartido y restringir a un grupo si no demuestra separación nativa. No se declara 24/7 con Agent Chat alojado solo en una Mac que puede apagarse.

## S6. Codex profile e interacción explícita

Resultado: profile+workspace explícitos conservan configuración real; una sesión interactiva selecciona identidades concedidas sin apropiarse del receptor.

Archivos: adaptador Codex separado del worker legacy, control de argumentos y configuración, herramientas MCP de selección/envío, UI de consentimiento, tests y documentación.

No usar `--ignore-user-config`, `--ignore-rules`, `--last` ni catálogo recortado para el camino nativo. Configurar host/profile/workspace por el dueño, con proceso e hilo por contexto registrado. No ejecutar cadenas shell arbitrarias provenientes del chat para seleccionar un runtime. Si una aprobación no puede tramitarse, mostrar bloqueo sin cambiar las políticas. Actividad en T3 no se promete; se verifica el acceso al transcript y se informa la superficie disponible.

En la conexión interactiva exigir `as_agent_id` explícito por escritura en la primera versión, sin selección ambiente invisible. El servidor comprueba la lista de identidades/grupos y audita actor/conexión y autor mostrado. Enviar no implica ACK, transferencia ni cambio de binding. Hacer escritura interactiva mientras existe un job automático no modifica ese job ni duplica su autoría auditada.

Checks: E2E consentimiento de dos identidades, selección explícita, identidad no autorizada, revocación, receptor automático activo sin claims alterados. Adaptador con profile temporal/proveedor falso y prueba real opcional del profile elegido sin imponer un modelo distinto. Parar si abrir una sesión cambia el target permanente o si requiere acceso no autorizado para resolver aprobaciones.

## S7. UI, observabilidad y migración de prueba

Resultado: el dueño entiende qué agente trabaja, dónde se personaliza, qué grupos cubre y cómo revisar su actividad.

Archivos: `AutomationPanel.tsx`, panel de agentes, clientes HTTP/contratos e i18n existentes; tests de componentes y E2E accesible.

Mostrar target, host/nube, profile/bot, workspace si aplica, revisión, modo de contexto y capacidades verificadas; separar conectado/target verificado/grupo cubierto/esperando aprobación/incierto/pausado. Actividad del dueño con entrada, salida, decisión, recibo y enlace o referencia nativa soportada. No mostrar herramientas completas ni razonamiento privado. Accesibilidad básica, español y errores/vacíos cubiertos.

Migración: backup consistente, pausa de binding legacy de prueba, reconciliación, nueva revisión, activación de un único consumidor nativo y prueba de ida/vuelta. Mantener rollback al legacy sin deshacer esquema y solo con target quiescente. Cambiar una identidad real o los LaunchAgents existentes requiere una acción de activación explícita del dueño; preparar antes todos los cambios revisables.

Checks: E2E desde navegador crear/abrir conversación, mensajes, menciones según contrato actual, contexto, herramientas autorizadas, pausa, retorno y recuperación; capturas por paso y reporte de fallos. Probar migración/reversión en copia de DB y rechazar relevo con trabajo incierto. Prueba manual nativa para cada adaptador habilitado.

## S8. Operación, cierre y evidencia

Resultado: README y guía de operación describen instalación, requisitos, selección de profiles/bots, permisos, red, retención, 24/7, pausa y recuperación. No cambian globalmente configuraciones personales ni administran runtimes ajenos.

Archivos: README, scripts de instalación locales existentes solo donde sea necesario, ejemplos sin secretos y `90-verification.md` ampliado. Si Python es necesario, declarar versión y comando de su suite; integrar descubrimiento al verify.

Ejecutar suite completa: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:unit`, `pnpm test:contracts`, `pnpm test:integration`, `pnpm test:e2e`, más suite Python si aplica. Registrar conteos, skips y bloqueos externos concretos. E2E determinista no acredita aceptación real de bots; la aceptación real registra runtime/versiones, endpoint, capturas y referencia de ejecución sin secretos.

Realizar una revisión independiente Codex de seguridad/protocolos y corregir hallazgos con regresiones. Commit en la rama de trabajo; sin push ni PR. No marcar todo funcionando si Grok Bot no tiene callback real o si la red no soporta disponibilidad continua. Reportar cada adaptador como probado, bloqueado o no habilitado.

## Gates y evidencia

La aprobación solicitada para este outline habilitará implementación aislada y pruebas deterministas. Las acciones reales excluidas en el diseño siguen excluidas hasta autorización concreta de target/red/activación. No se vuelve a pedir autorización para pruebas locales rutinarias ya incluidas.

S0 fija camino Hermes y capacidades, sin cambiar el contrato aprobado. Si exige cambiar autonomía, identidad, permisos o garantías prometidas, volver a discusión de diseño con el cambio concreto. Si solo falta una capacidad de un proveedor, registrar el bloqueo sin sustituir runtime ni declarar PASS.

Revisión independiente: Codex con razonamiento high, artefacto y hash exactos, solo lectura. Hallazgos critical/controlling requieren revisión y otra ronda. La revisión no concede aprobación humana. Este outline todavía no fue aprobado.

## Cambios de r2 y disposición de ronda 1

- NB-F1, major: WebSocket incluido en S2; nuevos grants rechazados explícitamente, transición de clase invalida sockets y se cubren restricciones/revocación. No se introduce soporte parcial por membresía.
- NB-F2, major: S0 exige prueba de finalización correlacionada y durable, incluido silencio y aprobación; S4 implementa esa estrategia antes de habilitar el canal.
- NB-F3, major: S0 exige sesión compartida por binding+grupo sin perder remitente ni cambiar defaults globales; S4 prueba varios participantes y grupos antes/después de reiniciar.

Estas correcciones completan el contrato aprobado; no cambian autonomía ni amplían permisos. Estado de cierre: propuesto por el autor, pendiente de verificación independiente sobre el hash r2.
