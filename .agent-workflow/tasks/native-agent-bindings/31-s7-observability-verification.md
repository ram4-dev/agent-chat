# S7: verificación de observabilidad nativa

Incremento de consulta en feat/native-notification-status, fuente737b60d. No cierra S7 completo ni S6. No activa proveedores.

## Cambios y acceso

El panel muestra target, conector, bot/profile, revisión, contexto y capacidades. Distingue cobertura, pausa, contacto del controlador, inicio incierto, aprobación, resultado guardado y recibo. La publicación requiere disposition=published más messageId. La API verifica dueño y membresía humana actual; oculta cuerpos al perder acceso el agente y no revela entregas de otros grupos. Señal reciente significa contacto en los últimos15 segundos, no salud del proveedor.

Se añade last_contact_at nullable en migración0012. Sus escrituras en open/next no liberan slots ni modifican claims, epochs, autoridad o publicación. El endpoint del dueño usa sesión y private,no-store; no añade scopes ni modifica OAuth.

## Verificación ejecutada

- pnpm lint: PASS.
- pnpm typecheck: PASS.
- pnpm build: PASS.
- pnpm test:unit:162 PASS.
- pnpm test:contracts:15 PASS.
- pnpm test:integration:204 PASS.
- pnpm test:e2e:27 PASS,6 skips,48.6s.
- git diff --check: PASS; hashes protegidos03/04r2 sin cambios.

Total408 PASS. Cinco E2E requieren la instalación Hermes y uno requiere opt-in de inferencia Codex real. Se omitieron explícitamente con AGENT_CHAT_HERMES_SOURCE y AGENT_CHAT_REAL_CODEX ausentes para respetar la restricción sobre ~/.hermes y evitar inferencia o mensajes reales. No hay suite Python independiente nueva; no se ejecutó el fixture Python que importa Hermes instalado.

El servidor final usó Node22.23.3 mediante Portless agent-chat-native-status, DB nueva .local-state/native-status-final.db. Fixtures de supervisor/webhook usan sus propias DB temporales. Se cerraron únicamente los dos procesos del servidor de esta verificación. Servicios previos del usuario se conservaron.

## Navegador y capturas

El nuevo E2E recorre estado pausado, capacidades desconocidas, actividad vacía, error503 con retiro de estado anterior, reintento con foco visible, grupo sin cobertura y viewport390px sin desborde horizontal. El E2E Grok existente añade comprobaciones de UI contra el protocolo real del fixture: aceptación sin inicio del bot ni recibo, luego publicación con salida y recibo, antes de continuar recuperación/duplicados/silencio/pausa.

Capturas inspeccionadas en .local-state/native-status-desktop.png, native-status-mobile.png y native-status-published.png. Se ajustó presentación de metadatos/actividad y quiebre de referencias largas; el E2E completo posterior pasó. No hubo fallos en la ejecución final. Durante preparación, typecheck detectó una exportación faltante del contrato nuevo; fue corregida antes de la suite completa.

## Pendientes

Revisión independiente de este incremento pendiente. S6 Codex nativo, consentimiento/controles de UI y migración/rollback de prueba siguen como trabajo independiente. Aceptación personal Hermes/Codex y S0 global siguen pendientes; no se les atribuye compatibilidad real por estos fixtures.

Grok real conserva los bloqueos de26-s5-decisions.md: señal terminal durable y quiescencia verificables, challenge bot/rutina, retorno público y controlador persistente. Rama deberá elegir dónde operar24/7 y autorizar despliegue/conexión automática separada cuando exista el retorno verificable. Elegir Vercel antes no modifica los grants actuales ni resuelve esa capacidad. No hace falta una decisión de Rama para continuar el trabajo aislado restante.

Sin push, PR, mensajes reales, cambios OAuth ni acceso a ~/.hermes. No se borraron datos del usuario.
