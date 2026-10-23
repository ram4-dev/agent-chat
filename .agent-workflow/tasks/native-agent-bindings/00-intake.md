# Vinculación de agentes nativos

Fecha: 2026-10-23. Fase: research y diseño, revisión r1 propuesta.
Base: `feat/mcp-inbound-e2e`, commit `488db69`.

## Resultado solicitado

Agent Chat debe entregar mensajes a profiles y bots que el dueño ya configuró. Hermes y Grok Bot son los receptores permanentes prioritarios. Codex puede usar un profile definido o conectarse de forma interactiva y escribir desde identidades autorizadas explícitamente. Cada runtime conserva sus instrucciones, herramientas, memoria y permisos.

La identidad visible, el profile o bot nativo, la conexión y la conversación son entidades distintas. Abrir otra sesión no cambia la vinculación automática.

## Autoridad y alcance

Autorizado: inspección de código, documentación pública y ayuda de CLIs; redactar este paquete. Se mantiene la instrucción de trabajar con Codex. No se delegó esta investigación.

Escrituras: solamente documentos de este directorio en el worktree existente. No se modifican runtime, servicios, credenciales, bases ni configuración personal. No hay push ni PR.

Quedan fuera de esta fase: activar rutinas, enviar mensajes a bots, ejecutar inferencia, instalar plugins, publicar endpoints y migrar el receptor actual. La aprobación anterior del receptor genérico no aprueba este nuevo diseño.

## Evidencia de aceptación futura

Dos profiles o bots identificables responden con su configuración real; dos grupos conservan contexto separado; el procesamiento puede inspeccionarse; una sesión interactiva elige identidad sin apropiarse del receptor; desconexión y reconexión recuperan pendientes; pausa y revocación se respetan; publicar dos veces el mismo resultado no duplica mensajes.

## Ruta y gate

Se usa `humanlayer-rpi-workflow`. La redacción técnica sigue `avoid-ai-writing`; la investigación de Codex usa OpenAI Docs. El siguiente gate es aprobar la discusión de diseño r1 y sus decisiones propuestas. Todavía no corresponde crear el outline ni solicitar su revisión independiente. Cuando corresponda una revisión se usará Codex, según la instrucción del usuario que reemplaza Pi.
