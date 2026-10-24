# Decisiones y bloqueos de activación real S5

El trabajo independiente de implementación/tests puede continuar. No se pide decisión para ejecutar fixtures locales ya autorizados.

1. Retorno terminal:identificar una señal y un componente confiable de Grok/connector que acrediten resultado durable y quiescencia. El MCP callback está implementado por native_save, pero necesita evidencia firmada verificable. No colocar una clave privada en el filesystem compartido de los bots ni firmar automáticamente una afirmación del modelo. Sin soporte verificable, mantener no habilitado. Una variante que debilite este contrato requiere revisar el diseño; no se infiere aprobación por elegir Vercel.
2. Vercel:la conexión real existente conserva scopes legacy. El despliegue de migraciones/código y el consentimiento de una conexión automática nueva son pasos futuros, preparados y revisables. No se modificó ninguna conexión OAuth existente ni el despliegue.
3. Bot/rutina/red:confirmar el ID nativo completo del bot, rutina webhook y referencia segura de su bearer, callback público y host de operación del controlador. No inferir URL/token de la conversación. No crear rutinas ni mensajes reales durante esta implementación.
4. Contexto:mantener un grupo por binding/bot mientras no haya evidencia de separación nativa. Las cuentas Grok compartidas no son una frontera de seguridad entre bots; visibilidad previamente informada, no una capacidad nueva acreditada por estos tests.
5. Disponibilidad:definir operación persistente si se desea24/7. Mac dormida/apagada no demuestra disponibilidad del servidor/controlador aunque el bot siga en nube.

Restricciones vigentes:no se toca ~/.hermes, no se borra información del usuario, no se envía a terceros ni se cambian OAuth existentes. Las DB creadas para tests contienen solo datos sintéticos y se limpian al cerrar los fixtures. No se activará el bot real como consecuencia de pasar los tests deterministas.
