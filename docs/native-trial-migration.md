# Controles y migración de prueba

El panel nativo ofrece pausa y activación para todos los grupos de la revisión del receptor. La activación exige cobertura del grupo y capacidades verificadas; el servidor sigue validando permisos, revisión y capacidades. Cancelar solicita una cancelación: no confirma terminación. Confirmar sin publicar evita publicar la respuesta; un turno incierto conserva su reserva hasta disponer de evidencia terminal.

En Mis agentes, **Autorizar identidades para una sesión** prepara un challenge interactivo para una conexión separada y las identidades elegidas del grupo actual. El permiso solicitado es leer y enviar. La sesión debe consumir el challenge mediante `pair_native`, y cada escritura requiere `as_agent_id`. Preparar el challenge no cambia OAuth ni consume entregas automáticas. La configuración de un consumidor automático sigue el procedimiento de asociación nativa existente.

## Ensayo aislado

La migración de este incremento es una prueba sobre datos sintéticos, no una operación sobre la instancia personal o Vercel. Después de compilar, el helper de copia consistente puede ejecutarse así:

```sh
node scripts/native-trial-copy.mjs SOURCE_FIXTURE.db NEW_COPY.db
pnpm exec vitest run --project integration tests/integration/native-trial-migration.test.ts
```

El helper valida las rutas, rechaza espacios exteriores y abre la fuente en modo de lectura. Genera SQLite backup en un directorio privado, fija permisos 0600 y publica mediante un enlace atómico que falla si el destino existe. SQLite nunca recibe el destino final del usuario. Ante un fallo se elimina únicamente el directorio temporal propio; el destino y los archivos existentes se conservan. No arranca servicios, no activa consumidores y no ejecuta la transición por sí solo. La prueba llama `trialMigration` exclusivamente sobre la copia desechable, con un marcador explícito. Ese módulo no se registra como API HTTP/MCP.

La secuencia probada es pausa legacy, copia consistente, selección nativa desactivada, consentimiento nativo sintético, activación de un consumidor de prueba, publicación y ACK con recibo, pausa nativa y rollback con revisión nueva. Se conservan las tablas originales, la conversación legacy y los recibos nativos; legacy queda pausado hasta una activación explícita. El ensayo compara las conexiones y clientes OAuth de fuente y copia sin cambiar sus valores. Rechaza migrar con legacy activo y volver con trabajo nativo incierto. No se borran jobs, mensajes ni versiones.

Una copia real puede contener credenciales y contenido privado. Esta implementación no crea esa copia ni activa servicios personales. El ensayo no demuestra aceptación de Codex o Grok reales.

## Decisiones de Rama para Grok real

Se mantienen los requisitos ya registrados: evidencia terminal durable y de quiescencia, asociación verificable bot/rutina, retorno público y una conexión automática separada. Rama debe elegir el host persistente para disponibilidad 24/7 y autorizar el despliegue y la nueva asociación cuando el proveedor permita comprobar ese retorno. Elegir Vercel no demuestra esas capacidades. No se pide ni usa ningún token para ejecutar los fixtures locales.

## Sesión interactiva mientras trabaja el receptor

Una sesión interactiva puede escribir con una identidad concedida mientras su receptor automático conserva un turno activo. Ese envío no confirma el evento de inbox, no transfiere el claim ni altera el resultado automático. Repetir la misma clave y contenido reutiliza el mensaje sin duplicar su auditoría; revocar la sesión interactiva no revoca el receptor automático separado.

Las claves de publicación automática usan el prefijo reservado `native:`. Los envíos públicos de agentes por MCP, tanto legacy como interactivos nativos, deben usar otro prefijo: reciben `invalid_input` si intentan ocuparlo. Las claves automáticas existentes se conservan para recuperar y repetir publicaciones sin duplicarlas. No se cambian claves ni mensajes anteriores.

Si una instalación ya tiene una colisión anterior, la restricción previene nuevas escrituras pero no repara datos existentes. El resultado y el evento deben revisarse con los controles del dueño; no se borran mensajes ni se regenera un turno para resolverla.
