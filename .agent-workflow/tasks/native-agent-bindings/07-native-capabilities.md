# S0: capacidades demostradas y pendientes

Fecha: 2026-10-23. Rama `feat/native-agent-bindings`, base `ead3e24`.
Estado: spike parcial verificado; ningún adaptador nativo habilitado para grupos reales.

## Codex instalado

`codex-cli 0.164.0`, proveedor Responses falso por HTTP local y HOME/CODEX_HOME temporales. Se copia la metadata pública del modelo elegido del catálogo instalado sin recortar sus tools. El profile sintético usa otro modelo que la configuración base; su selección se comprueba en el request efectivo. El modelo del fixture no impone modelo alguno al futuro adaptador.

Demostrado desde el entrypoint compilado: profile seleccionado, instrucciones configuradas, reglas del workspace, herramientas anunciadas y mismo hilo al retomar. Dos requests al fake, sin inferencia ni tool calls. La versión instalada puede anunciar tools mediante `additional_tools` en input; leer solamente `body.tools` produciría un falso diagnóstico de tools ausentes.

Pendiente: aprobación de herramientas, adopción de un profile real seleccionado por el dueño y observación desde su superficie nativa. La prueba no acredita conexión de este hilo de T3.

## Hermes instalado

Hermes `0.22.2`, fuente local `d923a5eb487a`, Python resuelto mediante `hermes --print-runtime-command`. Se ejecuta APIServerAdapter y AIAgent originales contra un proveedor HTTP falso, sin reemplazar clases/métodos del agente. Configuración y estado en profile temporal. El bootstrap prepara dependencias para ese root; puede requerir red.

Demostrado por E2E desde el proceso real de la API:

- La persona del profile aparece en la solicitud efectiva y conserva los cuatro tools de archivos configurados.
- Aceptar el inicio entrega un `run_id`; la respuesta se obtiene del estado terminal, no de progreso o de un envío.
- La misma clave/cuerpo devuelve el mismo run; cuerpo distinto devuelve conflicto.
- Dos participantes que usan el mismo `session_id` conservan el transcript; otro grupo no recibe su historial.
- El resultado final puede representar `no_reply` explícito; el silencio del transporte no se interpreta como esa decisión.
- Tras reiniciar el proceso con el mismo profile, se recupera el resultado original, se reproduce su recibo idempotente y se continúa el historial sin regenerar el primer turno.

El candidate API de runs satisface estos checks con menos integración que un canal nuevo. La elección definitiva sigue condicionada a demostrar aprobaciones nativas y paridad para el profile que se vaya a conectar. El estado `waiting_for_approval` está tipado y cubierto por un test HTTP determinista, pero no se ejercitó una aprobación real de una herramienta nativa: ese check permanece pendiente. Tampoco se probó aún selección entre dos profiles reales o inspección desde UI Hermes. No se presenta S0 completo ni se habilita S4 automáticamente.

## Grok Bot

No se inició ninguna rutina ni se conectó un bot. Sigue pendiente la respuesta a la pregunta del nombre del bot y confirmación de que pertenece a la aplicación Grok Bot instalada. La ruta HTTPS alcanzable desde su nube y el callback de resultado requieren su aceptación real. Los documentos oficiales y un futuro fake no sustituyen esa prueba.

## Correcciones del harness durante S0

- Cerrar stdin del subprocess Codex para que un exec no espere entrada adicional.
- Cargar metadata completa del modelo para comprobar el profile sin eliminar herramientas.
- Reconocer ambos transportes del catálogo de herramientas Responses.
- Servir metadata y completions falsos fuera del event loop de Hermes, evitando bloquear consultas síncronas de su constructor. El fake anuncia un contexto de 131072 tokens compatible con el mínimo nativo.
- Usar rol `tab` para la pestaña Ingresar del navegador.
- Conservar el HOME de Portless para encontrar su proxy existente; el fixture cambia HOME/HERMES_HOME antes de cargar Hermes. Obtener URL y CA de PORTLESS_URL/NODE_EXTRA_CA_CERTS anunciados por el proceso, evitando inferencias de hostname por worktree.
- Cuando hay HTTPS, confiar temporalmente en la CA pública de ese proceso en el worker de tests y restaurarla al cerrar. No se deshabilita validación TLS ni se modifica el trust store del sistema.
- Shutdown del grupo de procesos del fixture con espera de cierre de sus pipes y escalado acotado; solicitudes ambiguas no se reintentan.

Estos fueron problemas de preparación/observación del fixture; no se atribuyen como fallos del producto Hermes ni como bugs del servidor de Agent Chat.

## Verificación

Lint, typecheck y build: PASS. Unit: 148 PASS. Contratos: 15 PASS. Integración: 147 PASS. E2E completo: 23 PASS, 1 skip, ejecutado con AGENT_CHAT_HERMES_SOURCE y el servidor aislado vía Portless. El skip es el test legacy con modelo Codex real, que exige AGENT_CHAT_REAL_CODEX_E2E=1; no se solicitó inferencia en esta fase de fixtures.

El E2E instalado Hermes pasó en 18.2 s en la ejecución enfocada y 16.9 s dentro de la suite completa. No se ejecutaron pruebas de modelos reales. El receptor y la base de producción no fueron modificados. La siguiente tarea técnica es cerrar los checks de autorización/aprobaciones y selección de profile de S0; los módulos comunes pueden prepararse sin declarar habilitado un proveedor pendiente, conforme al outline.
