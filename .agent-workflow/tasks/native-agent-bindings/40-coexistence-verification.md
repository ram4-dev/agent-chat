# Coexistencia con turno automático activo

## Pendiente elegido

El outline S6 exige escritura interactiva mientras existe un job automático, sin modificar ese job ni duplicar autoría auditada. Las pruebas previas verificaban inbox pendiente y escritura explícita, pero no esa coexistencia con un turno iniciado. Este escenario es independiente del profile de Codex y de capacidades/credenciales reales de Grok.

Nueva rama feat/native-coexistence desde d51cf92, worktree registrado en39. Fixtures propios; conexiones y cuentas sintéticas. OAuth personal, ~/.hermes, servicios reales y datos del usuario no se modifican.

## Defecto reproducido y corrección

La clave automática era native:<eventId>, dentro del mismo espacio de idempotencia que send_message. Una publicación interactiva podía usar esa clave antes de finish. La reproducción produjo DomainError: Idempotency key reused with a different payload al intentar terminar y publicar el resultado automático; se revirtió el experimento y se conservó una regresión con el comportamiento correcto.

Un helper central mantiene la generación de claves automáticas existentes y rechaza ese prefijo en escrituras públicas de agentes. Se aplica después de autenticar/autorizar en el módulo interactivo y en el handler MCP legacy. No se cambian claves persistidas, migraciones, scopes, permisos, estados, modelos ni reintentos del receptor. La nueva restricción se documenta; no repara colisiones históricas ni borra datos.

## Pruebas

Integración mantiene un claim iniciado con run_ref aceptado y usa otra conexión para publicar. Verifica rechazo de la clave reservada con contenido igual o distinto, replay idempotente, rechazo de contenido contradictorio, snapshot de entrega intacto, inbox sin ACK y una sola auditoría con autor/grant/conexión correctos. Revoca únicamente el grant interactivo, exige rechazo posterior y termina el turno automático con su prueba firmada original. El recibo automático es distinto del mensaje interactivo y se repite sin duplicación.

E2E amplía el supervisor real y webhook falso existentes. Mantiene una entrega running antes de liberar el proveedor simulado. Una conexión separada prueba el prefijo reservado en la superficie legacy, se asocia explícitamente como interactiva y vuelve a probar la restricción nativa con invalid_input exacto. Envío, replay, conflicto, identidad no concedida y revocación no cambian claim/start_key/fence ni ACK. El mensaje aparece en el navegador y la auditoría corresponde al actor interactivo. Después se completa la entrega automática original una sola vez y continúa la prueba de recuperación/pausa/silencio.

Captura: .local-state/native-coexistence-active.png. No contiene tokens ni códigos de asociación. E2E específico PASS14.5s. Suite completa: lint/typecheck/build/diff-check PASS;165 unitarios+15 contratos+210 integración+27 E2E=417 PASS,6 skips explícitos. E2E completo1.3min con Node22.23.3, Portless agent-chat-coexistence y DB nueva coexistence-final.db. Los skips corresponden a5 Hermes instalado y1 modelo real, excluidos para respetar las restricciones. La última ampliación de aserciones pasó también el test de integración enfocado. Se agregó recarga explícita del navegador tras configurar el binding desde el fixture para actualizar sus metadatos; su comprobación enfocada final pasó en14.3s. Captura inspeccionada. Revisión independiente pendiente.

## Pendientes externos

- Codex automático: vía soportada para seleccionar el profile exacto conservando aprobaciones, recuperación y herramientas; App Server0.164 rechaza --profile. Una aceptación personal requerirá elegir profile/workspace. No se actualiza la instalación global ni se degrada el contrato.
- Hermes personal: elegir profile y autorizar expresamente su acceso/instalación del plugin y activación. La prohibición vigente sobre ~/.hermes impide esa aceptación; fixtures previos no la sustituyen.
- Grok real: evidencia terminal durable/quiescente, asociación bot/rutina y callback verificables; después, conexión automática separada y despliegue expresamente autorizados. No basta con credenciales o con HTTP200.
- Disponibilidad24/7: Rama debe elegir host persistente y autorizar el despliegue/red. Una Mac dormida no acredita disponibilidad continua.

Estos bloqueos no requieren pedir decisiones para los tests locales. No hay push a main, PR ni mensajes reales.
