# Revisión independiente del outline

## Ronda 1, completada

- Revisor: Codex, `gpt-6.1-sol`, razonamiento `high`, service tier `default`.
- Outline r1 SHA-256: `b0c63ed1be578382274a37e785cc8a8c1e0e8292d59c47353fa33158cc43b4b4`.
- Diseño aprobado SHA-256: `07bdc25dde6134073442de0e8c324c3824a0ef9ed3ea6d50f63f5aeb4bdc9d31`.
- Modalidad: tarea hija T3, checkout compartido, solo lectura del paquete y código pertinente. Sin cambios de servicios, secretos, modelos de prueba, bots, mensajes ni delegación adicional.
- Instrucción vigente: usar Codex reemplaza la mención de Pi del workflow.
- Alcance: ejecutabilidad del outline, identidad, permisos, callbacks, recuperación, concurrencia, retención, migración y evidencia real frente a simulada.
- Tarea T3: `node:delegated-task:command%3Amcp%3A1bd8506e-58f0-4b1b-8ef4-39ee3ce5c936%3Adelegate-task%3Anative-bindings-outline-r1-codex-review-20261023`.
- Recepción confirmada por T3: proveedor `codex`, modelo y opciones coinciden. Resultado recibido: completado, requiere cambios.
- Veredicto: tres major, sin critical ni controlling; el contrato general coincide con el diseño. Revisión solo lectura, sin inferencia, servicios ni suites. Hashes de outline y diseño verificados al inicio y cierre sin cambios. Base `488db6956af6e72f0b3b1522ae086918847ab152`.

| ID | Severidad | Evidencia de r1 | Impacto y corrección requerida | Disposición del autor en r2 |
| --- | --- | --- | --- | --- |
| NB-F1 | major | Outline S2 enumera MCP/HTTP; `apps/server/src/adapters/agent-ws/index.ts:46` reutiliza autenticación MCP y filtra por membresía | Un grant limitado a A puede exceder consentimiento por WebSocket si la identidad pertenece también a B. Rechazar nuevos grants o aplicar restricciones y revocación antes de entregar | S2 rechaza explícitamente nuevos grants en WS, invalida sockets al cambiar clase y prueba reducción de grupos, revocación y compatibilidad legacy |
| NB-F2 | major | `gateway/platforms/base.py:4035` despacha en background; `run_turn_runner.py:1534` puede enviar aprobación; `run_turn.py:1923` puede terminar en silencio; hook `base.py:4641` separado | Un send puede confirmar prematuramente o no llegar en `no_reply`. Exigir terminal correlacionado y durable, varios envíos/aprobación/silencio y crash antes de guardar resultado | S0 incorpora criterio bloqueante y casos; S4 implementa estrategia terminal y conserva incertidumbre si no recupera evidencia |
| NB-F3 | major | Hermes `gateway/session.py:685,713`, `group_sessions_per_user=True` | Dos participantes en un grupo pueden obtener sesiones distintas. Exigir mapping por binding+grupo sin perder remitente ni cambiar otros canales | S0 exige estrategia soportada, prueba de A+B en misma sesión y otro grupo separado antes/después de reinicio; S4 la implementa |

La revisión reconoció correctamente pendiente el callback real de Grok Bot; no consideró el webhook falso evidencia de habilitación. No otorgó aprobación humana. El cierre de los findings se verificó independientemente en la ronda 2 registrada a continuación.

## Ronda 2

- Outline r2 SHA-256: `cc58e304142ea8a1f0c019da642916d264f771ff081aa99a8e92c1b1e95d8e99`.
- Diseño aprobado: sin cambios respecto del hash original.
- Alcance: verificar NB-F1–NB-F3 y ausencia de regresiones en el contrato completo, con mismas exclusiones de solo lectura.
- Revisor solicitado: Codex `gpt-6.1-sol`, reasoning `high`, service tier `default`.
- Tarea T3: `node:delegated-task:command%3Amcp%3A1bd8506e-58f0-4b1b-8ef4-39ee3ce5c936%3Adelegate-task%3Anative-bindings-outline-r2-codex-review-20261023`.
- Recepción confirmada: proveedor `codex`, modelo `gpt-6.1-sol`, reasoning `high`, service tier `default`; coinciden con lo solicitado.
- Estado: completada. Veredicto: sin hallazgos nuevos; NB-F1–NB-F3 cerrados en el outline. Coherente con diseño y ejecutable mediante gates de capacidad. No acredita implementación ni concede aprobación humana.
- Hashes del outline r2 y del diseño verificados al inicio y cierre, sin cambios; base `488db6956af6e72f0b3b1522ae086918847ab152`.

Disposición independiente:

- NB-F1 cerrado: S2 rechaza ambas clases nuevas en WebSocket antes de entregar contenido; cubre A+B, reducción de grupos, revocación y cambio de clase con socket abierto, manteniendo legacy.
- NB-F2 cerrado como requisito bloqueante: terminal durable separado de `send`, `no_reply` explícito y casos de aprobación, múltiples envíos y crash. Advertencia conservada: el hook Hermes instalado solo devuelve SUCCESS/FAILURE/CANCELLED; ese outcome no prueba por sí solo silencio intencional o salida recuperable. S0 debe demostrarlo antes de S4.
- NB-F3 cerrado como gate de capacidad: estrategia soportada por binding+grupo, remitente real, sin cambiar defaults globales, con participantes A+B y otro grupo antes/después de reinicio. El mecanismo concreto queda pendiente de S0.

No se detectaron regresiones materiales en pairing, autoridades, cupo por target, inicios ambiguos, recibos, retención terminal o migración con quiescencia. Grok Bot continúa bloqueado para habilitación hasta probar callback y red reales.

Revisión solo lectura de 00–06 y90, código del repo y Hermes local `d923a5eb487a17c0a68801bba9ef0f56c81040a8`; sin ediciones, delegación, suites, servicios, inferencia, bots, OAuth, mensajes ni secretos/configuración personal. Comprobación de whitespace sin errores, incluidos documentos nuevos. Los cambios concurrentes de 05 y90 se releyeron y resultaron compatibles con el dictamen.

Outline exacto listo para aprobación humana: r2 con el hash registrado. Critical/controlling/major abiertos: ninguno. Nueva revisión no requerida mientras no cambie este outline.
