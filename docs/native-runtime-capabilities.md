# Pruebas de capacidades nativas

Este harness pertenece a S0 del plan de vinculación. No instala un receptor nativo ni cambia las automatizaciones existentes.

## Codex

Con Codex instalado y disponible en PATH:

```sh
pnpm install --frozen-lockfile
pnpm bridge:capabilities
```

El comando crea un HOME/CODEX_HOME temporal, un profile y un workspace de prueba. Conserva la metadata pública del modelo del catálogo instalado y usa un proveedor HTTP falso local. Comprueba selección del profile, instrucciones, reglas de workspace, herramientas anunciadas y continuidad al retomar. No ejecuta inferencia ni permite que el proveedor falso solicite herramientas.

La salida mantiene `automaticActivationAllowed: false`. Un resultado satisfactorio no acredita acceso a un profile personal ni actividad visible en T3. Las capacidades de Hermes y Grok Bot no verificadas no se convierten en PASS.

## Hermes instalado con proveedor falso

Requiere una instalación local de Hermes compatible con `--print-runtime-command`, Python y dependencias que su bootstrap prepare, y Portless disponible en PATH. El proceso Node de las pruebas debe ofrecer `tls.getCACertificates` y `tls.setDefaultCACertificates`: se incorpora temporalmente la CA pública de Portless y se restaura al cerrar. La validación TLS permanece habilitada. Se usa el Python de esa instalación, sin asumir una ruta de virtualenv. El fixture soporta macOS/Linux. No modifica el core ni lee la configuración personal de Hermes.

Primero compilar y levantar un servidor de Agent Chat de prueba, con una base aislada:

```sh
pnpm build
DATABASE_PATH=.local-state/native-probe.db LOG_LEVEL=warn \
  portless agent-chat-native-probe node apps/server/dist/main.js
```

En otra terminal, usar la URL que devuelve Portless y la ruta al checkout instalado de Hermes:

```sh
AGENT_CHAT_E2E_BASE_URL=http://agent-chat-native-probe.localhost:1356 \
AGENT_CHAT_HERMES_SOURCE=/ruta/al/checkout/hermes \
  pnpm exec playwright test tests/e2e/native-capabilities.spec.ts
```

El puerto del proxy del ejemplo puede variar; copiar la URL anunciada por Portless. El test lanza otro endpoint nombrado para Hermes, con perfil y credenciales temporales generadas para ese fixture. El proveedor falso responde por HTTP en un hilo separado: el constructor nativo puede consultar metadata de forma síncrona y bloquearía un proveedor alojado en su mismo event loop.

El E2E comprueba persona y tools anunciadas, idempotencia, conflicto por contenido diferente, resultado terminal y `no_reply` explícito, contexto compartido entre participantes, separación entre grupos y recuperación de resultado/historial al reiniciar el proceso. No reemplaza AIAgent ni modifica sus métodos con mocks.

Sin `AGENT_CHAT_HERMES_SOURCE`, esa aceptación instalada queda marcada como omitida, con motivo explícito. Las pruebas HTTP deterministas siguen disponibles con `pnpm test:integration`. La primera preparación de dependencias puede requerir red; si falla, el adaptador no se declara habilitado.

Quedan fuera del resultado de este harness: aprobación nativa de herramientas con una política real, permisos sobre un workspace personal, inspección desde la UI nativa, selección definitiva del adaptador Hermes y retorno desde la nube de Grok Bot. Esas capacidades deben verificarse antes de habilitar sus bindings.
