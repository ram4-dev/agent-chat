# Inicio de accesibilidad y servicios administrados

Fecha: 23 de octubre de 2026.

Pedido: identificar la rama más reciente, empezar el plan de acceso y preferir servicios administrados, evaluando Vercel y Supabase.

## Identidad del trabajo

- Repositorio principal: `/Users/ramiro/Desktop/projects/agent_chat`.
- Fuente: `feat/ui-redesign`, commit `50d0fa61b8dadd468d9e4f4e480a45a2d3b34b63`.
- Rama nueva: `feat/accessibility-foundation`.
- Worktree: `/Users/ramiro/Desktop/projects/agent_chat.feat-accessibility-foundation`.
- Creación: Worktrunk, con base local explícita. El checkout principal permanece sin commits.
- El otro hilo sigue diseñando el puente en documentos no versionados del worktree de rediseño. Esos cambios no se copiaron ni modificaron. Esta rama se limita a interfaz y pruebas, más la propuesta de servicios.

## Cambios

Contraste del texto secundario, pestaña inactiva y placeholders de acceso; identificación del dueño y foco en navegación. Restauración de foco al desmontar diálogos, con alternativa cuando desaparece el disparador. Menú móvil oculto fuera del orden de Tab; al abrirlo, entrada de foco, contención, Escape, restauración y desbloqueo al cambiar a escritorio. Pestañas de acceso con flechas, Home/End y un solo punto de entrada por Tab.

Cuatro E2E nuevos prueban los recorridos y contraste sobre estilos calculados. Los checks existentes mantienen sus aserciones; el de invitaciones añade retorno de foco. La comprobación del estado del disparador móvil incluye el elemento inerte mientras el drawer está abierto.

La propuesta de proveedores y migración queda en [managed-services.md](/Users/ramiro/Desktop/projects/agent_chat.feat-accessibility-foundation/docs/managed-services.md). No se cambió el backend, la autenticación, persistencia, protocolos ni infraestructura desplegada.

## Verificación

Node 22.23.3 y pnpm 11.10.0. Dependencias instaladas desde el store local con lockfile congelado, sin modificarlo.

- Lint, typecheck y build: aprobados.
- Unitarios: 142; contratos: 15; integración: 117. Todos aprobados.
- E2E completos: 24 aprobados, incluidos OAuth/MCP/receptor y cuatro regresiones nuevas. Servidor de producción real, SQLite descartable y un worker.
- E2E ejecutados con Chromium headless revision 1248 ya instalado, usando configuración temporal en `.local-state/verification/playwright.config.ts`. El proyecto espera revision 1243; en el review previo su descarga falló por timeout del CDN. No se modificaron aserciones para adaptar el navegador. Pendiente repetir con la revisión exacta; no se declara aprobado el comando estándar `pnpm verify`.
- `git diff --check`: aprobado.

La primera ejecución dirigida encontró un problema del nuevo test de contraste: leía estilos antes de terminar la carga de sesión. Se añadió una espera basada en la región de acceso visible, sin sleeps ni aumento de timeouts. Luego los 24 E2E completos aprobaron.

No se certifica WCAG completo: continúan pendientes lectores de pantalla, dispositivos físicos y auditoría del resto de colores y pantallas. La migración administrada todavía no está implementada ni probada en cloud.

## Reanudación

Conservar este worktree y sus cambios para continuar la migración tras la prueba de compatibilidad descrita. Sin merge, push, PR ni publicación. No se cerraron procesos o sesiones de otros trabajos.

## Continuación: servicios administrados

Se implementó el modo `STORAGE_MODE=supabase`: Postgres privado con migraciones, Auth humano por email/contraseña, recuperación por correo y Realtime con avisos sin contenido. El emisor OAuth de agentes se conserva con almacenamiento Postgres. Hay pruebas de dos instancias, idempotencia concurrente, revocación de receptores, límites compartidos y rollback de auditoría.

Decisión posterior del usuario: conservar Supabase Auth y descartar Clerk. No se aplicó una migración a Clerk. Se retiró la dependencia preparatoria `@clerk/backend`; no se borró la aplicación que el usuario seleccionó en el Dashboard.

La repetición de `pnpm verify:managed` aprobó lint, typecheck, build, 144 unitarios, 15 contratos, 118 pruebas de integración, 7 de integración administrada y 26 E2E con Supabase local real. Incluye recuperación mediante correo en el buzón local, contraseña nueva, invalidación de sesiones previas y rechazo de reutilización del enlace. Se usó la revisión Chromium 1248 mediante `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; continúa sin validarse la revisión 1243 predeterminada.

El proyecto Vercel `agent-chat-preview` fue creado y vinculado al repositorio. No hubo despliegue. La creación del proyecto Supabase cloud fue rechazada por el límite gratuito de la cuenta en Compass y en otra organización. No se pausaron ni borraron proyectos. SMTP, dominio remitente, confirmación por correo y validación completa del runtime cloud siguen pendientes.

El primer intento de E2E sobre el paquete Vercel encontró un retorno de recuperación al origen antiguo. La configuración local de GoTrue no se actualiza con `db reset`: se reinició únicamente el stack Supabase de este worktree y se comprobaron `SITE_URL` y la lista de retornos permitidos. Las pruebas de código fuente volvieron a pasar después del reinicio.

Validación final del paquete: `vercel build --yes` y el check de Node 22, handler, tres assets idénticos y ausencia de archivos de entorno aprobaron. Se materializaron localmente los enlaces virtuales de dependencias de Vercel para ejecutar su output con Node. Los 26 E2E volvieron a aprobar sobre ese paquete por Portless, incluido el retorno real del correo de recuperación. Una primera repetición sin limpiar el fixture reutilizó emails fijos de la suite y se interrumpió; la repetición completa aprobada usó `supabase db reset --local` antes de arrancar el paquete. No se cambiaron las aserciones.

Se deja el paquete en `http://agent-chat-packaged.localhost:1356` y el stack Supabase local de este worktree para inspección. Los logs y credenciales locales quedan ignorados; no hay claves en los archivos de documentación.

## Provisión y despliegue cloud

El usuario autorizó borrar o sobrescribir otro proyecto para liberar cupo. Se eligió la alternativa reversible: pausar `nana_wallet_landing` (`aitxhgxmiwfazynmcchs`). Se confirmó `INACTIVE`; sus datos no se borraron. `nana_app` continúa `ACTIVE_HEALTHY`.

Se creó `agent-chat-preview`, ref `qnsymnfydhjcetmcmbxr`, en Compass/NaNa y `us-east-1`. La contraseña nueva permanece en Keychain. Se vinculó Supabase y se aplicaron las tres migraciones; `migration list --linked` confirmó sus versiones remotas. Se provisionaron por stdin las variables privadas de preview y producción en Vercel, y las claves OAuth se mantienen entre despliegues. Ningún archivo de entorno se imprimió ni se subió en el deploy.

La conexión al pooler requiere la CA de Supabase. Se obtuvo el certificado público desde la URL oficial del Dashboard, verificada en su código público; huella SHA256 `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`. Se añadió `DATABASE_SSL_CA` con validación X509 y se conserva `rejectUnauthorized: true`. Una consulta real contra Postgres cloud aprobó con la CA. Tras este cambio aprobaron lint, tipos, build, 145 unitarios, 15 contratos, 118 pruebas de integración, 7 administradas y 26 E2E locales.

El primer despliegue recibió el target production de Vercel automáticamente, por ser el inicial del proyecto. Se provisionaron también sus variables y se configuró el origen estable. Después de resolver TLS, el listener esperaba su promesa al importar el entrypoint, impidiendo responder en Vercel. Se cambió a iniciar `listen` sin esperarlo, como el ejemplo oficial de Fastify de la plataforma. Aprobaron nuevamente lint, tipos y el build remoto. Los intentos anteriores permanecen en el historial de Vercel; la URL estable apunta al despliegue funcional.

URL: https://agent-chat-preview-kappa.vercel.app. Salud pública: HTTP 200, servidor y base OK. Smoke cloud de dos usuarios: logins por email/contraseña, grupo, invitación, mensaje recibido por WebSocket, persistencia al recargar y logout con sesión invalidada. AC12 completo contra cloud: OAuth SDK, MCP, idempotencia, receptor en vivo, pendientes offline, reconexión y revocación; aprobado en 21.7 segundos, sin aumentar timeout ni modificar sus aserciones. La copia de AC12 solo cambia los imports, rutas de screenshots y el alta inicial por una identidad de prueba confirmada vía API privada; el login y todas las interacciones son reales.

Se crearon tres identidades QA con contraseñas aleatorias mantenidas solo en memoria durante las pruebas. SMTP todavía no está configurado. Se mantienen las confirmaciones por correo habilitadas en cloud y contraseña mínima de 12 caracteres; no se desactivaron para hacer pasar las pruebas. Falta validar registro con confirmación y recuperación por correo en cloud cuando el usuario indique dominio y servicio SMTP. La pregunta está pendiente en el hilo. Evidencia y utilidades privadas quedan en `.local-state/cloud/`, excluidas de Git y Vercel. Sin merge, commit ni push.

## Corrección de autorización con Cursor

El usuario reportó fallo al autorizar un agente. Se continúa en este mismo worktree y rama, con la base ya identificada arriba. La inspección de datos cloud se limitó a metadatos de clientes y recursos; no se imprimieron tokens. Aparecieron registros de Cursor e interacciones pendientes con `resource=https://agent-chat-preview-kappa.vercel.app/`, mientras el consentimiento solo concedía permisos al origen sin barra. La prueba de integración reprodujo el fallo antes de cambiar el servidor: tras aprobar, el proveedor volvía a otra pantalla de consentimiento y nunca emitía el código.

Se aceptan explícitamente las dos formas del recurso raíz. El consentimiento registra el identificador solicitado y ambas formas conservan la misma audiencia canónica del token. Se rechazan otros orígenes, paths y queries, antes de crear un agente. No se cambiaron las identidades, claves ni credenciales existentes del usuario.

La regresión de integración pasó tras la corrección. Se añadieron tres casos negativos de recurso y un E2E que usa el SDK con normalización de URL, autoriza y llama realmente a `get_identity` mediante MCP. Aprobaron lint, tipos, build, 145 unitarios, 15 contratos, 122 pruebas de integración, 7 administradas y 27 E2E con Supabase local. Chromium 1248, sin aumentar timeouts. La corrección se publica sobre la misma URL de Vercel; queda por registrar abajo su verificación cloud.

Verificación final: desplegado sobre https://agent-chat-preview-kappa.vercel.app, salud HTTP 200 y base OK. Pasaron dos recorridos AC12 en cloud: identificador original (23.1 s) y URL normalizada con barra final como Cursor (21.1 s). Ambos comprobaron código OAuth, token utilizable en MCP, idempotencia, entrega en vivo, pendientes offline, reconexión y revocación. La regresión de integración también comprobó el refresh con recurso normalizado y audiencia estable; pasó en una ejecución dirigida posterior. El usuario aclaró que no veía errores, sino que no veía completar la autorización, consistente con el bucle reproducido. No se modificaron sus agentes ni se rotaron claves. Los enlaces de interacción viejos pueden haber vencido: reanudar desde el cliente.

Durante el diagnóstico se repitió el smoke de dos usuarios y pasó el login, pero su chequeo inmediato de logout corrió antes de terminar la solicitud. Se corrigió la utilidad privada para esperar la pantalla de acceso antes de verificar HTTP 401; no se cambió el código de cierre de sesión. Las confirmaciones por correo y SMTP siguen siendo un pendiente separado.

## Skill e instrucciones MCP de participación — 24 de octubre

Pedido del usuario: dar a los agentes instrucciones para responder chats y notificaciones y mantener la recepción activa. Se creó la skill local `.agents/skills/agent-chat-participation/SKILL.md`, validada con `quick_validate.py`. No se instaló globalmente. Se usaron las skills de creación de skills y de redacción ya cargadas en el hilo.

El MCP entrega instrucciones de inicio, expone el recurso Markdown `agent-chat://guides/participation` y añade la herramienta de lectura `get_agent_instructions`. Las tres superficies remiten a una sola guía; la herramienta devuelve endpoints del servidor y scopes concedidos, sin credenciales. La guía exige responder mensajes humanos del grupo, procesar pendientes, mantener un receptor durante la sesión, esperar `receiver.ready`, recuperar inbox tras reconexión, deduplicar y usar idempotencia al responder, y hacer ACK después del procesamiento. Explica los nombres distintos de campos de WS e inbox y evita ecos entre agentes. Si el host no puede sostener recepción en segundo plano, debe informarlo y recuperar pendientes mientras esté activo. No se agregó un daemon ni un puente ejecutable.

Integración verifica descubrimiento vía initialize, tools y resources, coincidencia de contenido y ausencia del token en las respuestas. El nuevo E2E usa la URL de receptor devuelta por la guía, recibe un mensaje real, responde por MCP, reintenta sin duplicación y confirma el evento. Aprobaron lint, tipos, build, 145 unitarios, 15 contratos, 123 pruebas de integración, 7 administradas y 28 E2E locales. La primera ejecución encontró errores de tipos en las aserciones de recursos texto/blob; se corrigió su discriminación y se repitió la suite completa.

`vercel build --prod` y el check de artefacto aprobaron, incluida la skill idéntica al archivo fuente, el handler, Node 22, tres assets y ausencia de archivos de entorno. Se desplegó en https://agent-chat-preview-kappa.vercel.app. Salud HTTP 200, servidor y base OK. El E2E de participación también aprobó en cloud (13.5 s), con identidad QA confirmada mediante API privada y sin afirmar que prueba correo. Capturas y utilidades privadas continúan excluidas de Git y Vercel. No se aumentaron timeouts ni se cambiaron permisos del agente. Conservar rama y worktree; sin commit, merge ni push.
