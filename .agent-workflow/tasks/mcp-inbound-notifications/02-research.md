# Research: notificaciones de entrada para agentes

Fecha: 2026-10-23. Revisión r1. Repo en `50d0fa6`.
Las afirmaciones de protocolo usan fuentes primarias. Las recomendaciones propias
se identifican como propuestas en el diseño.

## Hallazgos del proyecto

| Preguntas | Hallazgo verificado | Evidencia local |
|---|---|---|
| R1 | El mensaje y los eventos de inbox se insertan en la misma transacción. Se omite el evento para el propio agente autor. | [messages-repository.ts](../../../apps/server/src/persistence/messages-repository.ts), líneas 135-151 |
| R2 | El receptor usa `/ws/agent`, Bearer y scope `agent:receive`. Revalida conexión, vencimiento y acceso al grupo antes de entregar un evento. Hay límite de receptores y corte para consumidores lentos. | [agent-ws/index.ts](../../../apps/server/src/adapters/agent-ws/index.ts), líneas 21-78 |
| R2 | La entrega en vivo usa memoria del proceso; no sustituye al inbox. El cliente desconectado recupera con `get_inbox`. | [hub.ts](../../../apps/server/src/realtime/hub.ts); [full-loop.spec.ts](../../../tests/e2e/full-loop.spec.ts), líneas 72-107 |
| R3 | `/mcp` construye un server y transporte por petición. No está conectado al hub como una suscripción de cambios del inbox. | [routes.ts](../../../apps/server/src/adapters/mcp/routes.ts), líneas 73-83 |
| R4 | El SDK instalado es `@modelcontextprotocol/sdk` 1.32.1. Su `LATEST_PROTOCOL_VERSION` es `2025-11-25`; la lista local no incluye `2026-07-28`. | package.json y `node_modules/@modelcontextprotocol/sdk/dist/esm/types.js`, líneas 2-4 |
| R8 | `get_inbox` y `ack_inbox` trabajan por agente. ACK no está separado por cliente OAuth ni por receptor. Las lecturas y ACK revalidan membresía. | [inbox/index.ts](../../../apps/server/src/modules/inbox/index.ts), líneas 76-104 |
| R8 | No hay lease de procesamiento ni outbox HTTP de webhooks en el esquema actual. Dos clientes del mismo agente pueden competir por el mismo evento. | Migraciones y puertos del módulo inbox |
| R8 | El servidor permite reconectar otro cliente OAuth a una identidad existente. Un nuevo cliente tiene su propia conexión y puede revocarse por separado. | [agents/index.ts](../../../apps/server/src/modules/agents/index.ts), sección createConnection |

Los enlaces son relativos a este paquete; las líneas corresponden a la base indicada.

## Protocolos: distinguir la versión instalada de la actual

**R4.** La página oficial de versionado identifica `2026-07-28` como versión actual.
No hay evidencia de que nuestro SDK instalado la negocie. Una migración requiere
validar servidor y cliente por separado. [MCP versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning).

En `2025-11-25`, Streamable HTTP permite un GET SSE opcional para mensajes del
servidor. El endpoint puede rechazarlo con 405. Soportar HTTP en `/mcp` no demuestra
que exista esa suscripción en nuestra aplicación.
[Transporte 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

En `2026-07-28` se retiraron GET SSE y las sesiones de protocolo; las notificaciones
persistentes usan la respuesta de `subscriptions/listen`. No conviene diseñar una
ampliación nueva suponiendo que GET SSE es el único estándar vigente.
[Transporte 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).

`subscriptions/listen` permite optar por cambios de listas y recursos, confirma
el filtro aceptado y mantiene un stream. Para el inbox, la aplicación podría exponer
un recurso propio y avisar que cambió. Eso exige implementar el recurso y demostrar
soporte en el host. [Subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions).

El SDK Python oficial advierte que su listen no reproduce eventos ni vuelve a
suscribirse automáticamente. Es evidencia para ese SDK, no una afirmación sobre
todos los clientes. El inbox durable sigue siendo necesario para recuperación.
[SDK Python: subscriptions](https://py.sdk.modelcontextprotocol.io/v2/api/mcp/client/subscriptions/).

## Un aviso no define cómo actúa el modelo

**R5.** Resources deja al host decidir cómo incorporar contexto; no obliga a iniciar
una generación ante una actualización. Por eso una notificación de recurso no basta
para prometer una respuesta autónoma de Codex.
[Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources/).

Sampling en `2025-11-25` requiere una capability declarada por el cliente y conserva
el control del host sobre el modelo. No se verificó aquí esa capability en Codex ni
un flujo de sampling apto para mensajes entrantes. No es nuestra base de activación.
[Sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling).

No se identificó en las fuentes consultadas una promesa de que registrar un webhook
arbitrario active cualquier host MCP. Un callback de Agent Chat sería una API de la
aplicación, aunque pueda administrarse mediante herramientas MCP. Esa conclusión
es una inferencia de los contratos examinados, no una prueba de inexistencia de
extensiones externas.

## Codex: evidencia y límites

**R6-R7.** La documentación oficial distingue `turn/start` para comenzar generación
y `turn/steer` para aportar entrada a un turno activo. La última operación exige
su identificador esperado. [Codex App Server](https://learn.chatgpt.com/docs/app-server).

La CLI instalada es 0.163.0. Su esquema se generó localmente, sin ejecutar un modelo:

```sh
codex app-server generate-json-schema --experimental --out /tmp/agent-chat-codex-protocol
codex queue --help
```

- `TurnStartParams` exige `threadId` e `input`.
- `TurnSteerParams` exige además `expectedTurnId`.
- Hay `mcpServer/event/stream/start`, pero su presencia en el esquema no demuestra
  que este servidor publique un stream compatible, ni que recibirlo active turnos.
- `codex queue` existe. No se ejecutó contra un hilo real durante el research.
  Su disponibilidad en ayuda no demuestra activación de una sesión ociosa ni
  integración con la UI de T3.
- Una instancia separada de App Server devolvió `already has an active writer`
  al intentar retomar el hilo interactivo de esta conversación. No se intentó
  eludir ese bloqueo.
- El proxy al daemon compartido venció esperando initialize en la prueba previa.
  Hay una CLI 0.163.0 y un daemon 0.164.0. Esa diferencia es observada, no una causa
  demostrada del timeout. La ruta de control del host sigue sin validación.

**R9. Prueba anterior a este research, en esta conversación:** mediante el cliente
local de Codex se verificaron get_identity, list_groups, read_messages y send_message.
El agente `test` pertenece al grupo `prueba`. Una consulta posterior de get_inbox
mostró un mensaje humano pendiente. No se ejecutó un turno de modelo por ese evento.
No copiamos tokens ni consumimos ese evento con ACK.

Las pruebas del repo sí cubren el receptor WS, recuperación y revocación. No cubren
la activación de una generación real de Codex a partir de un mensaje humano.
Esa es la pieza nueva que tiene que demostrar la prueba propuesta.

## Webhooks HTTP

**R10.** Standard Webhooks define convenciones para ID estable de entrega,
timestamp, firma y rotación. Se propone adoptarlas para el callback: HMAC sobre
ID, timestamp y bytes originales, verificación temporal y deduplicación. Un 2xx
del receptor será aceptación durable local, no procesamiento del inbox.
[Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md).

La firma autentica el origen; no sustituye autorización, control de destinos ni
ACK de aplicación. Estas últimas son decisiones propias de nuestro diseño.

## Incertidumbres que bloquean una promesa de activación automática

1. Resuelto el 2026-10-23: el usuario eligió hilo dedicado por grupo; incorporado
   al diseño r2. La sesión interactiva existente queda fuera del flujo.
2. Canal de control y ciclo de vida de los hilos dedicados: requiere prueba funcional.
3. Permisos mínimos y aislamiento de herramientas del worker Codex: deben demostrarse
   antes de darle mensajes de grupos como entrada automática.
4. OAuth del puente con almacenamiento opaco y refresh. Nunca exportar el token
   guardado por Codex para abrir el WS a mano.
5. Un único consumidor efectivo del inbox por agente/grupo, incluso con varias
   conexiones OAuth. El contrato actual no ofrece claim/lease para garantizarlo.
6. Visibilidad de un hilo de App Server externo dentro de T3: no está demostrada.
   No equivale a crear una conversación de T3.

Este research solo inspeccionó código, esquemas y fuentes. No disparó generaciones,
callbacks, suscripciones, ACK ni mensajes nuevos. No se ejecutó una nueva suite;
no hubo cambios de implementación.
