# Revisión del primer incremento S0

- Snapshot de código: `8d1f32547a26cab61e0b6e4d4c9c38e25c62c6f9`.
- Rama/worktree: `feat/native-agent-bindings`, `/Users/ramiro/Desktop/projects/agent_chat.feat-native-agent-bindings`.
- Revisor: Codex `gpt-6.1-sol`, reasoning `high`, service tier `default`; recepción de proveedor/modelo/opciones confirmada por T3.
- Tarea: `node:delegated-task:command%3Amcp%3A1bd8506e-58f0-4b1b-8ef4-39ee3ce5c936%3Adelegate-task%3Anative-bindings-s0-code-review-r1-20261023`.
- Estado: completada. Requiere correcciones del harness: tres major y tres minor, sin critical ni controlling. S0 permanece parcial.
- Alcance: probes, fixtures, aislamiento, lifecycle, tipos, pruebas y límites de afirmaciones del incremento; no revisión de una integración nativa completa, que no existe aún.
- Exclusiones: solo lectura, sin nuevos modelos, servicios, bots, mensajes, OAuth, secretos o delegación.
- Evidencia del autor: lint/typecheck/build PASS, 148 unit+15 contratos+147 integración+23 E2E PASS y un skip legacy por opt-in de inferencia real. Fuente en `07-native-capabilities.md` y `90-verification.md`.
- Próxima acción al recibir el dictamen: corregir hallazgos con regresiones y continuar checks pendientes de S0; ninguna aprobación adicional se solicita para el trabajo aislado ya autorizado.

## Findings de ronda 1 y correcciones propuestas

| ID | Severidad | Hallazgo | Corrección y regresión |
| --- | --- | --- | --- |
| S0-F1 | major | Hermes instalado puede cargar .env del checkout pese a HOME temporal | Runtime desde git archive del commit en temporal, solo archivos regulares versionados, excluyendo .env*, .op.env y symlinks; deps del lockfile en venv temporal. Regresión con .env sintético trackeado, archivos locales/untracked y symlink externo |
| S0-F2 | major | codex debug models hereda entorno/cwd personales | Mismo HOME/CODEX_HOME permitido y cwd temporal en descubrimiento y exec; E2E con config inválida en HOME del caller |
| S0-F3 | major | Igual ID/texto no acredita ausencia de regeneración; snapshot periódico con carrera | Generación+secuencia por request, resultado de prueba distinto por generación/secuencia; snapshot síncrono y atómico antes de respuesta, sin reporter periódico; esperar input y contar turnos antes/después de replay y restart |
| S0-F4 | minor | Descubrimiento fallido puede dejar temporal sin close handle | Init protegida con cleanup en catch; regresión con parent temporal exclusivo y source inexistente |
| S0-F5 | minor | Un tool cualquiera hace pasar la afirmación de cuatro tools | Comparar patch/read_file/search_files/write_file para cada turno principal esperado |
| S0-F6 | minor | Flag de inferencia legacy mal nombrado | Documentos corregidos a AGENT_CHAT_REAL_CODEX |

Hermes hace llamadas auxiliares sin streaming para títulos, además del turno principal configurado con streaming. Se observan y numeran por separado: no se confunden con una respuesta regenerada, y cada turno principal conserva aserciones del conjunto completo de tools. Esto evita seleccionar la llamada auxiliar por tener el mismo texto de usuario.

Checks enfocados tras correcciones: dos regresiones de aislamiento/cleanup PASS; cinco tests HTTP del cliente PASS; ambos E2E de capacidades PASS (17.7 s), usando fuente limpia. Los conteos históricos de 8d1f325 no acreditan estas correcciones por sí solos. La revisión r2 verificará el snapshot de correcciones antes de cerrar los findings independientemente.

## Hallazgo adicional del autor y regresión

Una repetición del probe Codex detectó ENOTEMPTY durante cleanup: clones de plugins podían continuar después de salir el proceso líder. Se agregó isolated-command.ts: stdin cerrado, env/cwd explícitos, límite de tiempo/salida, grupo POSIX propio y terminación/escalado desde exit del líder, sin esperar al cierre de pipes heredados. La regresión ejecuta un hijo que sigue escribiendo y mantiene pipes heredados; verifica que ya no reescribe después de retornar control al cleanup. Seis probes consecutivos pasaron tras controlar el grupo. Se conserva retry acotado de rm para el drenaje del filesystem; no se aumentó el timeout de inferencia ni se deshabilitaron plugins para ocultarlo.

Las suites finales se vuelven a ejecutar con este cambio y base nueva antes de cerrar el incremento. El cierre independiente de S0-F1–6 sigue pendiente de ronda 2, y los checks nativos que faltan no se declaran acreditados. La revisión r1 indicó que esos checks pendientes no bloquean por sí solos los módulos comunes S1.

## Verificación final de correcciones

Lint, typecheck y build PASS. Suite final: 148 unit, 15 contratos, 150 integración y 23 E2E PASS, un skip legacy real (AGENT_CHAT_REAL_CODEX). La suite E2E completa duró 33.0 s, con Hermes de fuente limpia en 16.0 s, usando base nueva y http://agent-chat-native-bindings-r3.localhost:1356. Se cerraron solo los dos servidores anteriores iniciados por este trabajo; el receptor real no cambió. S0 sigue parcial; el cierre de findings se presenta a revisión independiente r2 sobre el commit de correcciones.

## Ronda 2 completada

- Snapshot de correcciones: `c8b40a15235ddf44affb5bc8663eb0350dc888fe`.
- Tarea: `node:delegated-task:command%3Amcp%3A1bd8506e-58f0-4b1b-8ef4-39ee3ce5c936%3Adelegate-task%3Anative-bindings-s0-code-review-r2-20261023`.
- Recepción confirmada: Codex `gpt-6.1-sol`, reasoning `high`, service tier `default`, solo lectura.
- Alcance: verificar S0-F1–6 y el cierre de procesos adicionales, sin atribuir aceptación nativa completa ni abrir otra aprobación humana de implementación.
- Veredicto recibido: S0-F7 major (managed scope del host) y S0-F8 minor (cancelación exterior). Los demás findings quedan cerrados o acotados según el registro siguiente. La implementación aislada sigue autorizada y esos gaps no bloquean por sí solos S1 común.

## Resultado de ronda 2 y correcciones F7/F8

La revisión r2 sobre c8b40a1 encontró S0-F7 major (managed scope /etc/hermes independiente de HOME) y S0-F8 minor (SIGKILL exterior podía matar el supervisor antes de drenar sus grupos). Cerró F2–F6 y la parte de F1 relativa al checkout, dejando aislamiento integral pendiente por F7. No critical/controlling; no bloquea por sí solo S1 común.

Correcciones del autor: HERMES_MANAGED_DIR se fija a un directorio vacío antes de importar/reexec; el fixture recibe un scope sintético con .env canario y proveedor inválido, y los requests demuestran que no se carga. Discovery del launcher usa también managed scope vacío. El probe Codex tiene deadline total 50s, propaga AbortSignal a discovery/exec y cancela por SIGTERM/SIGINT/disconnect; el exterior usa SIGTERM a 60s en lugar de SIGKILL, esperando cleanup. La regresión cancela el entrypoint real con CLI falso y descendiente escritor que ignoran SIGTERM, exige terminación en menos de 2s y verifica desaparición del HOME y ausencia de escrituras nuevas.

Checks enfocados: 3 E2E PASS (18.7s); 3 tests de aislamiento/lifecycle PASS; lint/typecheck/build PASS. S0 permanece parcial por capacidades nativas pendientes. El cierre independiente de F7/F8 se verificará junto con el siguiente incremento común, sin pedir otra aprobación de implementación.
