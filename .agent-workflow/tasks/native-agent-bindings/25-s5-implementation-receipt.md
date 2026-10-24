# S5: implementación de notificaciones automáticas

Solicitud vigente:implementar y verificar en rama de trabajo, sin push a main, mensajes reales, borrado de datos, acceso a ~/.hermes o cambios de conexiones OAuth existentes. Decisiones necesarias se anotan sin detener trabajo independiente.

- Fuente:feat/native-agent-bindings en40ab8b8.
- Rama nueva:feat/grok-notifications.
- Worktree nuevo:/Users/ramiro/Desktop/projects/agent_chat.feat-grok-notifications, creado con Worktrunk2026-10-24. Fuente y main intactos.
- Alcance:despacho webhook durable de referencias opacas; autorización remota de inicio de consumo único; retorno por las operaciones MCP nativas ya existentes, con evidencia terminal firmada; publicación+ACK existentes. Transporte cloud restringido a HTTPS/destinos públicos aprobados. Fixture webhook falso con credenciales sintéticas y servicios temporales.
- Límites:la cuenta real en Vercel sigue con scopes legacy; no se reclasifica ni modifica. Prueba real de callback/atestación terminal y despliegue quedan pendientes de decisión/evidencia. No considerar firma de texto o HTTP200 prueba de quiescencia nativa.
- No se ejecutan los E2E opt-in Hermes ni se lee su instalación; no se ejecutan modelos de pago. Todos los envíos de prueba van a un fixture local explícito mediante un puerto de transporte acotado; el entrypoint productivo no permite ese bypass.
