# Recepción de mensajes y activación de agentes mediante MCP

Fecha: 2026-10-23. Revisión: r3. Estado: diseño r3 aprobado; outline r3 aprobado; S0 produjo diagnóstico parcial y bloquea activación.

## Pedido y alcance autorizado

Investigar y diseñar un mecanismo estilo webhook para que los agentes conectados
reciban mensajes y puedan procesarlos sin una orden manual en este chat.
Se autorizan lectura del repo y fuentes primarias, y escritura de documentación.
No se autorizó implementar, iniciar procesamiento autónomo ni publicar más mensajes
como parte de este research. No hay cambios de código, dependencias o configuración.

Repo: `/Users/ramiro/Desktop/projects/agent_chat`.
Worktree de documentación: `/Users/ramiro/Desktop/projects/agent_chat.feat-ui-redesign`.
Rama existente: `feat/ui-redesign`; base: `50d0fa6`. Sin push ni PR.

## Resultado esperado del diseño

Separar transporte, recuperación de eventos, activación del runtime y confirmación.
Comparar webhook HTTP, WebSocket existente y notificaciones estándar de MCP.
Precisar qué puede hacer Codex con la versión instalada y qué falta demostrar.
Definir duplicados, caídas, autorización, concurrencia, publicación y observabilidad.
Proponer una prueba funcional que incluya la activación real del modelo.

## Fuera de alcance

Autocompletado o parsing de menciones, ejecución de agentes dentro de Agent Chat,
servicio hospedado que despierte máquinas apagadas, acceso a secretos de Codex,
sustituir el OAuth existente, modificar el inbox o disparar turnos durante el research.

## Estado de decisiones

El 2026-10-23 el usuario eligió «Hilo dedicado por grupo (recomendado)».
Se registra un hilo dedicado por `(agent_id, group_id)`, propiedad del runtime
externo, con un solo escritor. Esta elección resuelve la propiedad del contexto;
el diseño completo fue aprobado con «bien aprubeo»; la activación del runtime
sigue pendiente de los gates posteriores.

El mismo día eligió respuesta automática en los grupos habilitados, con opción de
no responder. No se requiere aprobación por mensaje para publicar en esos grupos.
Los filtros de origen, límites y permisos del worker continúan propuestos.

La ruta de trabajo es humanlayer-rpi-workflow. La etapa actual termina en diseño.
Se preparó el outline r1 tras la aprobación del diseño. La revisión independiente
con Pi en T3 falló por monthly_cap_reached (HTTP 402), antes de producir resultados.
HERDR_ENV no está presente; no se controló Herdr. Véase 05-independent-review.md.
No se inició implementación; la aprobación del outline sigue pendiente de revisión.

Gate ID: inbound-design-r3
Decision / allowed mutation: preparar outline y revisión independiente
Explicit exclusions: código, infraestructura, turnos autónomos, nuevas credenciales
Owning artifact / revision or hash: 03-design-discussion.md / r3
Decision owner: Ramiro
Approved by / trusted identity: Ramiro, mensaje «bien aprubeo»
Approved at: 2026-10-23
Status: approved
Invalidated by: cambio de alcance, transporte, propiedad de sesión o autonomía

Actualización: el usuario ordenó «hacelo todo con codex». Codex revisó r1 y
encontró cuatro hallazgos controlantes y dos mayores. Se incorporaron contratos
de cierre en outline r2 y se envió a otra revisión independiente Codex high.
El fallo de Pi es histórico y no bloquea el uso del revisor sustituto autorizado.

Ronda 2: cerró F1/F3/F4/F5/F6 documentalmente, dejó F2 parcial y añadió
F7–F10. El outline r3 incorpora cierre positivo de turnos, presupuesto ejecutable,
recuperación limitada y retención por almacén/estado; enviado a ronda 3 Codex high.

Ronda 3 completada: outline r3 listo para aprobación humana, sin hallazgos
critical/controlling/major abiertos. M1 minor aclarado en 05-independent-review.md
sin cambiar el hash revisado. No se inició implementación ni prueba real de modelo.

Implementación autorizada por «si»: identidad en 06-implementation-receipt.md.
S0 investigado y diagnóstico implementado/testeado; gate NO PASA, según auditoría
08-runtime-audit.md. S1–S5 detenidos por condiciones técnicas del plan aprobado.
Verificación final y limpieza en 90-verification.md. Sin activación automática.
