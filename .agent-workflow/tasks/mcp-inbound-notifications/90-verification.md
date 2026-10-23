# Verificación de implementación: S0 parcial, activación bloqueada

Fecha: 2026-10-23. Rama feat/mcp-inbound-notifications.
Worktree: /Users/ramiro/Desktop/projects/agent_chat.feat-mcp-inbound-notifications.
Base 50d0fa61b8dadd468d9e4f4e480a45a2d3b34b63, desde feat/ui-redesign.
Outline r3 aprobado por «si», hash conservado en 06-implementation-receipt.md.

## Cambio realizado

Paquete apps/bridge con diagnóstico `pnpm bridge:doctor`, sin receptor/worker.
Extrae esquemas del binario y lee una allowlist de configuración efectiva mediante
initialize/config/read en directorio temporal sin credenciales ni entorno heredado
salvo PATH. Borra el directorio al terminar. No crea hilos, llama modelos, conecta
MCP/WS de Agent Chat, publica mensajes ni confirma inbox. Auto permanece desactivado.

La revisión Codex identificó un proceso que ignora SIGTERM en las dos fases
iniciales. Ambos execFile usan ahora SIGKILL al vencer los 10 s. Hay cobertura de
ambas fases, limpieza y finalización del proceso, además de timeout/errores del RPC.
No se imprimen stderr/configuración completa, capas de config ni valores sensibles.

## Checks finales

Comando: `PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm verify`.
Resultado posterior al fix de revisión: exit 0.
Log local: /tmp/agent-chat-inbound-s0-verify-post-review.log.

| Check | Resultado |
|---|---|
| lint | PASS |
| typecheck (incluye paquete bridge y tests) | PASS |
| build de todos los paquetes | PASS |
| unit | 142 PASS, 10 archivos |
| contracts | 15 PASS, 2 archivos |
| integration | 128 PASS, 14 archivos; incluye 11 tests de subprocess del probe |
| E2E Chromium | 20 PASS, 15.1 s |
| git diff --check | PASS |

Los tests nuevos verifican: solo RPC permitidos, aislamiento del entorno temporal,
allowlist de salida, no convertir configuración aceptada en readiness, JSON inválido,
error RPC, cierre prematuro, respuesta grande, petición entrante inesperada, esquema
inválido, config faltante, timeout, y bloqueo SIGTERM en version/generador.
Los tests no constituyen prueba de generación automática ni de aislamiento real.

## Entorno E2E y fallos resueltos

La primera corrida de pnpm verify no pudo abrir navegador: faltaba Chromium 1243
para Playwright 1.63.0 (18 fallos de lanzamiento; 2 checks API pasaron). Se instaló
con `pnpm exec playwright install chromium`; no se dejó ese bloqueo al usuario.

Mientras descargaba, se verificaron los 20 E2E también con Chrome instalado y un
servidor de prueba detrás de Portless en https://agent-chat-inbound-e2e.localhost.
El primer intento HTTPS de ese entorno falló en clientes Node por falta de CA;
se añadió NODE_EXTRA_CA_CERTS con el certificado público de Portless, sin desactivar
TLS. Un reintento con DB usada se detuvo y se lanzó una DB nueva de prueba. El
intento limpio pasó 20/20. Config temporal en .local-state (ignorada); no cambia la
config de proyecto. La corrida FINAL estándar usó Chromium descargado y la DB
única que prepara Playwright; no requirió el override de Chrome ni CA de Portless.
El puerto fijo de esa suite corresponde a su dependencia de test ya configurada;
los servidores iniciados manualmente usaron Portless.

Hubo un fallo inicial del nuevo test por alias macOS /var vs /private/var; se
normalizó realpath en el ejecutable falso. No cambió comportamiento del producto.

## Evidencia con runtime real, sin gasto

`node apps/bridge/dist/doctor.js`: exit 2, esperado para diagnóstico completo con
gate cerrado. Informe persistido en 07-codex-capability-report.json.
Codex 0.164.0: initialize/config/read OK; shell_tool=false, web_search=disabled y
apps desactivadas observadas. Cero turnos de modelo iniciados.

08-runtime-audit.md registra el código upstream fijado a commit de 0.164.0. El
presupuesto de rollout sí detecta agotamiento, pero el camino auditado contabiliza
uso al completar respuesta: no acredita el techo monetario preventivo exigido.
No se ejecutaron los tests Rust upstream ni se presentan como checks propios.

## Gate y trabajo pendiente

S0 NO PASA. Se implementó diagnóstico parcial y se recogió evidencia, no un worker
aprobado. No se demostraron catálogo completo sin herramientas en start/resume,
consumo único y cierre positivo de turnos, ni cota económica preventiva. Tampoco
hay política de modelo/monto aprobada para prueba real. No es una afirmación de
imposibilidad global del runtime: es insuficiencia de evidencia para el contrato r3.

S1–S5 no iniciados por el stop condition del outline aprobado. E2E de modelo real
no ejecutado por esos bloqueos y la falta de política económica; ningún worker
falso se contó como prueba de activación. Para retomar: demostrar mecanismos
soportados o revisar explícitamente las garantías del diseño, sin ampliarlas o
relajarlas implícitamente. Conservar identidad/hashes y usar Codex en revisiones.

## Limpieza y servidor del usuario

Servidor aislado Portless de pruebas detenido; no se cerraron servicios ajenos ni
el proxy compartido. Instalador de Playwright terminó. No quedan revisores activos
abiertos por esta tarea; sus referencias están en los receipts.
La ruta original agent-chat.localhost ya no aparecía al cierre; se levantó de nuevo
con Portless desde feat/ui-redesign, su dist previo y la DB local original indicada
en el contexto. Se conserva ese servidor para el usuario. No hay migraciones nuevas.
Worktree de implementación conservado. Sin merge a main, push ni PR.
