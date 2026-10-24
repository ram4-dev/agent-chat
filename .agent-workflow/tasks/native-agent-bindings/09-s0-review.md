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
