# Lectura humana y recuperación de grupos

## Recibo de trabajo

Checkout de T3: `/Users/ramiro/.t3/worktrees/agent_chat/t3-d1b190ce`.
Rama: `t3/group-read-state-retry`. Base: `main`, commit `4680f70c431a6a6d7712aea7ccaa7cff124dbf50`.
Se conserva para la integración del padre. No se creó otro checkout, no hubo delegación ni cambios de nube, identidades existentes o receptores.

## Qué significa leído

Una lectura pertenece a una persona y a su membresía en un grupo. Se guarda cada ID de mensaje que el chat informó como visible. La pestaña debe estar visible y tener foco al recibir el callback y al despachar la solicitud. Ver un mensaje nuevo no marca como leídos los mensajes que quedaron fuera del área visible o de la página cargada.

`readSequence` es la mayor secuencia de los mensajes confirmados. Solo avanza. Los pendientes se calculan a partir de las confirmaciones individuales, porque un cursor máximo no representa los huecos de paginación o reconexión. Las confirmaciones solo se agregan; los reintentos y las solicitudes concurrentes son idempotentes. El endpoint rechaza un cursor numérico o un pedido implícito de “leer hasta el último”.

Los mensajes enviados por la misma persona no suman pendientes. Los mensajes de otra persona o de un agente sí, hasta que esa persona los vea. La migración no presume lecturas anteriores: el historial ajeno empieza pendiente. Al quitar una membresía se borran sus confirmaciones y su cursor. Reingresar crea una membresía nueva y vuelve a dejar pendiente el historial ajeno. No se utiliza la fecha de ingreso como frontera.

Las lecturas humanas no cambian `get_inbox`, `ack_inbox`, avisos ni recibos de agentes. No constituyen recibos públicos de lectura para los otros miembros.

## Contrato y permisos

`POST /api/groups/:groupId/read` recibe `{ "messageIds": ["id"] }`, de 1 a 100 IDs por solicitud, y responde `{ "status": "ok" }`. Resuelve una sesión humana, verifica la membresía y valida que todos los IDs existan en ese grupo. La operación es atómica. Un ID ajeno, inexistente o una membresía ausente devuelven `404`, sin datos de mensajes. Conserva el guard de origen de las rutas humanas.

`GET /api/groups` agrega `activity` a los grupos con mensajes: `latestSequence`, `latestMessageAt`, `unreadCount` y `readSequence`. Un grupo sin mensajes no tiene `activity`. La fecha corresponde al mensaje de mayor secuencia; no contiene texto ni autor. Se conserva el orden previo por creación e ID y el filtro por nombre del navegador.

Las migraciones nuevas son `0014_human_group_reads.sql` para SQLite y `20261025000300_human_group_reads.sql` para Supabase. La segunda habilita RLS y revoca acceso directo de `anon` y `authenticated`. Los triggers impiden confirmaciones de otro grupo y retrocesos del cursor. El padre debe aplicar la migración Supabase secuencialmente; este worker no la aplicó ni reseteó el servicio compartido.

## Integración del chat en App

`useGroupRead(groupId, enabled, onChanged)` exporta `onMessagesDisplayed`, `readError` y `retryRead`. App ya pasa el callback mediante spread a `ChatContainer`; esto permite compilar contra el componente base, que todavía no declara el prop. Al integrar el commit del worker de chat, el padre debe verificar que `ChatContainer` reciba y utilice `onMessagesDisplayed?: (messageIds: readonly string[]) => void`.

El emisor debe informar exclusivamente IDs realmente visibles, en orden de historial, y volver a informar los visibles al recuperar foco o visibilidad. No debe enviar IDs desde metadatos del listado, desde frames sin renderizar ni desde todo el historial cargado. El hook no inspecciona el DOM del chat. Al navegar a otra sección o grupo se descarta la cola anterior. En blur/ocultamiento se descartan IDs pendientes de despacho; una confirmación ya enviada puede terminar porque sus mensajes se vieron antes del cambio de foco.

Las escrituras se agrupan durante 250 ms, con hasta 100 IDs por solicitud y una sola solicitud activa. El error detiene reintentos automáticos y ofrece recuperación explícita. El conjunto en memoria está acotado; la fuente durable es el servidor. La lista se refresca con una ventana fija de 600 ms ante mensajes, cambios de membresía, reconexión, confirmación de lectura y recuperación de foco. No hay consultas por cada mensaje ni bucles periódicos.

La navegación distingue carga inicial, actualización con lista previa, error con datos previos y pérdida de acceso. Un fallo transitorio del listado conserva la selección y no desmonta el chat. Un rechazo de permisos retira la lista y la conversación. Un éxito que omite el grupo seleccionado también retira esa conversación. El campo de búsqueda permanece montado durante reintentos.

Después de un logout confirmado, el padre puede agregar el borrado del store de borradores del worker de chat en `signOut()`, inmediatamente antes de `setSession({ status: "anonymous" })`. No borrar borradores si falla el logout.

## Pruebas y pendientes de integración

Los archivos nuevos `group-human-read-queue.test.ts`, `group-human-read-state.test.ts` y `group-human-read-state.spec.ts` cubren cola, permisos, persistencia, huecos, pertenencia, mensajes propios, reingreso, independencia del inbox, reintento local y metadatos en vivo. La suite managed usa únicamente fixtures nuevos y exige una URL de PostgreSQL local; no resetea datos ni llama a la nube.

El caso E2E `automatic display callback ...` exige integrar el callback del worker de chat. El padre debe ejecutarlo después de combinar ambos commits, junto con managed. Los otros cuatro casos E2E se ejecutan sobre SQLite con Portless y Chromium local.

La suite general de esquema tiene una lista fija de tablas en `tests/integration/schema.test.ts`. El padre debe agregar `group_human_message_reads` a esa lista. Ese archivo preexistente quedó fuera de la propiedad de este worker. La nueva tabla es la única diferencia en esa aserción.

Referencias de patrones: alerta con recuperación local de [shadcn](https://ui.shadcn.com/docs/components/base/alert), señales con datos reales del [Taste Skill](https://www.tasteskill.dev/) y continuidad de marca de [Taste Labs](https://tastelabs.com/). Se conserva la identidad verde y el framework actual.


Validación del worker: `pnpm lint`, `pnpm typecheck`, `pnpm build` y `git diff --check` aprobados. La última corrida focalizada de unidad/integración aprobó 34 pruebas. La corrida general anterior aprobó 431 y falló únicamente en la lista fija de tablas indicada arriba. Se aprobaron los cinco E2E existentes de grupos/chat y los cuatro nuevos que no dependen del callback. El caso automático y las tres pruebas managed quedan para la integración del padre. Capturas revisadas en `.local-state/group-read-e2e/`: `retry-error-desktop.png`, `retry-desktop.png` y `unread-desktop.png`. El servidor de pruebas usó `http://group-read-worker.localhost:1356`, con SQLite propio del worktree.
