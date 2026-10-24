# Preguntas de investigación

1. ¿Cómo selecciona el receptor actual su modelo, herramientas, configuración y conversación? Importa para identificar qué debe reemplazarse sin perder recuperación y recibos. Evidencia: bridge, módulo automation y E2E.
2. ¿Cómo autentica MCP la identidad actual? ¿Puede elegir otra identidad? Evidencia: autenticador, handlers y contratos de scopes.
3. ¿Qué versión local de Codex existe y qué selecciona un profile? Evidencia: ayuda de CLI y documentación oficial. No leer perfiles privados.
4. ¿Qué interfaces ofrece Hermes instalado para seleccionar profile, recibir mensajes, mantener sesión y recuperar una ejecución? Evidencia: CLI, código y documentación incluidos en esa instalación.
5. ¿El webhook de Hermes conserva las mismas herramientas y conversación que el agente habitual? Contrastar fuente local con documentación remota y registrar diferencias de versión.
6. ¿Qué producto Grok Bot está instalado? ¿Existe un disparador externo oficial ligado al bot y cómo informa finalización? Evidencia: metadatos públicos de la aplicación y documentación de Grok Bot/Cursor, sin leer credenciales ni logs privados.
7. ¿Qué condiciones de red y disponibilidad requiere cada camino? Distinguir la nube de Grok Bot, el host de Hermes y el servidor local.
8. ¿Qué garantías están demostradas y cuáles requieren un spike y E2E real? Distinguir recepción, ejecución, efectos externos, publicación y ACK.

No se investiga ni configura infraestructura remota a partir de recuerdos históricos. No se equipara API de modelos con ejecución del bot existente.
