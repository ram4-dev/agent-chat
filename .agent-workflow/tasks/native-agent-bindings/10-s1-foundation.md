# S1: fundamento persistente de runtimes nativos

Fecha: 2026-10-23. Rama `feat/native-agent-bindings`. Base del incremento: `ac410b4`.

## Resultado

La migración 0008 agrega targets, bindings, revisiones inmutables, grupos, conversaciones y deliveries. Las identidades de chat siguen en `agents`; un target tiene proveedor, conector y referencia nativa separados de su conversación. Los contratos compartidos tipan los descriptores; las capacidades no verificadas siguen en `unknown`.

El repositorio interno registra targets, busca por dueño, crea bindings deshabilitados y cambia de versión mediante compare-and-swap dentro de una transacción inmediata. No es una superficie de autorización pública: S2 debe validar consentimiento, estado de agente/grant, membresía y operaciones permitidas antes de llamarlo. Todavía no está conectado a HTTP/MCP ni inicia consumidores.

## Invariantes comprobadas

- Target y binding no pueden cruzar dueños ni cambiar de identidad en el lugar. La referencia de profile/bot es inmutable; un cambio requiere otro target/revisión.
- Las revisiones y audiencias de grupos se conservan; cambiar remitentes requiere una revisión nueva. `enabled` es estado operativo de pausa y puede cambiar sin editar audiencia.
- Un target con contexto compartido no puede tomar otro grupo, ni por otra identidad/binding, una revisión nueva o una pausa del grupo anterior. La restricción también se impone en SQLite. Un target `unsupported` no admite grupos.
- Cambiar un target con historial de varios grupos a contexto compartido falla. Las referencias históricas se conservan para no fingir que el contexto nativo desapareció al pausar.
- El cambio de revisión falla ante trabajo incierto o una revisión esperada obsoleta y no deja filas parciales. Un cambio de configuración dentro del mismo target/grupo conserva la última referencia de conversación; otro target no recibe esa referencia automáticamente.
- Los deliveries se relacionan con evento, agente, grupo y versión/target mediante claves compuestas. Hay un slot activo por target entre varios bindings. Esto no implementa todavía los protocolos de claim/fencing/publicación de S3.
- Las capacidades solo devuelven las cinco claves tipadas. Valores malformados son rechazados y campos arbitrarios no aparecen en el descriptor.

## Compatibilidad legacy

Se crea una proyección pasiva y deshabilitada de los targets/bindings/conversaciones que ya existían al migrar. `legacy_projection` distingue esa metadata de un consumidor nuevo; no refleja el estado operativo vivo del receptor anterior. Su estado real sigue en `agent_automation_*`. No se copian jobs activos a un ledger que quedaría desactualizado mientras el receptor viejo sigue operando.

Los jobs, claims, resultados, mensajes y ACKs anteriores no se modifican. El repositorio normal no permite reemplazar una proyección legacy; S7 debe realizar el relevo explícito con pausa y quiescencia demostrada. No se habilitan scopes nuevos, grants, rutinas ni receptores con esta migración.

## Verificación

Seis tests de integración nuevos cubren ownership, contexto compartido entre bindings/versiones, capacidades malformadas, versiones/CAS y rollback, slot global/identidad de inbox y migración legacy con un job pendiente. La lista de tablas esperadas del test de schema se amplió con las seis tablas nuevas, conservando su aserción exacta.

Checks: lint, typecheck y build PASS; 148 unit, 15 contratos, 156 integración y 24 E2E PASS (343). Un E2E legacy de inferencia real omitido por opt-in `AGENT_CHAT_REAL_CODEX`. El E2E completo pasó en 32.0 s sobre una base nueva con 0008 aplicada y servidor Portless `http://agent-chat-native-bindings-s1.localhost:1356`; incluye UI/MCP/receiver legacy y los tres checks nativos del harness.

S0-F7/F8 tienen regresiones enfocadas y cierre del autor; quedan para verificación independiente. S0 continúa parcial respecto de aprobaciones nativas, dos profiles, visor y retorno/red del bot Grok. Esas capacidades no se convierten en PASS por completar S1.

Próxima acción autorizada: revisión del incremento y continuar S2, con autoridad interactiva/automática explícita y denegación de nuevos grants en WebSocket. Sin push, PR ni cambios al receptor real.

## Corrección S1-F1

La continuidad se recupera de todas las revisiones compatibles del mismo binding, target y grupo, incluso si el grupo estuvo ausente en revisiones intermedias. Conflictos de referencia o regresión de generación rechazan el cambio y revierten la transacción. Cuatro regresiones adicionales cubren reincorporación, separación entre targets, ambigüedad y nueva generación.
