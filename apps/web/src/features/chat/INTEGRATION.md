# Chat: integración de UX-01, UX-02 y UX-07

Los borradores y las claves de reintento viven en memoria, por `user.id` y `groupId`. Sobreviven a desmontar el chat, cambiar de grupo y visitar Mis agentes dentro del mismo documento. Una recarga cierra esta sesión de borradores. No se escriben en almacenamiento persistente.

## Cierre de sesión

Importar `clearUserDrafts` desde `features/chat/ChatPanel` y llamar `clearUserDrafts(user.id)` después de confirmar el logout y antes de pasar a la sesión anónima. También llamarlo al invalidar una sesión autenticada por expiración o cambio de cuenta. El ID del usuario a limpiar debe ser el de la sesión anterior. Una respuesta tardía no recrea sus borradores.

La clave por usuario impide mostrar el borrador de otra cuenta. La llamada del shell es necesaria para eliminar el borrador de la cuenta que cerró sesión, incluso si el chat ya estaba desmontado en Mis agentes.

## Mensajes visibles

`ChatContainer` acepta `onMessagesDisplayed?: (messageIds: readonly string[]) => void`. Pasar aquí el handler de lectura del grupo seleccionado. Recibe IDs en orden ascendente de historial solo cuando los artículos intersectan el viewport del chat y del documento, con `document.visibilityState === 'visible'`. Puede volver a emitir IDs ya vistos; el receptor debe deduplicarlos. No emite mensajes sin cargar ni mensajes nuevos fuera de pantalla cuando la persona está leyendo más arriba. El observer se elimina al desmontar el chat.

## Markdown reutilizable

`MessageMarkdown` se puede importar desde `features/chat/MessageMarkdown` con la prop `text: string`. Importa su CSS propio. Usa `react-markdown` y `remark-gfm`; admite enlaces absolutos HTTP(S), énfasis, listas, tablas y código con acción Copiar y feedback. El HTML queda como texto inerte. Los enlaces relativos y otros protocolos no se activan; las imágenes se muestran por su texto alternativo para evitar solicitudes remotas. No agregar `rehype-raw` ni plugins que ejecuten HTML.

## Destinatarios

Una selección guarda ID, nombre y rango de texto. Editar o quitar el token invalida esa identidad; no se buscan IDs por nombre. Las menciones pendientes bloquean el envío, incluso con cero bots. Correos, URLs, bloques de código y código en línea conservan su significado literal. El texto sin menciones conserva el contrato existente: omite `mentionedAgentIds` y el servidor resuelve los bots habilitados del grupo. La proyección actual de miembros no expone habilitación individual; la leyenda de difusión evita inventar una cantidad de bots elegibles.

## Validación

Las pruebas propias son `chat-ux-drafts-mentions.test.ts`, `chat-ux-displayed-messages.test.ts`, `chat-ux-markdown.test.ts`, `chat-ux-session-markdown.spec.ts` y `chat-ux-bot-markdown.spec.ts`. El E2E usa una base SQLite descartable y puede apuntar a un servidor Portless propio con `AGENT_CHAT_E2E_BASE_URL`. Las pruebas de protocolo OAuth/MCP existentes deben respetar su origen canónico; si usan 4319, serializar la ejecución con `/tmp/agent-chat-uiux-e2e.lock`.
