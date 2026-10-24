# S5: identidad de Vercel vinculada

Fecha2026-10-24. El usuario eligió explícitamente usar la instancia pública de Vercel y aceptó que la cuenta adicional fuese visible para otros bots. Se conserva la cuenta default/grokbot. La identidad local de23 sigue independiente y no se usa para esta conexión.

## Flujo verificado en UI

Se reabrió OAuth de la cuenta adicional agent-chat-test en Grok Bot. Un primer consentimiento terminó, pero la comprobación get_identity seguía devolviendo grokbot; no se dio por correcto. Se rehízo únicamente la autorización de esa cuenta adicional mediante su flujo nativo, sin modificar default.

En el consentimiento de agent-chat-preview-kappa.vercel.app se escribió Agent Chat Test mediante setValue y se verificó visualmente que la radio de grokbot no estuviera seleccionada. Se autorizó la creación/vinculación de la identidad nueva. La página de callback mostró autorización completada y Grok mostró la cuenta conectada. No se guardaron códigos OAuth, tokens o secretos en el reporte.

El bot comprobó get_identity con la cuenta agent-chat-test y devolvió:

- Identidad:Agent Chat Test.
- Agent ID de Vercel:4c47fe0c-3f18-4507-a8c0-0f6fc7b63e10.
- Activo; scopes agent:read,agent:send,agent:inbox,agent:receive.
- Cuenta distinta de default, que sigue representando grokbot según su comprobación.

Se indicó al bot seleccionar explícitamente agent-chat-test y comprobar identidad antes de futuras pruebas; ante discrepancia debe detenerse, sin fallback a default. Esta indicación no constituye aislamiento de credenciales entre bots: la visibilidad compartida fue informada y aceptada.

## Alcance

Creación y vínculo MCP/OAuth completados y resultado observado en la UI. Evidencia de get_identity aportada por el bot conectado, sin llamada independiente de servidor en este incremento. No se desplegó el código nuevo de bindings ni se declararon verificados grants nativos de S2/S3 en esa instancia pública. No se leyeron/publicaron/confirmaron mensajes de grupo ni se crearon rutinas nuevas. Notificaciones/webhook/callback y aceptación completa S5 siguen pendientes.

Sin cambios de código, configuración de servicios, secretos o conexiones anteriores; sin push/PR. Verificación de este incremento operativo:UI de consentimiento/estado conectado y resultado de get_identity; git diff --check. Los391 PASS de Hermes no se atribuyen a esta operación.
