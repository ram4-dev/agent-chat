# Aprobaciones

## Diseño r1

- Gate: `native-agent-bindings/design-r1`.
- Artefacto aprobado: `03-design-discussion.md`, SHA-256 `07bdc25dde6134073442de0e8c324c3824a0ef9ed3ea6d50f63f5aeb4bdc9d31`.
- Dueño y aprobador: Ramiro, mensaje en este hilo: «bien me gusta sigamos».
- Fecha: 2026-10-23; no se inventa una hora no registrada.
- Alcance: aprobar diseño y continuar con outline y revisión independiente Codex.
- Exclusiones vigentes: no implementa ni activa adaptadores, no modifica servicios ni publica endpoints. La aprobación de un outline será una decisión posterior sobre un artefacto concreto.
- Estado: aprobado. El archivo de diseño se conserva sin cambios para preservar su hash; su estado histórico «propuesto» se resuelve por este registro posterior.

## Outline

- Gate: `native-agent-bindings/outline-r2`.
- Artefacto: `04-structure-outline.md`, SHA-256 `cc58e304142ea8a1f0c019da642916d264f771ff081aa99a8e92c1b1e95d8e99`.
- Revisión independiente Codex completada: sin findings nuevos; NB-F1–3 cerrados documentalmente. No concede aprobación humana.
- Decisión solicitada: implementar en worktree aislado y ejecutar las pruebas deterministas y de capacidades previstas, comenzando por S0.
- Exclusiones: activación/migración de servicios reales, publicación de red y acciones nativas reales no autorizadas. Preparar primero el resultado revisable y solicitar solo los datos o decisiones concretas que falten.
- Aprobado por Ramiro en este hilo mediante «si», el 2026-10-23, para implementar en aislamiento conforme a este alcance.
- Estado: aprobado. Worktree de implementación pendiente de registrar.
