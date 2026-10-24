# S3: entregas durables y puerto de runtime

## Protocolo

La migración0010 agrega controladores por binding con época creciente, evidencia terminal, recibos y retención. Se conserva el slot único por target de0008, compartido por bindings y grupos. Un controlador nuevo invalida los tickets anteriores; no libera una ejecución iniciada. Un claim no iniciado puede recuperarse con otro ticket. Un inicio consumido permanece iniciado aunque el nuevo controlador no encuentre su referencia nativa.

native_begin consume el permiso una sola vez y deja start_uncertain antes de cualquier despacho. El bridge registra además el consumo en SQLite local con synchronous=FULL antes de llamar al adaptador. Ni reiniciar con un estado local vacío, ni una observación unknown, ni la expiración de una espera autorizan repetir start. El adaptador consulta por startKey o referencia nativa y recupera el resultado desde su almacenamiento; no genera otro para averiguar qué pasó.

native_save valida evidencia terminal y guarda una salida inmutable en el servidor. Otra época puede recuperar ese resultado y completar sin tocar el runtime. native_finish valida grant, revisión, membresía y pausa y publica+confirma inbox dentro de una transacción inmediata. El recibo distingue published, no_reply y suppressed. La respuesta HTTP perdida se resuelve leyendo ese recibo; no se vuelve a publicar ni generar.

Cada entrega incluye el mensaje exacto de su evento y su remitente real. El historial es contexto adicional, no reemplaza al mensaje pendiente. Antes del inicio se vuelve a comprobar la membresía del remitente. Las allowlists usan referencias human:ID; una lista vacía admite miembros humanos vigentes del grupo. La activación entre agentes permanece deshabilitada hasta verificar detección de ciclos; sus eventos no bloquean los humanos posteriores. Se limita a 30 inicios por hora y target, sin confundir frecuencia con una cota económica.

## Evidencia y reconciliación

El target puede registrar una clave pública Ed25519 al crearse. Se fija antes de habilitar y queda inmutable; cada entrega conserva su copia. El conector conserva su clave privada y firma evento, target, startKey, referencia nativa, estado terminal y digest del resultado. La firma autentica al conector configurado; demostrar que firma únicamente tras la terminación nativa sigue siendo un gate de cada adaptador real. S3 no acredita esa capacidad de Hermes, Codex o Grok Bot mediante el fixture.

El endpoint /native/reconcile acepta exclusivamente esa evidencia firmada, sin depender de un bearer revocado. No ofrece contenido, publicación ni generación. Conserva el slot hasta que el dueño haya suprimido explícitamente la entrega y exista evidencia de terminación. Suprimir sin evidencia puede confirmar la inbox, pero deja needs_review y mantiene la exclusión. Así el cierre limitado funciona tras pausa, revocación OAuth o pérdida de membresía sin devolver texto revocado ni restaurar permisos.

La firma terminal debe emitirse solo cuando el adaptador haya acreditado también que no puede llegar un despacho tardío para esa clave: mediante tombstone durable del proveedor o cierre positivo del despachador. Una firma emitida antes de esa comprobación no es evidencia válida del protocolo; cada adaptador real debe demostrarlo antes de habilitarse. El digest de evidencia impide aceptar terminales contradictorios. No basta un estado idle, silencio del servidor nativo, heartbeat vencido o muerte del cliente. La evidencia de un evento nunca cierra otro.

## Bridge y operaciones

El entrypoint y supervisor existentes aceptan --native-adapter PATH y --state DIRECTORY. La ruta del módulo la elige el dueño; nunca procede del mensaje. La fábrica createNativeRuntime implementa describe, start, observe, recoverResult, cancel opcional y close. Las capacidades ausentes se declaran y no se simulan como éxito. El camino nativo usa su conexión OAuth explícita mediante AGENT_CHAT_MCP_URL y AGENT_CHAT_MCP_TOKEN; no toma la credencial global de Codex. Las credenciales reales deben provisionarse mediante el mecanismo opaco habitual del proyecto.

El protocolo MCP nativo agrega native_open/next/begin/running/pending/save/finish/delivery. El dueño puede pausar/habilitar por revisión, solicitar cancelación o suprimir una entrega mediante HTTP autenticado. native_cancel_begin consume un único despacho de cancelación; su aceptación no equivale a terminación ni ACK. Si el adaptador no admite cancelar, la entrega conserva su slot hasta obtener evidencia o resolución explícita. Habilitar requiere capacidades verificadas y clave pública; las rutas públicas no pueden marcar capacidades como verificadas. Los targets reales todavía no verificados siguen bloqueados.

La cancelación se comprueba antes y después del long poll y antes del despacho. La regresión HTTP espera el cierre real del transporte antes de introducir el mensaje siguiente. El cierre del bridge drena cliente, adaptador, SQLite y lock propios. El supervisor reconstruye un proceso tras fallo; el proceso nuevo recupera estado remoto, no retransmite start.

## Retención

Al arrancar y cada hora se purgan cuerpos operativos de entregas done siete días después de completar+ACK. Un fallo transitorio de cleanup se registra sin terminar el servidor. Las salidas pendientes, pausadas o inciertas se conservan. Tras 30 días se purga también la copia operativa de la clave pública. Quedan recibo/digest y marca terminal ligados al evento mientras pueda repetirse una notificación; no se borra el tombstone que impide regeneración. El historial normal del chat y el contexto del proveedor conservan sus políticas propias; S3 no los replica ni amplía su retención.

## Pruebas y alcance

El E2E usa el entrypoint compilado del servidor, dos procesos del supervisor en secuencia y dos directorios locales independientes. El runtime de prueba tiene su propia SQLite, separada del bridge; el único conector habilitado por la prueba es ese fixture y su signer sintético en una DB temporal. Un proxy descarta la primera respuesta de finish después del commit. Hay crash después del despacho, reinicio durante long poll, mensaje desde navegador en la ventana de reconexión, continuidad de conversación, no_reply y pausa/reanudación. Se cuentan los inicios nativos y se verifica un solo resultado por evento. Capturas native-delivery-01/02 en .local-state. Se inspeccionó la segunda: mensajes y autores correctos; el indicador legacy todavía muestra "Sin receptor activo" para el receptor nativo. La proyección de estado nativo y cobertura corresponde a S7 y queda registrada como pendiente, sin presentar esa etiqueta como prueba de conexión.

El fixture limpia npm_command heredado al invocar Portless global y registra los PID de sus propios hijos. Cierra la página, procesos y pipes antes de eliminar temporales. Los primeros intentos detectaron problemas de arranque y cleanup del harness; no se ampliaron timeouts ni se relajaron las aserciones para resolverlos. La prueba de cancelación inicial confundía headers recibidos con transporte cerrado; se corrigió para observar el cierre real y mantuvo la aserción de cero claims posteriores.

Los tests de integración cubren fencing, slot compartido, recuperación de salida y recibos, evidencia falsa/contradictoria, rollback de publicación+ACK, pausa, revocación, supresión incierta, retención, remitente revocado y límites. El callback real se prueba por HTTP después de revocar OAuth. Los unitarios verifican apagado al despertar, después de begin, replay local y observación sin reinicio.

S0 sigue parcial. No se activaron adaptadores nativos reales, rutinas Grok Bot, servicios ni datos de producción. La aceptación por proveedor, la UI de operación y la migración real siguen en sus slices. La revisión independiente de S3 queda pendiente antes de continuar S4.

## Verificación del autor

Lint, typecheck, build y git diff --check PASS. 152 unit, 15 contratos, 188 integración y 26 E2E PASS (381); un skip legacy real por opt-in AGENT_CHAT_REAL_CODEX. E2E final45.2s, caso del supervisor12.7s. Servidor externo Portless agent-chat-native-bindings-s3-checked con DB nueva .local-state/native-bindings-s3-checked-fresh.db; el E2E nuevo crea además su servidor, proveedor, proxy y claves sintéticas en temporales propios. Se cerraron sus hijos y los dos servidores externos propios de S3. Ningún servicio de producción cambió. No hubo inferencia real, push ni PR. Revisión independiente pendiente sobre el commit de este incremento.
