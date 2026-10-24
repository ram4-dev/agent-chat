> Documento histórico del review inicial del 23 de octubre. El estado integrado vigente está en [README](README.md), [servicios administrados](docs/managed-services.md) y el recibo de integración del PR 1.

# Review y plan de acceso a Agent Chat

Fecha: 23 de octubre de 2026. Estado: propuesta para priorizar; no autoriza despliegue ni cambia decisiones aprobadas.

## Conclusión

Agent Chat ya tiene una base funcional para grupos privados con personas y agentes externos. Para abrirlo a personas sin conocimientos técnicos falta resolver la entrada al producto, la conexión guiada del agente, la recuperación de cuenta y la operación de un servicio accesible por URL. También hay barreras de accesibilidad que los checks actuales no detectan.

Interpreto «accesible para cualquiera» en tres sentidos: usar el chat sin instalar herramientas de desarrollo; sumar un agente sin comprender sus protocolos; y completar los recorridos con distintas capacidades, dispositivos y tecnologías de asistencia. El objetivo no convierte los grupos privados en públicos ni supone compatibilidad con todos los clientes de agentes.

Recomiendo empezar con un piloto web alojado, por invitación, con interfaz en español y un cliente de agentes validado de punta a punta. La apertura de registro se evalúa después de probar operación, recuperación y abuso. Alojar agentes sería una ampliación de producto separada.

## Base revisada y límites

La carpeta principal está en `main`, sin commits, y conserva documentos de una etapa anterior. La implementación más avanzada registrada en los worktrees está en `feat/ui-redesign`, commit `50d0fa61b8dadd468d9e4f4e480a45a2d3b34b63`.

- [README.md](./README.md): producto implementado, arranque, conexión externa y límites.
- [App.tsx](./apps/web/src/app/App.tsx): navegación, sesiones, invitaciones y grupos.
- [AuthPanel.tsx](./apps/web/src/features/auth/AuthPanel.tsx), [AgentsPanel.tsx](./apps/web/src/features/agents/AgentsPanel.tsx), [ChatPanel.tsx](./apps/web/src/features/chat/ChatPanel.tsx), [GroupPanel.tsx](./apps/web/src/features/groups/GroupPanel.tsx): recorridos principales.
- [ui.tsx](./apps/web/src/shared/ui.tsx), [responsive.css](./apps/web/src/app/responsive.css) y [accessibility.spec.ts](./tests/e2e/accessibility.spec.ts): componentes y cobertura de accesibilidad.
- [03-design-discussion.md](./.agent-workflow/tasks/mcp-inbound-notifications/03-design-discussion.md): propuesta del puente externo, todavía sin implementación en esta base.

Se revisaron documentación, frontend, contratos de acceso y recepción, autenticación humana, configuración y pruebas. No es una auditoría exhaustiva de seguridad de cada módulo ni una certificación de accesibilidad. No se evaluaron producción, carga, lectores de pantalla ni dispositivos físicos.

## Lo que conviene conservar

El chat humano funciona sin configurar un agente. La interfaz distingue personas, agentes y dueños; OAuth separa la autoridad del agente de la humana. Hay grupos privados, invitaciones, reintentos idempotentes, revocación, inbox durable y recepción en vivo. El backend usa un proceso y SQLite, lo que reduce dependencias del piloto. La UI en español ya ofrece estados vacíos, errores recuperables y diseño móvil.

## Hallazgos priorizados

### R1 · P1 · Conectar un agente sigue siendo un recorrido técnico

La pantalla entrega una URL MCP y pide configurar un cliente compatible. Para recepción en vivo exige además mantener un receptor externo. No ofrece selección de cliente, comprobación de compatibilidad, diagnóstico por paso ni prueba de envío y recepción. Una persona puede crear la identidad y creer que ya tiene un asistente funcionando.

Evidencia: [AgentsPanel.tsx:462](./apps/web/src/features/agents/AgentsPanel.tsx:462) y [README.md:86](./README.md:86). El puente diseñado por separado todavía no elimina esta barrera en el producto actual.

Acción: asistente de conexión con un cliente validado, pasos verificables y estados separados de identidad, autorización, pertenencia al grupo, recepción y procesamiento. Mostrar la configuración manual dentro de una sección avanzada.

### R2 · P1 · El contraste de textos pequeños necesita corrección

El texto secundario de acceso usa `#7b8780` sobre `#fbfcfa`: 3,63:1, a 13 px. La pestaña de acceso no seleccionada usa `#89958b` sobre `#f0f3ee`: 2,79:1. Los colores y tamaño del primer par se comprobaron también sobre estilos calculados en el navegador. Ambos quedan por debajo de 4,5:1 para texto normal.

Evidencia: [responsive.css:12](./apps/web/src/app/responsive.css:12), [responsive.css:524](./apps/web/src/app/responsive.css:524) y [responsive.css:554](./apps/web/src/app/responsive.css:554). Referencia: [WCAG 2.2, contraste mínimo](https://www.w3.org/TR/WCAG22/#contrast-minimum).

Acción: corregir tokens y estados; comprobar texto, controles y foco sobre cada fondo real. Auditar también placeholders y la identificación del dueño del agente.

### R3 · P1 · Los checks básicos dejan fuera recorridos completos de teclado

Una prueba exploratoria contra el servidor real confirmó que, al cerrar «Crear grupo» con Escape, el foco queda en `BODY`. A 390 px, Tab llega a «Cerrar navegación» con el menú oculto y su borde derecho en la coordenada 0. La navegación móvil se oculta por desplazamiento CSS, sin retirar sus controles del orden de foco. También se comprobó que ArrowLeft desde la pestaña «Ingresar» no mueve el foco ni cambia la selección. Las pruebas actuales verifican nombres, roles y foco de controles seleccionados; no prueban estos recorridos completos.

Evidencia: [ui.tsx:160](./apps/web/src/shared/ui.tsx:160), [GroupPanel.tsx:49](./apps/web/src/features/groups/GroupPanel.tsx:49), [responsive.css:2142](./apps/web/src/app/responsive.css:2142) y [AuthPanel.tsx:89](./apps/web/src/features/auth/AuthPanel.tsx:89).

Acción: restaurar foco con un destino alternativo cuando el disparador desaparece; retirar controles ocultos del orden de teclado; definir entrada, salida y Escape del drawer. Completar el patrón de pestañas o simplificarlo. Probar mensajes nuevos e historial con lector de pantalla para evitar anuncios excesivos.

### R4 · P1 antes de una beta · No existe recuperación de cuenta

La interfaz y el módulo de autenticación ofrecen registro, login, logout y sesión. No hay recorrido de recuperación de contraseña. Perderla impide volver al grupo y gestionar las conexiones propias.

Evidencia: [AuthPanel.tsx](./apps/web/src/features/auth/AuthPanel.tsx) y [index.ts:40](./apps/server/src/modules/auth/index.ts:40).

Acción: diseñar recuperación verificable y accesible, con expiración, uso único, límites de intentos y respuestas que no revelen cuentas existentes. Elegir el mecanismo y su entrega antes de implementar; introducir email o un proveedor de identidad agrega una dependencia operativa hoy ausente.

### R5 · P1 · Crear una identidad no garantiza una primera experiencia útil

«Nuevo agente» crea un perfil, pero no un runtime que responda. El estado vacío habla de cliente MCP y la tarjeta de runtime y receptor. Son conceptos correctos para una integración, pero necesitan explicación para una persona que solo quiere sumar un asistente.

Evidencia: [AgentsPanel.tsx:174](./apps/web/src/features/agents/AgentsPanel.tsx:174) y [AgentsPanel.tsx:229](./apps/web/src/features/agents/AgentsPanel.tsx:229).

Acción: guiar hacia «conectar tu agente», explicar qué falta con una acción concreta y confirmar el primer mensaje. Mantener el chat humano utilizable sin configurar agentes. No mostrar «listo para responder» por el solo hecho de tener un socket conectado.

### R6 · P1 antes de compartir una URL externa · La operación pública no está validada

La evidencia disponible corresponde a un MVP local de un proceso. No hay validación de despliegue, backup/restauración, carga o múltiples motores de navegador. Una URL externa requiere además almacenamiento persistente, claves durables, recuperación y una persona responsable de operar el servicio.

Evidencia: [README.md:202](./README.md:202). Es un pendiente de preparación, no un fallo de producción demostrado.

Acción: mantener un nodo para el piloto; preparar TLS, proxy, volumen persistente, secretos por `vault-env`, backup consistente de SQLite, restauración ensayada, monitoreo y rollback. Definir retención, eliminación/exportación de datos y soporte. Antes del registro abierto, validar presupuestos de uso, abuso y aislamiento entre grupos.

### R7 · P2 · Faltan señales de atención cotidiana

Las menciones son texto y no seleccionan destinatarios ni generan avisos específicos. La lista de grupos no muestra no leídos. Eso obliga a recorrer conversaciones para descubrir actividad. La ausencia de notificaciones no impide conversar en la ventana activa, pero limita el uso diario.

Evidencia: [README.md:12](./README.md:12) y [GroupPanel.tsx:125](./apps/web/src/features/groups/GroupPanel.tsx:125).

Acción: empezar con no leídos y nuevas menciones verificables. Separar una mención a una persona o agente de cualquier autorización para ejecutar trabajo; controlar silenciamiento y evitar ciclos de agentes antes de automatizar respuestas.

### R8 · P2 · La entrada para colaboradores apunta a una base desactualizada

La carpeta principal no contiene aplicación, mientras los worktrees sí. Los documentos antiguos excluyen el inbox que el PRD r2 y la implementación incluyen. Quien empiece desde la raíz puede planificar sobre decisiones superadas o concluir que no existe código.

Evidencia: `git worktree list`, `git log` de cada checkout y [02-research.md:72](/Users/ramiro/Desktop/projects/agent_chat/.agent-workflow/tasks/agent-chat-mvp/02-research.md:72), frente a [README.md](./README.md).

Acción: identificar una rama de referencia, agregar un índice de estado y marcar antecedentes superados. Preparar la integración del trabajo existente sin mezclar ni descartar cambios ajenos. No se realizó ningún merge en este review.

## Plan de entrega

### Etapa 0 · Establecer la base

Responsabilidad: mantenimiento del repositorio y producto. Dependencia: ninguna.

Registrar la rama de referencia y el estado real de MVP, rediseño y puente. Publicar instrucciones distintas para usuario, dueño de agente y desarrollador. Convertir los hallazgos en tareas con evidencia y criterios de salida. Elegir el cliente inicial por una prueba de OAuth, lectura, envío y recepción; no por compatibilidad declarada.

Salida: una persona nueva encuentra el código y sabe qué está implementado, qué está propuesto y cómo reproducir la verificación.

### Etapa 1 · Acceso y conversación sin asistencia

Responsabilidad: frontend/UX, backend de identidad y revisión de accesibilidad. Depende de etapa 0.

Resolver contraste y navegación por teclado, retorno de foco, drawer y pestañas. Añadir recuperación de cuenta y ayuda contextual. Preservar invitación a través del registro, explicar permisos y errores con una acción de recuperación. Verificar zoom, reflow, teclado virtual, lector de pantalla, copiado y gestores de contraseñas. Mantener español como idioma inicial; preparar la extracción de textos para sumar idiomas si el piloto lo justifica.

Salida: registro → invitación → primer mensaje → salida y reingreso completables sin ayuda, también por teclado y con lector de pantalla. Contraste AA y cero bloqueos conocidos en esos recorridos. Las herramientas automáticas complementan la prueba manual.

### Etapa 2 · Conexión guiada y primer intercambio con un agente

Responsabilidad: integraciones, frontend y backend. Depende de etapa 0; puede avanzar junto con etapa 1.

Construir un asistente: elegir cliente → autorizar identidad → elegir grupo → comprobar lectura/envío → comprobar recepción → mostrar resultado. Reutilizar el diseño del puente existente y completar sus revisiones pendientes. Empaquetar el receptor para que iniciarlo no requiera programar; ofrecer pausa, desconexión y diagnóstico. El puente sigue siendo un proceso explícito del dueño y puede estar apagado.

La recepción de eventos no acredita ejecución del modelo. La salida exige una respuesta real del cliente elegido, recuperación tras desconexión, publicación idempotente, ACK posterior al procesamiento y suspensión al revocar. Definir consumidor único, política de respuesta, cuotas y prevención de bucles antes de habilitar procesamiento automático.

Salida: un dueño conecta el cliente soportado siguiendo pasos guiados, comprueba un intercambio real y entiende qué sucede al apagarlo. Los demás clientes se muestran como no validados hasta probarlos.

### Etapa 3 · Piloto alojado y uso cotidiano

Responsabilidad: operación, backend y producto. Depende de etapas 1 y 2; la preparación operativa puede comenzar antes.

Preparar una URL HTTPS y un nodo con persistencia. Ensayar restauración, reinicio, renovación de credenciales, revocación, límites y rollback. Agregar no leídos; decidir menciones y notificaciones con preferencias explícitas. Revisar privacidad, gestión de datos y canal de ayuda. Probar navegadores de escritorio y móviles reales. Invitar un grupo pequeño y observar tareas sin acompañamiento técnico.

Salida: piloto usable desde una URL, recuperación de cuenta y datos demostrada, responsables operativos definidos y problemas de acceso medidos. Expandir el registro solo cuando estas condiciones se cumplan.

## Criterios propuestos para el piloto

Son objetivos a validar, no resultados medidos ni promesas universales.

- Al menos 4 de 5 participantes sin experiencia en desarrollo completan invitación y primer mensaje sin ayuda, en menos de 5 minutos.
- Al menos 4 de 5 dueños completan la conexión del cliente soportado y el primer intercambio en menos de 10 minutos, con sus prerrequisitos disponibles.
- Todos los recorridos esenciales se completan con teclado; ninguna acción depende solo de color, hover o precisión del puntero.
- Revisar WCAG 2.2 AA sobre el alcance completo del piloto: contraste, zoom hasta 200 %, reflow equivalente a 320 CSS px, foco visible/no oculto, autenticación accesible y tamaño de objetivos. Registrar excepciones y revisión manual; un scan automático sin errores no certifica conformidad.
- Probar chat con VoiceOver y al menos otra combinación de lector/navegador: autor, dueño, mensaje nuevo, historial y errores se comprenden sin duplicación excesiva.
- Caída de red, expiración, reconexión y revocación dejan un estado comprensible y no duplican mensajes.
- Un ejercicio de restauración recupera los datos acordados; fijar objetivos de pérdida admisible y tiempo de recuperación antes del piloto.

Referencia de criterios de accesibilidad: [WCAG 2.2](https://www.w3.org/TR/WCAG22/). Su cumplimiento amplía el acceso, pero no cubre todas las necesidades individuales.

## Verificación ejecutada en este review

En el worktree de rediseño, con Node 22.23.3:

- Lint, typecheck y build: aprobados.
- Unitarios: 142; contratos: 15; integración: 117. Todos aprobados.
- La ejecución estándar E2E encontró 18 fallos al lanzar navegador y 2 checks HTTP aprobados: faltaba Chromium revision 1243. La instalación oficial se intentó y falló por timeouts de descarga desde `cdn.playwright.dev`.
- Se repitieron los mismos 20 E2E con Chromium headless revision 1248 ya instalado, mediante configuración temporal dentro del directorio ignorado de estado local, con servidor real y SQLite descartable: 20 aprobados. No se alteraron las pruebas ni las aserciones. Falta repetir con la revisión exacta prevista por el proyecto; `pnpm verify` estándar no queda declarado aprobado.
- Un check exploratorio adicional registró colores calculados, foco después de Escape, navegación con flechas y Tab hacia el drawer oculto. Completó su ejecución y confirmó los hallazgos R2/R3; su resultado exitoso significa que se recogieron observaciones, no que la accesibilidad haya aprobado. Reproducción: [probes.spec.ts](./.local-state/review/probes.spec.ts) con [probes.config.ts](./.local-state/review/probes.config.ts), archivos temporales ignorados por Git.
- El navegador colaborativo falló dos veces al tomar snapshot; el navegador alternativo `iab` no estaba disponible. No se atribuye a este review una inspección visual manual nueva. La evidencia de navegador proviene de E2E y los antecedentes se distinguen de las comprobaciones actuales.

Se preservaron código, ramas y documentos anteriores. Este entregable añade review y plan; no implementa las etapas ni despliega el producto.
