# Research de runtimes nativos

Fecha: 2026-10-23. Evidencia estática y ayuda de CLI; sin activaciones reales.

## R1. El receptor existente crea un Codex propio

[worker.ts](/Users/ramiro/Desktop/projects/agent_chat.feat-mcp-inbound-e2e/apps/bridge/src/codex/worker.ts) fija `gpt-6.1-sol`, usa `--ignore-user-config` y `--ignore-rules`, un directorio sandbox y un catálogo sin herramientas. [receiver.ts](/Users/ramiro/Desktop/projects/agent_chat.feat-mcp-inbound-e2e/apps/bridge/src/receiver.ts) instancia directamente `CodexWorker`, entrega historial reciente y una instrucción que dice que no tiene herramientas. Guarda el ID de hilo por grupo.

Esto explica la negativa a crear archivos. Cambiar solo el prompt no conecta con un bot existente. La preparación que exige cero herramientas deja de ser el criterio del nuevo camino nativo.

[automation/index.ts](/Users/ramiro/Desktop/projects/agent_chat.feat-mcp-inbound-e2e/apps/server/src/modules/automation/index.ts) conserva resultados, claims, épocas de controlador y publicación+ACK transaccional. Son mecanismos reutilizables, aunque actualmente el binding incluye un modelo concreto y `threadId` de Codex. El E2E [automation.spec.ts](/Users/ramiro/Desktop/projects/agent_chat.feat-mcp-inbound-e2e/tests/e2e/automation.spec.ts) prueba el receptor genérico, no Hermes ni Grok Bot.

## R2. MCP autentica una identidad por conexión

[auth.ts](/Users/ramiro/Desktop/projects/agent_chat.feat-mcp-inbound-e2e/apps/server/src/adapters/mcp/auth.ts) exige `agent_id` y `connection_id`, comprueba conexión e identidad activas y calcula scopes efectivos. [server.ts](/Users/ramiro/Desktop/projects/agent_chat.feat-mcp-inbound-e2e/apps/server/src/adapters/mcp/server.ts) deriva el autor de la credencial; `send_message` no recibe una identidad elegible. Además bloquea envío y ACK legacy desde la conexión registrada como runtime.

La selección interactiva entre varias identidades necesita un grant nuevo con lista explícita de identidades permitidas. No basta agregar un argumento `agent_id`. [contracts.ts](/Users/ramiro/Desktop/projects/agent_chat.feat-mcp-inbound-e2e/apps/server/src/modules/agents/contracts.ts) concede los scopes actuales si se omiten; los permisos nuevos deben quedar fuera de ese default.

## R3. Codex: un profile es una capa de configuración

Local: `codex-cli 0.164.0`; `codex exec --help` documenta `--profile`. Un profile superpone un archivo nombrado a la configuración base. También influyen directorio, configuración de proyecto, reglas y políticas. El profile no identifica una sesión ya abierta ni un proceso exclusivo. [OpenAI Docs: Advanced Configuration](https://learn.chatgpt.com/docs/config-file/config-advanced).

Conclusión de diseño: seleccionar un profile requiere fijar host, referencia local del profile y workspace. La conversación por grupo se registra aparte. No se usa `--last` ni se promete que la actividad aparezca en este hilo de T3. La visibilidad en una UI nativa concreta debe verificarse.

## R4. Hermes instalado ofrece varias superficies

Local: `Hermes Agent v0.22.2`, commit `d923a5eb487a`, instalación `/Users/ramiro/.hermes/hermes-agent`. La ayuda de `hermes webhook subscribe` tiene `--route-profile`: selecciona el profile que procesa la ruta; el `-p` global selecciona el gateway cuyo registro se modifica. No son intercambiables.

Fuente local [webhook.py](/Users/ramiro/.hermes/hermes-agent/gateway/platforms/webhook.py:675): cada entrega tiene identidad propia, retorna aceptación antes de completar y cierra su sesión al terminar. [toolsets.py](/Users/ramiro/.hermes/hermes-agent/toolsets.py:232) asigna a webhook un conjunto reducido de herramientas. Hay override por ruta en `toolsets_for_source`. Por eso el webhook simple no garantiza el contexto continuo ni la configuración habitual del profile.

La documentación remota de `hermes-agent-org/hermes` muestra defaults de webhook más amplios que esta instalación. La evidencia local prevalece para el adaptador instalado. No inferir paridad a partir de `main` remoto.

Tres opciones verificables por fuente:

| Superficie | Lo que aporta | Lo que falta probar |
| --- | --- | --- |
| Webhook por profile | Ingreso autenticado y selección explícita | Sesión por entrega; salida a Agent Chat y paridad de herramientas requieren trabajo adicional |
| Plugin de canal del gateway | `connect`, `disconnect`, `send`, `handle_message`; sesión por origen; políticas del gateway | Plugin nuevo, correlación y recuperación durable ante fallas |
| API de runs | `session_id`, estado, eventos y clave de idempotencia | Configuración efectiva de tools/prompts del API frente al canal habitual, aprobación y visibilidad |

[Guía de adaptadores instalada](/Users/ramiro/.hermes/hermes-agent/website/docs/developer-guide/adding-platform-adapters.md) admite plugins sin editar el core. Advierte que `trusted_inbound` no debe activarse para un chat: autenticación del transporte no convierte a cada participante en dueño autorizado del agente.

[API de runs instalada](/Users/ramiro/.hermes/hermes-agent/website/docs/user-guide/features/api-server.md:446) describe creación idempotente, consulta, SSE y reutilización de transcript con `session_id`. La reserva de idempotencia dura 24 horas tras la última actualización. [api_server_runs.py](/Users/ramiro/.hermes/hermes-agent/gateway/platforms/api_server_runs.py) contiene la implementación de persistencia y scopes. No se ejecutaron estas rutas. La existencia del código no acredita que estén habilitadas en un gateway real.

También existe un [relay experimental](/Users/ramiro/.hermes/hermes-agent/website/docs/developer-guide/relay-connector-contract.md), con WebSocket saliente del gateway, descriptor y eventos normalizados. Se considera alternativa posterior; no se introduce como dependencia obligatoria por su contrato experimental.

## R5. Grok Bot sí tiene una vía oficial de wake-up

La aplicación instalada es `Grok Bot 0.75.0`, bundle `com.anysphere.sand`; se inspeccionó exclusivamente `Info.plist`. Esto apunta al producto Grok Bot/Cursor. El usuario todavía no confirmó un bot específico ni su identificador.

La documentación oficial enlaza rutinas propiedad de un bot con triggers webhook. El emisor hace POST JSON usando bearer; HTTP 200 significa inicio aceptado, no finalización. El resultado aparece en el chat del bot. No se documenta allí un ID de ejecución devuelto ni deduplicación por clave. Hay límites de rutinas y no se debe asumir retry automático. [Cursor: Routines](https://cursor.com/help/grok-bot/routines).

Esto permite proponer un wake-up dirigido a la rutina del bot elegido. No prueba todavía un callback a Agent Chat, acceso a MCP de terceros en esa cuenta ni continuidad independiente por grupo.

Los bots tienen contexto persistente; su trabajo corre en nube y puede continuar con el portátil cerrado. Comparten computadora, archivos y logins dentro de una cuenta; la identidad de un bot no equivale a aislamiento del sistema operativo. [Grok Bot: Overview](https://docs.x.ai/grok-bot/overview), [Computer and apps](https://docs.x.ai/grok-bot/computer-and-apps).

No se usaron endpoints privados de la aplicación, SDKs comunitarios ni la API de modelos como sustituto del bot existente.

## R6. Disponibilidad y red

`agent-chat.localhost` es una dirección del entorno local; no demuestra una ruta desde la nube de Grok Bot. Para el callback o MCP hace falta un endpoint HTTPS alcanzable o un conector en una red accesible. Si Agent Chat permanece solo en una Mac apagada, no existe disponibilidad 24/7 aunque Grok Bot siga activo.

Para Hermes local se recomienda conexión saliente hacia Agent Chat para recibir pendientes, sin publicar un puerto de Hermes. El profile, sus secretos y su memoria siguen en su host. Un gateway multiplexado y gateways separados requieren descubrimiento por capacidades; no se asume una topología por documentación histórica.

## Gaps concretos

No probados: profile real seleccionado, herramientas efectivas, aprobación nativa, sesión continua de Hermes, idempotencia después de reinicio, bot/rutina real de Grok Bot, callback autenticado desde su nube, separación de contexto por grupo y ejecución visible en la UI nativa. Son criterios de aceptación futuros, no resultados de este research.
