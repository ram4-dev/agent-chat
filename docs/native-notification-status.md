# Estado de las notificaciones nativas

En **Mis agentes**, el receptor nativo muestra su estado para el grupo seleccionado. La vista es de consulta: no activa el bot, no cambia sus permisos y no reemplaza conexiones existentes.

- **Receptor nativo configurado** indica que existe un binding. No acredita que el controlador esté conectado.
- **Señal reciente** indica que el controlador autorizado abrió o consultó el receptor durante los últimos 15 segundos. No confirma recepción del webhook ni ejecución del bot.
- **Notificación aceptada; inicio del bot pendiente** distingue la aceptación del webhook de la autorización de procesamiento del bot.
- **Respuesta publicada** requiere un recibo con un mensaje publicado. Un resultado guardado, un turno terminado o un ACK manual no bastan.
- Los estados de aprobación, inicio incierto, revisión, pausa y falta de cobertura se muestran por separado.

La vista incluye bot/profile, conector, revisión, modo de contexto y capacidades registradas. Las referencias de ejecución y conversación se muestran como texto: no se inventan enlaces a un visor del proveedor.

La actividad está limitada a las últimas 30 entregas de la revisión y grupo actuales. Solo el dueño de la identidad, con membresía vigente en ese grupo, puede consultarla. Si el agente perdió acceso, no se devuelven cuerpos. Un turno de otro grupo puede indicar un bloqueo, pero no revela su contenido ni identificadores. El contenido vencido se indica expresamente y se conserva el recibo conforme a la retención existente.

La siguiente consulta comienza tres segundos después de terminar la anterior, sin solapamiento. Durante la consulta se indica que el estado se está actualizando. Si la respuesta tarda más de ocho segundos, se retira el estado anterior y aparece un error con reintento. Una pausa se muestra junto al estado del turno pendiente: no confirma su cancelación ni finalización. El endpoint de sesión del dueño es `GET /api/agents/:agentId/native-status/:groupId`, con respuesta privada y sin caché. No utiliza ni modifica OAuth.

## Verificación local

Los comandos generales de instalación y ejecución están en el README. Después del build, las pruebas específicas son:

```sh
pnpm exec vitest run --project unit tests/unit/native-status-ui.test.ts
pnpm exec vitest run --project integration tests/integration/native-delivery.test.ts tests/integration/native-status-http.test.ts
pnpm exec playwright test tests/e2e/native-status.spec.ts tests/e2e/grok-notifications.spec.ts
```

El E2E de Grok usa un webhook y resultados sintéticos locales. No demuestra compatibilidad terminal, vinculación ni disponibilidad del bot real. La activación real continúa sujeta a los requisitos de la guía de Grok.

Este incremento cubre observabilidad de S7. Siguen pendientes el adaptador Codex nativo de S6, controles y consentimiento desde UI, migración/rollback de prueba y aceptación personal de los adaptadores. Esas tareas no se consideran bloqueadas por la falta de capacidades de Grok.
