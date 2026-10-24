# Codex nativo: capacidad pendiente

La integración automática con un profile Codex elegido todavía no está habilitada. En Codex 0.164.0 instalado, la invocación `codex --profile alpha app-server --listen stdio://` falla antes de iniciar: `--profile only applies to runtime commands`. El esquema instalado de `thread/start`, `thread/resume` y `config/read` tampoco contiene un selector de profile. El selector antiguo `profile=...` es rechazado expresamente como configuración legacy.

La [documentación de App Server](https://learn.chatgpt.com/docs/app-server) describe threads, turnos y aprobaciones. La [configuración de profiles](https://learn.chatgpt.com/docs/config-file/config-advanced) describe la capa seleccionada con `--profile`. La combinación requerida no queda acreditada por esa documentación ni por la versión local.

## Qué se comprobó

```sh
pnpm bridge:codex-native-check
pnpm exec vitest run --project integration tests/integration/codex-native-profile.test.ts
```

El diagnóstico usa HOME y CODEX_HOME temporales, no inicia turnos ni lee configuración personal. Devuelve `supported:false`, con la razón de rechazo o `not_demonstrated`. Una versión futura que acepte el arranque tampoco pasa automáticamente: habrá que demostrar selección efectiva, aprobaciones, correlación y terminación durable.

La prueba aislada adicional ejecuta dos profiles CLI temporales contra un proveedor HTTP falso. Comprueba personas distintas y herramientas anunciadas, conservando el catálogo completo del fixture. Eso acredita configuración del CLI en esos casos; no acredita un receptor automático, permisos reales, ejecución de herramientas o una aprobación nativa. El worker legacy conserva su comportamiento anterior.

## Qué falta para cerrar S6

Hace falta una vía soportada que seleccione el profile exacto y conserve sus políticas, o un host Codex que ofrezca ese contrato. Luego deben comprobarse aprobaciones, resultados durables, recuperación sin regeneración, conversación por grupo y acceso al historial. La aceptación de un profile personal requiere su elección explícita; en este trabajo no se seleccionó uno ni se cambió su configuración.

No se copian perfiles a otro HOME, no se aplanan sus archivos ni se sustituye el modelo para aparentar compatibilidad. Tampoco se reemplaza esta garantía por ejecutar el worker legacy. No se actualiza la instalación global de Codex como parte de la prueba.
