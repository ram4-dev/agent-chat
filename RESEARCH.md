# Chat de grupos para personas y agentes: research y primer alcance

Fecha: 14 de octubre de 2026. Estado: propuesta para discutir antes de implementar.

## Lo que hace Ando

Ando se presenta como mensajería de equipo para personas y agentes. El agente tiene perfil, aparece en la lista de miembros y firma sus propios mensajes. Puede participar en canales, conversaciones privadas y mensajes directos, con acceso limitado a las conversaciones donde está presente. Ando admite agentes alojados por ellos y agentes externos. Para estos últimos ofrece MCP, API y mecanismos de recepción de eventos. [Producto](https://www.ando.so/), [agentes como miembros](https://www.ando.so/features/ai-agents), [guía de conexión](https://docs.ando.so/docs/external-agents).

Su conexión por MCP permite buscar, leer y enviar mensajes. La documentación aclara que MCP no despierta un proceso local apagado: para reaccionar a mensajes nuevos hace falta un proceso que escuche eventos, un webhook o una tarea programada. Ando también separa la identidad humana de la identidad del agente durante la autorización. [MCP](https://docs.ando.so/docs/ando-mcp), [Realtime](https://docs.ando.so/developers/realtime), [Webhooks](https://docs.ando.so/developers/webhooks).

La diferencia que podemos probar es una experiencia deliberadamente más pequeña: grupos privados, chat humano completo y conexión de agentes externos desde el primer día. No necesitamos copiar llamadas, wiki, Slack import, agentes alojados ni toda la estructura de workspaces para validar el uso central.

## Producto propuesto

Una persona crea un grupo, invita a otras personas y agrega sus agentes. Cada agente tiene nombre, avatar opcional, descripción breve y un dueño humano visible. Los mensajes de personas y agentes comparten la misma conversación. El grupo muestra con claridad quién escribió cada mensaje y quién es dueño de cada agente.

El agente se agrega desde su cliente MCP. En la primera conexión, el dueño inicia sesión y autoriza crear o vincular una identidad de agente. Puede elegir nombre y grupo inicial. Esa identidad queda asociada a su cuenta y conserva su historial aunque el cliente se reconecte. El dueño puede cambiar nombre, gestionar grupos, desconectar el cliente y revocar el acceso. Reconectar un cliente a la misma identidad no crea otro miembro.

Una vez conectado, el agente puede leer los grupos a los que pertenece y publicar un mensaje nuevo cuando quiera. `send_message` no exige una mención ni un mensaje previo. Si alguien le habla, un proceso externo puede recibir el evento y decidir si responde. El alcance inicial no incluye alojar ni mantener vivo ese proceso: la interfaz debe mostrar si el agente tiene recepción configurada, para no prometer respuestas automáticas cuando solo tiene MCP.

### Flujo mínimo

1. Una persona entra, crea un grupo y comparte una invitación con otra persona.
2. Ambas escriben y reciben mensajes en tiempo real.
3. Una de ellas conecta su cliente MCP, autoriza la conexión y crea una identidad de agente propia.
4. Agrega el agente al grupo. El agente lee el contexto permitido y publica una presentación con su identidad.
5. Más tarde, el agente publica una actualización por iniciativa propia, sin mención previa.
6. Si tiene un receptor de eventos activo, recibe un mensaje nuevo y responde una sola vez. Si no lo tiene, puede ponerse al día cuando vuelva a ejecutarse.

## Límites del primer producto

| Incluido | Después |
| --- | --- |
| Grupos privados con nombre y miembros | Canales públicos y workspaces |
| Mensajes de texto en tiempo real | Hilos, archivos, llamadas y búsqueda avanzada |
| Invitaciones para personas | Importación desde otros chats |
| Identidad de agente vinculada a un dueño | Agentes alojados por la plataforma |
| Servidor MCP remoto para agentes externos | SDKs y conectores específicos por cliente |
| Lectura, publicación e inbox de eventos | Automatizaciones internas y memoria elaborada |
| Revocación de acceso y registro básico de actividad | Roles y controles empresariales |

## Modelo y permisos

`User` representa a la persona autenticada. `Agent` tiene `owner_user_id`, perfil y estado de conexión. `Group` tiene miembros humanos y agentes. `Message` guarda el grupo, el autor efectivo, contenido y fecha; si el autor es agente, su dueño se resuelve desde `Agent`. `AgentConnection` guarda la vinculación del cliente y permisos concedidos. `AgentInboxEvent` permite recuperar eventos pendientes sin depender de una conexión permanente.

Las credenciales del agente autorizan acciones como ese agente, nunca como su dueño. El servidor verifica en cada lectura y escritura que el agente siga activo y pertenezca al grupo. La vinculación inicial requiere una aprobación del dueño autenticado. El dueño puede revocar una conexión sin borrar la identidad ni sus mensajes. Los mensajes muestran que el autor es un agente y a quién pertenece. Para evitar duplicados durante reintentos, cada envío admite una clave de idempotencia.

### Login y autenticación del agente

La propuesta usa OAuth para el MCP remoto. Cuando un cliente se conecta por primera vez, el servidor lo dirige al login web. La persona inicia sesión, elige crear un agente o vincular uno suyo y aprueba el acceso. En ese momento se guarda `Agent.owner_user_id` y se crea una `AgentConnection` para ese cliente. El dueño del agente no se puede cambiar en este primer producto.

La autorización entrega credenciales del agente, no una sesión humana. El token de acceso identifica `agent_id` y `connection_id`, tiene vencimiento corto y se emite para el servidor MCP. El cliente conserva de forma segura la credencial de renovación. En cada llamada, el servidor verifica firma o introspección, emisor, destinatario, vencimiento, conexión activa y permisos del grupo. El nombre que el agente declare en un prompt o en `send_message` no cambia el autor.

Al reconectar, el dueño selecciona la identidad existente. Cada cliente queda registrado como una conexión separada, así se puede revocar uno sin borrar al agente. Revocar una conexión invalida su renovación y bloquea nuevas llamadas de inmediato mediante la comprobación de `AgentConnection`. Revocar el agente bloquea todas sus conexiones. Los mensajes anteriores conservan la misma autoría. La implementación concreta del login humano y la compatibilidad OAuth de los primeros clientes MCP quedan para el diseño técnico; el servidor debe publicar los metadatos de autorización que esos clientes descubren. [Autorización MCP](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization).

## Interfaz MCP inicial

Servidor remoto con transporte HTTP compatible con clientes MCP actuales. El catálogo de herramientas debe ser corto:

| Herramienta | Uso |
| --- | --- |
| `get_identity` | Confirmar agente, dueño y permisos vigentes |
| `list_groups` | Listar únicamente grupos accesibles |
| `read_messages` | Leer mensajes de un grupo, con cursor |
| `send_message` | Publicar como agente en un grupo, con clave de idempotencia |
| `get_inbox` | Recuperar eventos pendientes para el agente |
| `ack_inbox` | Marcar un evento como procesado |

El alta o la vinculación de identidad ocurre durante la autorización web del MCP. Así evitamos que una instrucción dentro de un chat pueda crear identidades o hacerse pasar por otra persona. Para recibir mensajes mientras el agente está inactivo, la primera versión puede ofrecer polling del inbox. Para reacción inmediata hará falta un receptor externo activo, por ejemplo un webhook o una conexión persistente; MCP por sí solo no ejecuta el agente. Esta separación sigue lo observado en [la documentación de Ando](https://docs.ando.so/docs/ando-mcp) y en [su flujo de tiempo real](https://docs.ando.so/developers/realtime).

## Criterios de aceptación del MVP

- Dos personas pueden entrar al mismo grupo, enviar mensajes y verlos sin recargar.
- Un dueño puede vincular un cliente MCP a una identidad nueva y volver a vincularlo a la misma identidad.
- El agente aparece en el grupo con nombre propio y referencia visible a su dueño.
- El agente puede leer solo grupos donde es miembro y publicar allí sin recibir antes una mención.
- Una credencial revocada deja de leer y publicar; los mensajes anteriores conservan su autor.
- Un reintento con la misma clave de idempotencia produce un solo mensaje.
- Un evento nuevo queda disponible en el inbox; después de reconocerlo no vuelve como pendiente.
- El flujo completo se prueba con navegador, servidor y un cliente MCP real, además de las pruebas de API y permisos.

## Decisiones abiertas antes de construir

1. ¿El primer lanzamiento será solo web o también móvil? La propuesta técnica inicial es web adaptable a móvil.
2. ¿El dueño puede agregar su agente a un grupo creado por otra persona, sujeto a aceptación de sus miembros? Propongo que sí, con aprobación de un administrador del grupo.
3. ¿Queremos que un agente responda automáticamente apenas se lo menciona desde el primer piloto? Eso exige implementar y probar una vía de recepción además de MCP. Propongo inbox con polling para el primer piloto y un receptor de eventos como siguiente entrega.
4. ¿El agente debe poder cambiar su propio perfil? Propongo que solo el dueño lo edite en la primera versión.

## Siguiente paso de diseño

Validar las decisiones abiertas y definir pantallas, esquema de datos, contrato de autorización MCP y prueba de extremo a extremo. El repositorio estaba vacío al iniciar este research; no hay implementación previa que condicione esas decisiones.
