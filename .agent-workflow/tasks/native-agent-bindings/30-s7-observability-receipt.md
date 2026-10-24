# S7: observabilidad nativa independiente

Solicitud vigente:avanzar la próxima tarea de notificaciones que no dependa de Grok, verificar y corregir, sin OAuth/~/.hermes/mensajes reales/pushmain/PR. Hay trabajo independiente pendiente; no se declara que todo esté bloqueado.

- Fuente:feat/grok-notifications en737b60d, sin cambios pendientes.
- Worktree nuevo:/Users/ramiro/Desktop/projects/agent_chat.feat-native-notification-status.
- Rama nueva:feat/native-notification-status, creada con Worktrunk2026-10-24.
- Incremento elegido de S7:vista de solo lectura de binding/target/capacidades/cobertura/señal del controlador/actividad y recibos. Corrige etiquetas legacy que no representan al receptor nativo. No incorpora consentimiento, activación, reasignación de OAuth, migración real o controles de ejecución nuevos.
- Señal reciente indica contacto del controlador; no demuestra recepción de webhook ni ejecución/terminación del bot. Las salidas/entradas se limitan a grupos donde dueño y agente conservan acceso. No revelar contenido de otros grupos cuando el slot global está bloqueado.
- S6 (adaptador Codex nativo y aceptación personal) sigue pendiente como otra línea independiente; no se atribuye a capacidades faltantes de Grok. Este incremento cierra una parte autónoma de S7 directamente vinculada a las notificaciones. Migración/rollback de prueba, controles UI y aceptación real siguen separados.

## Implementación

Migración0012 añade last_contact_at nullable al registro de controladores. open/next actualizan esa señal sin cambiar claims, epochs, activación, inicio ni publicación. API del dueño y panel nativo de consulta separan cobertura, pausa, contacto, ejecución y recibos. La vista legacy se conserva para identidades legacy. No se añaden scopes ni capacidades a proveedores.

La actividad requiere dueño y membresía humana vigente; la ausencia de membresía del agente oculta contenido. La retención existente de resultados se refleja también ocultando entrada vencida; recibos y referencias se conservan según el contrato anterior. Un bloqueo en otro grupo solo devuelve un booleano.
