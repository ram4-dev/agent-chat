# Prueba funcional del MVP

Fecha: 2026-10-23, entre las 02:20 y las 02:31 (America/Sao_Paulo).
Destino: https://agent-chat.localhost. Navegador: T3, perfiles Default e Incognito.
Pantallas revisadas: 1280 × 800 y 390 × 844 CSS px.

El recorrido funcionó con dos personas y un agente externo real. Se encontraron
y corrigieron tres detalles de interfaz. No quedaron fallos funcionales abiertos
en los flujos recorridos. Las menciones tienen una limitación descrita abajo.

## Entorno y método

Se usó el servicio local existente, con cuentas nuevas llamadas Ada QA y Sol QA,
dos conversaciones de QA y el agente Scout QA. La segunda persona aceptó una
invitación desde su registro. Después se mantuvieron abiertas dos sesiones de
navegador independientes para comprobar los mensajes en vivo en ambos sentidos.
No se modificaron cuentas ni conversaciones anteriores.

El cliente externo usó el SDK oficial de MCP: discovery, registro dinámico,
OAuth con PKCE, consentimiento en el navegador y conexión al MCP real del mismo
origen. Su receptor abrió un WebSocket autenticado. Se comprobó publicación,
recepción de un evento, respuesta explícita del cliente y `ack_inbox`.
No hubo respuestas automáticas generadas por el servidor.

Los errores de envío y carga de agentes se provocaron una sola vez mediante
`fetch` en la pestaña de QA. El envío falló con una excepción de red y la carga
con un 503. El resto de las peticiones y los reintentos usaron el servidor real.
La invitación rechazada fue una invitación real ya utilizada; no se adelantó
el reloj ni se alteró la base para simular su vencimiento. La expiración real
está cubierta por la suite de integración, y la UI comparte el aviso para
invitaciones vencidas, usadas o inválidas.

## Recorrido y capturas

Cada enlace abre la captura del paso. La captura 09 corresponde a una segunda
comprobación del intercambio en vivo al final del recorrido. La captura 33
oculta el valor de una invitación todavía vigente.

| Paso | Resultado observado | Captura |
|---|---|---|
| Acceso | Formulario y presentación en español | [01](evidence/01-acceso.png) |
| Registro de Ada | Sin conversaciones, con acción para crear una | [02](evidence/02-conversaciones-vacias.png) |
| Mis agentes vacío | Explicación y acción para crear un agente | [03](evidence/03-agentes-vacios.png) |
| Crear conversación | Diálogo con nombre y confirmación | [04](evidence/04-crear-conversacion.png) |
| Abrir conversación nueva | Chat vacío y compositor disponibles | [05](evidence/05-chat-vacio.png) |
| Primer mensaje | Publicación como Ada | [06](evidence/06-primer-mensaje.png) |
| Invitar | Enlace generado; se detectó puntuación duplicada | [07](evidence/07-invitacion-antes.png) |
| Registro y entrada de Sol | Invitación conservada y mensaje con `@Ada QA` | [08](evidence/08-segunda-persona-y-mencion.png) |
| Personas en vivo | Ada recibe a Sol sin recargar; también se probó el sentido inverso | [09](evidence/09-chat-personas-en-vivo.png) |
| Autorizar cliente | Consentimiento en español, identidad y permisos visibles | [10](evidence/10-consentimiento-oauth.png) |
| Agregar agente | Selección del agente propio y admisión al grupo | [11](evidence/11-agregar-agente.png) |
| Chat con agente | Publicación MCP y mensaje humano con `@Scout QA` | [12](evidence/12-chat-con-agente-y-mencion.png) |
| Respuesta del agente | Autor y dueño visibles; respuesta enviada por el cliente externo | [13](evidence/13-respuesta-agente.png) |
| Miembros en móvil | Personas, agente y receptor activo legibles | [14](evidence/14-miembros-mobile.png) |
| Chat en móvil | Compositor y mensajes accesibles, sin desborde horizontal | [15](evidence/15-chat-mobile.png) |
| Navegación en móvil | Drawer con grupos y Mis agentes | [16](evidence/16-navegacion-mobile.png) |
| Invitación usada | Aviso de error y diálogo recuperable | [17](evidence/17-invitacion-usada-error.png) |
| Envío sin red | Aviso visible y borrador conservado | [18](evidence/18-envio-fallido-borrador.png) |
| Reintentar envío | Mensaje publicado y borrador limpiado | [19](evidence/19-reintento-enviado.png) |
| Segunda conversación | Creación y apertura; se detectó “1 integrantes” | [20](evidence/20-segunda-conversacion.png) |
| Buscar sin coincidencias | “No hay grupos con ese nombre” | [21](evidence/21-busqueda-sin-resultados.png) |
| Gestión móvil | Perfil y estado del receptor visibles | [22](evidence/22-agentes-mobile.png) |
| Conectar cliente | Dirección MCP e instrucciones en español | [23](evidence/23-instrucciones-mcp.png) |
| Editar perfil | Descripción guardada y reflejada en la tarjeta | [25](evidence/25-perfil-descripcion-guardada.png) |
| Inspeccionar conexiones | Cliente autorizado y acción para desconectar | [27](evidence/27-conexiones-abiertas.png) |
| Confirmar desconexión | Consecuencias explicadas antes de aplicar | [28](evidence/28-confirmacion-desconexion.png) |
| Desconectar | Cliente desconectado y receptor cerrado | [29](evidence/29-cliente-desconectado.png) |
| Error al cargar agentes | Aviso y acción de reintento | [30](evidence/30-error-carga-agentes.png) |
| Recuperar carga | Desaparece el aviso y vuelve la tarjeta | [31](evidence/31-carga-agentes-recuperada.png) |
| Revisar corrección 1 | “1 integrante” en la conversación nueva | [32](evidence/32-contador-singular-corregido.png) |
| Revisar corrección 2 | Vencimiento con un solo punto final | [33](evidence/33-vencimiento-corregido.png) |
| Revisar corrección 3 | “Ya está en…” deshabilitado para el agente admitido | [34](evidence/34-pertenencia-grupo-corregida.png) |

También se comprobó que el historial persiste al volver a abrir una conversación
y que un cliente desconectado recibe `unauthenticated` al intentar publicar.
Ese intento no creó un mensaje. Los mensajes anteriores del agente siguieron
visibles en ambas sesiones.

## Hallazgos corregidos y tests

| Hallazgo | Corrección | Regresión automatizada |
|---|---|---|
| El encabezado decía “1 integrantes” | Singular para un miembro y plural para varios | Aserciones de “1 integrante” y “2 integrantes” en `ui-redesign.spec.ts` |
| El vencimiento terminaba en “a. m..” | Se quitó el punto agregado después de la fecha localizada | La fecha del diálogo no puede terminar en dos puntos consecutivos |
| Mis agentes ofrecía agregar un agente que ya pertenecía al grupo | La tarjeta recibe los miembros del grupo y muestra “Ya está en…” deshabilitado | Admisión, estado deshabilitado, recarga y verificación de un solo miembro agente |

Las tres correcciones se volvieron a revisar en el origen HTTPS solicitado,
con el frontend reconstruido. La lógica de autorización del backend no cambió.

## Alcance de menciones y límites

Se enviaron y recibieron mensajes con `@Ada QA` y `@Scout QA`, incluyendo un
mensaje entregado al receptor del agente. El texto se conserva tal como se
escribió. El MVP no ofrece un selector de destinatarios, resaltado de menciones,
notificaciones específicas ni activación automática de agentes mediante `@`.
Eso sigue siendo una funcionalidad pendiente si se espera una mención semántica.

La revisión móvil utilizó el viewport del navegador de escritorio; no reemplaza
una prueba en dispositivos físicos. Esta revisión no cubre otros motores de
navegador, lectores de pantalla, carga ni despliegue de producción.

## Verificación final

`pnpm verify`, con Node.js 22.23.3, completó:

- ESLint, typecheck y build de todos los paquetes.
- 148 tests unitarios, 15 de contratos y 117 de integración.
- 17 E2E en Chromium, incluyendo OAuth, MCP, WebSocket y los nuevos casos de UI.
- `git diff --check` sin errores.

Una primera ejecución del nuevo check de puntuación tuvo un selector ambiguo:
`.field-hint` coincidía con el estado de copia y con la fecha. Se corrigió a
`p.field-hint`; luego se volvió a ejecutar la suite completa y quedó verde.

## Estado de entrega

Rama: `feat/ui-redesign`. Base de esta revisión: `b7cee2a`.
Worktree: `/Users/ramiro/Desktop/projects/agent_chat.feat-ui-redesign`.
El servidor principal permanece disponible en https://agent-chat.localhost.
Las cuentas y conversaciones de QA quedan disponibles para inspección; el
cliente externo fue desconectado y su proceso auxiliar se cerró al terminar.
No se hizo push ni se abrió un PR.

El índice de las 32 imágenes está en [screenshots.json](screenshots.json).
