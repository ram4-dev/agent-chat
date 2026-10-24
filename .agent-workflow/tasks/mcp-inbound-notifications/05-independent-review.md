# Revisión independiente: pendiente por cupo del proveedor

Fecha: 2026-10-23. Outline: r1.
SHA-256: `3f4289468259de02011fae9c685be0b8a8ccb9a31e645dfdaf1193027c145b5d`.
Diseño base: r3 aprobado por Ramiro, mensaje «bien aprubeo».

## Identidad y alcance

Revisor requerido: Pi, `nan/glm5.3-flash`, thinking `high`.
T3 confirmó providerInstanceId `pi`, modelo y opción `thinking=high` al aceptar.
Transporte: tarea delegada visible de T3. No se controló Herdr: HERDR_ENV no está
definido en esta sesión. Esta desviación queda registrada; no acredita ejecución
mediante Herdr ni cumplimiento de ese transporte del skill.

Task ID: `node:delegated-task:command%3Amcp%3A4a11e623-f43c-4eac-906a-95d9d9d3be32%3Adelegate-task%3Ainbound-outline-r1-pi-review-20261023`.
Child thread: `thread:delegated-task:command%3Amcp%3A4a11e623-f43c-4eac-906a-95d9d9d3be32%3Adelegate-task%3Ainbound-outline-r1-pi-review-20261023`.
Client request ID: `inbound-outline-r1-pi-review-20261023`.

Se pidió revisión de solo lectura del outline exacto, diseño, research y código
pertinente. Foco: leases/fencing, ACK manual, publicación atómica e idempotente,
OAuth propio, aislamiento del worker, recuperación, pruebas reales y compatibilidad.
No se autorizó implementación, escritura, delegación adicional, push ni PR.

## Resultado recibido

Estado terminal: failed. No se produjo una revisión ni findings.

> nan API error (402): monthly_cap_reached.

El proveedor informó 2,000,216,325 de 2,000,000,000 tokens usados, saldo 0 y reset
el 2026-11-01 a las 00:00 UTC. Es una respuesta del proveedor, no una fecha de
reintento programada ni una garantía de disponibilidad futura.

Critical findings open: desconocido; revisión no ejecutada.
Controlling findings open: desconocido; revisión no ejecutada.
Exact outline revision ready for human approval: ninguna.
Re-review required: sí, revisión completa de r1 o de su revisión sucesora.

## Reanudación y limpieza

No se abrieron tabs/panes de Herdr, workers ni hilos de producción. La tarea T3
falló y no requiere cierre de procesos propios. No se canceló trabajo ajeno.
No repetir automáticamente ni bajar razonamiento. Reintentar cuando exista cupo,
o usar otro revisor si el usuario modifica expresamente el requisito del workflow.
Cada ronda requiere una nueva delegate_task con ID propio y hash actualizado.
No se solicita aprobación del outline hasta completar la revisión requerida.

## Comprobaciones de esta etapa

- HTTPS local respondió 200; no se inició otra instancia del servidor.
- Solo se modificaron documentos en este paquete; sin cambios de implementación.
- No se ejecutó suite de aplicación: esta etapa no cambia comportamiento.
- Validación de whitespace y hash registrada al preparar el paquete.
- Sin push ni PR.

## Cambio de revisor autorizado

Ramiro indicó «hacelo todo con codex». Esta instrucción reemplaza el requisito de
Pi/nan del workflow para este trabajo, incluidas las rondas siguientes.
La ronda Codex revisa el mismo outline r1 y hash; la ronda Pi fallida se conserva
como antecedente, sin atribuirle hallazgos. Revisor confirmado: provider `codex`,
modelo `gpt-6.1-sol`, `reasoningEffort=high`, `serviceTier=default`.
Task ID: `node:delegated-task:command%3Amcp%3A4a11e623-f43c-4eac-906a-95d9d9d3be32%3Adelegate-task%3Ainbound-outline-r1-codex-review-20261023`.
Estado inicial: en curso; no habilita implementación ni aprobación humana.

## Ronda Codex 1: r1 revisada y rechazada

Resultado terminal: completed. Hash revisado al inicio y al cierre:
`3f4289468259de02011fae9c685be0b8a8ccb9a31e645dfdaf1193027c145b5d`.
Base: feat/ui-redesign, 50d0fa61b8dadd468d9e4f4e480a45a2d3b34b63.
Veredicto: requiere r2 y otra revisión independiente antes de aprobación humana.
Ningún hallazgo critical; cuatro controlling y dos major. Solo lectura, sin suites,
modelos de prueba, servicios nuevos, escritura o acceso a credenciales.

| ID | Severidad | Evidencia en r1 | Impacto | Disposición en r2 |
|---|---|---|---|---|
| F1 | controlling | Salidas/binding solo SQLite local (líneas 89, 122); messages-repository.ts rechaza clave con otro texto | B no reconcilia publicación de A ni contexto después de crash | Registro autoritativo por evento, salida inmutable y recibo atómico; B recupera recibo sin regenerar, runtime no se migra automáticamente |
| F2 | controlling | Lease por grupo sin exclusión de generación (55, 67, 91) | Turnos simultáneos en partición o entre grupos; conexión no distingue procesos | Instancia privada, runtime fijo y reserva central global por agente que no expira por heartbeat; ambigüedad bloquea generación |
| F3 | controlling | ACK manual legacy sin autoridad distinta (62); handler recibe solo event_id | Bridge vencido elude fencing usando ruta legacy | Clase bridge sin acceso legacy, ACK automático transaccional; manual cierra evento sin liberar slot incierto |
| F4 | controlling | S0 omite red (21, 34), pese a diseño r3:201 | Herramientas de red integradas pueden quedar activas | Evidencia efectiva de ausencia de shell/archivos/red/conectores al crear y retomar; pruebas negativas complementarias |
| F5 | major | No hay matriz de autorización S1; default concede todos los scopes (contracts.ts:122) | Nuevas facultades sin consentimiento; revocación/scope insuficiente sin control | Matriz actor/operación/permiso, grants bridge explícitos, lista legacy separada de scopes nuevos, administración por dueño HTTP |
| F6 | major | Solo IDs en visor (24, 136) | Dueño no puede inspeccionar hilo/needs_review | Visor de aplicación del dueño con entradas, salidas, decisión, errores, frescura y pausa por binding; no promete T3 ni razonamiento interno |

Los cambios son propuestas de cierre, todavía no aceptadas por segunda revisión.
El revisor reconoció la separación de E2E falso frente a modelo real, la detección
de suites vacías y el gate de modelo/presupuesto. Mantener habilitación explícita
para pruebas con gasto. La revisión no concede aprobación humana.

## Ronda Codex 2: r2 enviada

Hash del outline r2:
`c0966b539321cc01be1a3985cd0e8cac8f406295e6d098dd527f6d3433778bce`.
Revisor: Codex gpt-6.1-sol, reasoningEffort high, serviceTier default.
Client request ID: `inbound-outline-r2-codex-review-20261023`.
Estado: pendiente de resultado. Todos los F1–F6 requieren validación independiente;
no se solicita aprobación del outline ni se inicia código mientras tanto.
Task ID confirmado ronda 2: `node:delegated-task:command%3Amcp%3A1bd8506e-58f0-4b1b-8ef4-39ee3ce5c936%3Adelegate-task%3Ainbound-outline-r2-codex-review-20261023`.
Child thread: `thread:delegated-task:command%3Amcp%3A1bd8506e-58f0-4b1b-8ef4-39ee3ce5c936%3Adelegate-task%3Ainbound-outline-r2-codex-review-20261023`.
T3 confirmó modelo, proveedor y opciones solicitadas. No se crearon workers de
producción, tabs de Herdr ni servicios; la tarea tiene alcance de revisión documental.

## Ronda Codex 2: r2 revisada; requiere r3

Estado terminal: completed. Hash revisado al inicio y al cierre:
`c0966b539321cc01be1a3985cd0e8cac8f406295e6d098dd527f6d3433778bce`.
Sin critical; dos controlling y dos major nuevos. No concede aprobación humana.

| ID | Severidad | Evidencia r2 | Impacto | Disposición propuesta r3 |
|---|---|---|---|---|
| F7 | controlling | Reserva antes de turn/start, turn_id posterior (248); test solo nuevo consumidor (271) | Request retrasado/replay del propietario puede iniciar otro turno tras liberar slot | Despachador exclusivo, consumed durable antes de write, no retry, correlación por request y evidencia positiva de cierre; idle no prueba nada |
| F8 | controlling | Modelo/presupuesto por definir (43,132), sin contabilidad ni reserva previa | Límite de activaciones no limita costo por turno | Política aprobada por dueño, cotas efectivas verificadas, reserva máxima central antes del inicio y gasto incierto retenido; sin capacidad se bloquea |
| F9 | major | Instancia nueva por reinicio, solo anterior puede cerrar (236,258); matriz exige binding habilitado (284) | Pausa/revocación/reinicio impide cerrar incluso después de demostrar fin | Operación limitada de recuperación/cierre por dueño y prueba técnica; capacidad segura de runtime solo para cierre, sin publicación/lectura ni bypass |
| F10 | major | Plazos de jobs no cubren registro remoto y visor (110,231,156) | GC puede borrar texto generated recuperable o dejar copias sin política | Matriz por estado/almacén; pendientes no purgados; 7 días desde ACK y cierre seguro; tombstones y recibos conservados |

Disposición del revisor sobre ronda 1: F1 cerrado en mecanismo principal, retención
pendiente F10; F2 parcial por F7/F9; F3 cerrado; F4 cerrado como criterio, aislamiento
no demostrado; F5 cerrado con matriz a ajustar por F9; F6 cerrado documentalmente.
Los cierres caben dentro del diseño aprobado si no amplían autonomía/permisos ni
cambian proveedor/propiedad de runtime. Mantener gate de modelo y presupuesto.

## Ronda Codex 3: r3 enviada

Hash: `674508d821b87ee9698d06a92df858f8f8476cdb8cbbb5aff66b693ee4e3d53b`.
Client request ID: `inbound-outline-r3-codex-review-20261023`.
Estado inicial: en curso; requiere validación de F7–F10 y continuidad de F1–F6.
Revisor solicitado: Codex gpt-6.1-sol, reasoningEffort high, serviceTier default.
No hay aprobación de implementación ni afirmación de capacidades ya demostradas.
Task ID confirmado ronda 3: `node:delegated-task:command%3Amcp%3A1bd8506e-58f0-4b1b-8ef4-39ee3ce5c936%3Adelegate-task%3Ainbound-outline-r3-codex-review-20261023`.
Child thread: `thread:delegated-task:command%3Amcp%3A1bd8506e-58f0-4b1b-8ef4-39ee3ce5c936%3Adelegate-task%3Ainbound-outline-r3-codex-review-20261023`.
Proveedor, modelo y opciones confirmados. Solo revisión; ninguna activación de producción.

## Ronda Codex 3: r3 lista para aprobación humana

Resultado terminal: completed. Hash verificado al inicio y al cierre:
`674508d821b87ee9698d06a92df858f8f8476cdb8cbbb5aff66b693ee4e3d53b`.
Veredicto: r3 lista para aprobación humana como outline. Sin hallazgos critical,
controlling ni major abiertos. No concede aprobación humana ni implementación.

Disposiciones documentales del revisor: F1 cerrado con registro/recibo y retención;
F2 cerrado con F7/F9; F3–F6 siguen cerrados; F7 cerrado por consumo durable irreversible,
no retransmisión y cierre positivo; F8 cerrado por política/cotas/reservas; F9 cerrado
por recuperación limitada; F10 cerrado por retención de pendientes y tombstones.
Nada de esto demuestra que las capacidades técnicas existan en el host instalado.

Observación minor M1, no bloqueante: S3 dice «reconciliar antes de reintentar»,
pero F7 prohíbe retransmitir turn/start. El revisor confirmó que no existe una vía
autorizada de retry porque prevalece la precisión r3. Se acepta esa interpretación:
reconciliar SIN retransmitir turn/start; ante ambigüedad conservar slot y reserva
económica en needs_review. No se modifica el outline revisado para conservar el
hash exacto presentado al gate humano. Si luego se edita, registrar revisión nueva.

Próximo gate: aprobación humana explícita del outline r3 de ese hash. Solo después
crear worktree fresco y ejecutar S0; no activar grupos ni gastar con modelo real
sin política de modelo/monto y acción explícita del dueño. S0 debe bloquear auto
si no demuestra aislamiento, exclusión, correlación, cierre seguro y cotas efectivas.
La orden «todo con Codex» sigue vigente para implementación y futuras revisiones.

La revisión fue de solo lectura, sin suites/modelos de prueba/secretos/push/PR.
No hay tabs Herdr abiertos por este trabajo ni procesos de revisión a cerrar;
la tarea T3 terminó y se conserva su referencia para trazabilidad.
