# S0: auditoría del presupuesto de Codex 0.164.0

Fecha: 2026-10-23. Sin inferencia, credenciales, hilos ni turnos de prueba.

## Identidad de la evidencia

Binario observado: codex-cli 0.164.0. Esquemas generados localmente con
`codex app-server generate-json-schema --experimental` y campos en
07-codex-capability-report.json. No se leyó configuración privada del usuario.

Fuente upstream clonada de solo lectura fuera del proyecto:
https://github.com/openai/codex/tree/rust-v0.164.0
Tag anotado: fe3b29455488c2e189e43ad5526a107900c5e1b7.
Commit resuelto: 6aaac694803004a63c6f393d153c96d22521a6b9.
Copia temporal: /tmp/agent-chat-codex-src-0164.
La coincidencia de versión no prueba que el binario sea bit a bit ese build.

## Resultado del presupuesto experimental

- `core/src/rollout_budget.rs:39-66`: configura estado en memoria y acumula unidades
  del backend o una ponderación de output_tokens y non_cached_input; compara con
  limit_tokens después de sumar uso. No representa por sí solo dinero reservado.
- `core/src/agent/control/budget.rs:12-16`: esa comparación produce
  SessionBudgetExceeded. El presupuesto tiene efecto, no es solo un recordatorio.
- `core/src/session/turn.rs:3177-3221`: se registra el uso y evalúa el error al
  procesar ResponseEvent::Completed. El control observado es posterior al consumo
  de esa respuesta; no demuestra una cota preventiva de todo gasto facturable.
- `core/tests/suite/rollout_budget.rs:280-332`: test upstream con respuestas falsas
  comprueba error en turno actual y posterior al agotar; no ejecutamos ese test
  Rust ni lo contamos como validación del proyecto.
- `core/src/config/mod.rs:2977-3039`: exige limit_tokens y
  reminder_at_remaining_tokens. La documentación oficial consultada describe
  reminder_interval_tokens, por lo que no se debe copiar ese ejemplo al binario
  sin validar su versión. La revisión independiente comprobó aceptación del flag
  con la configuración local correcta; no lo habilitamos en el perfil del usuario.

Fuentes fijadas a commit:
[Contabilidad](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/rollout_budget.rs),
[corte](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/agent/control/budget.rs),
[momento del cómputo](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/session/turn.rs).
[Referencia oficial consultada](https://learn.chatgpt.com/docs/config-file/config-reference).

## Veredicto S0

NO PASA el gate de activación. Hay configuración aceptada y transporte local
probado, pero no evidencia suficiente de catálogo completo sin herramientas en
start/resume, consumo único/cierre positivo ni cota económica conservadora previa
a generación. El presupuesto experimental auditado no resuelve por sí solo F8.
No se concluye que toda forma de aislamiento o presupuesto sea imposible: este
adaptador y estas comprobaciones todavía no acreditan las condiciones aprobadas.
Tampoco existe política de modelo/monto aprobada para probar generación real.

S1–S5 se detienen según el outline aprobado; no inventar soporte, iniciar turnos
para ver qué ocurre, relajar los límites o cambiar proveedor. Para continuar se
necesita demostrar esas capacidades mediante un mecanismo soportado, o volver al
diseño con una garantía distinta explícitamente aprobada. El diagnóstico puede
seguirse ejecutando sin tocar grupos, credenciales ni mensajes.
