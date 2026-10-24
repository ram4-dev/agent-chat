# Validaciones externas y decisiones pendientes

Los seis skips actuales requieren Hermes instalado o inferencia real. No se quitan ni se sustituyen por tests falsos. Las pruebas locales del receptor y del adaptador comprueban cómo Agent Chat trata aprobación, cancelación y resultados incompletos; no prueban el comportamiento interno del proveedor.

## Inventario de los seis E2E omitidos

| Archivo | Caso | Dependencia que falta |
| --- | --- | --- |
| [native-capabilities.spec.ts](../tests/e2e/native-capabilities.spec.ts) | Resultado terminal durable, herramientas y sesiones Hermes | Fuente Hermes compatible, CLI, Python/uv y dependencias del fixture |
| [hermes-gates.spec.ts](../tests/e2e/hermes-gates.spec.ts) | Aprobación nativa antes de ejecutar una herramienta | Hermes real en profile temporal; un doble HTTP no demuestra que el ejecutor respete la aprobación |
| [hermes-gates.spec.ts](../tests/e2e/hermes-gates.spec.ts) | Handler cancelado mientras sigue activo el ejecutor | Hermes real y observación de su worker; una respuesta cancelled simulada no demuestra quiescencia |
| [hermes-gates.spec.ts](../tests/e2e/hermes-gates.spec.ts) | Personas e historiales de dos profiles | Dos profiles Hermes temporales y su mecanismo de configuración/sesión real |
| [hermes-delivery.spec.ts](../tests/e2e/hermes-delivery.spec.ts) | Navegador, supervisor, aprobación, continuidad y recuperación Hermes | Hermes compatible más plugin local y fixture completo con proveedor de inferencia falso |
| [automation.spec.ts](../tests/e2e/automation.spec.ts) | Respuesta Codex real, contexto y reinicio supervisado | Opt-in de inferencia real y runtime de prueba autenticado |

Los cinco casos Hermes usan proveedor de inferencia falso, pero ejecutan código Hermes real. Requieren `AGENT_CHAT_HERMES_SOURCE`; no se ejecutan bajo la restricción vigente de no acceder a `~/.hermes`. Un checkout alternativo y su entorno también son dependencias que deben prepararse y verificarse, no una forma de declarar esas pruebas aprobadas sin ejecutarlas.

El caso Codex requiere `AGENT_CHAT_REAL_CODEX=1`. Comprueba el receptor legacy; no acredita profiles nativos ni resuelve el bloqueo de S6.

## Cobertura local que sí se puede ejecutar

```sh
pnpm exec vitest run --project unit tests/unit/native-receiver.test.ts
pnpm exec vitest run --project integration tests/integration/hermes-runtime.test.ts
```

El receptor conserva bloqueos de aprobación, inicio incierto y cancelación sin generar ni publicar otra respuesta. Una finalización recibida tras pedir cancelación se reconcilia, sin publicar su salida. El adaptador Hermes consulta un servidor HTTP sintético desde un journal vacío: no firma ni recupera resultados cancelados, fallidos, interrumpidos o completados con decisión/cuerpo inválidos; tampoco crea un run al consultar. Estos tests no importan Hermes ni utilizan su instalación.

La suite general conserva los skips con su motivo:

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contracts
pnpm build
pnpm test:integration
env -u AGENT_CHAT_HERMES_SOURCE -u AGENT_CHAT_REAL_CODEX pnpm test:e2e
```

Para usar un servidor de pruebas externo, asignar `AGENT_CHAT_E2E_BASE_URL` a su URL Portless y una DB nueva. No reutilizar una base personal o la de otra ejecución. Los requisitos de los fixtures instalados se detallan en [capacidades nativas](native-runtime-capabilities.md).

## Qué necesita decidir o facilitar Rama

| Pendiente | Decisión o acceso necesario | Criterio para cerrarlo |
| --- | --- | --- |
| Codex nativo automático | Elegir una vía de runtime que admita el profile exacto conservando políticas; después, seleccionar profile/workspace de aceptación | Demostrar selección, aprobaciones, resultados durables y recuperación. El diagnóstico actual permanece bloqueado; no se cambia la instalación global |
| Aceptación Hermes | Elegir profile y autorizar acceso a su runtime, plugin y activación. Para los cinco E2E instalados, facilitar fuente y CLI compatibles fuera de la ruta prohibida o cambiar expresamente esa restricción | Ejecutar los fixtures reales y la aceptación del profile elegido; los dobles locales no los reemplazan |
| Prueba Codex con inferencia real | Autorizar el opt-in de inferencia y un runtime autenticado de prueba, sin modificar OAuth existente | Ejecutar el caso real y registrar evidencia; no equivale a aceptación de Codex nativo |
| Grok real | Facilitar evidencia terminal durable y quiescente, asociación verificable bot/rutina y callback público; autorizar después una conexión automática separada | Ida y vuelta real con ejecución visible y recibo, sin tomar HTTP200 como prueba terminal |
| Operación24/7 | Elegir host persistente y autorizar despliegue/red | Verificar disponibilidad y recuperación en ese host; una Mac dormida no demuestra servicio continuo |

Este documento registra pendientes, no pide tokens ni activa conexiones. No hay pasos pendientes de pruebas locales que obliguen a acceder a perfiles personales. La activación real sigue separada de los resultados de fixtures.
