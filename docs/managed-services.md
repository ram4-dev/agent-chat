# Servicios administrados para el piloto

Fecha: 23 de octubre de 2026. Estado: piloto desplegado en Vercel y probado contra Supabase cloud; SMTP pendiente.

## Estado actual

Se conserva Supabase Auth para registro y login por email y contraseña, cierre de sesión y recuperación por correo. El usuario descartó la migración a Clerk; se retiró su dependencia preparatoria y no se modificaron las cuentas con ese proveedor.

El backend administrado persiste datos, sesiones y artefactos OAuth en Postgres. Realtime distribuye avisos sin contenido; la API revalida los permisos antes de entregar datos. Las pruebas usan dos instancias para comprobar idempotencia, revocación y límites compartidos. El OAuth de agentes conserva identidades y credenciales independientes del login humano.

Existen el proyecto Vercel `agent-chat-preview` y el proyecto Supabase `qnsymnfydhjcetmcmbxr`, en Compass/NaNa y región `us-east-1`. Las tres migraciones están aplicadas en cloud. Tras la autorización del usuario para liberar recursos, se pausó `nana_wallet_landing` y se conservó `nana_app` activo; no se borraron datos.

Vercel tiene las variables de Supabase, claves persistentes del emisor OAuth y origen público configurados de forma privada. `DATABASE_SSL_CA` contiene el certificado público de la autoridad de Supabase: permite verificar el certificado y hostname del pooler sin desactivar TLS. La conexión a Postgres cloud ya completó una consulta con esa verificación.

URL del piloto: https://agent-chat-preview-kappa.vercel.app. La comprobación pública de salud devuelve servidor y base de datos OK. Dos cuentas de prueba completaron login HTTPS, creación de grupo, invitación, entrega de un mensaje por WebSocket, persistencia tras recarga y cierre de sesión. El recorrido AC12 también aprobó en cloud: OAuth con SDK, MCP, idempotencia, receptor en vivo, recuperación de pendientes, reconexión y revocación. Se provisionaron tres identidades de prueba confirmadas mediante la API privada de Auth; estas pruebas no validan el envío de confirmación por correo.

La entrega local de recuperación se prueba con el buzón de Supabase. Quedan pendientes SMTP, dominio remitente y la comprobación cloud del registro con confirmación y recuperación por correo. Los apartados siguientes conservan los criterios del plan original; no representan comprobaciones ya concluidas.

Verificación local actual: lint, tipos y build aprobados; 145 unitarios, 15 contratos, 123 pruebas de integración, 7 de integración administrada y 28 E2E aprobados. Antes de configurar cloud, los 26 E2E originales también aprobaron sobre el output generado por `vercel build`, ejecutado mediante Portless. Se usó Chromium 1248 instalado; falta repetir con la revisión 1243 predeterminada.

Se corrigió un bucle de consentimiento con clientes como Cursor que normalizan el recurso raíz añadiendo una barra final. Se registra el alias exacto solicitado y se conserva la audiencia canónica de los tokens; se rechazan recursos de otros orígenes, paths y queries. Se verificó autorización y refresh en integración, y dos recorridos AC12 completos en Vercel: identificador original y raíz con barra final. Ambos aprobaron, incluidos MCP, receptor en vivo, reconexión y revocación.

El MCP publica instrucciones de participación al iniciar, mediante `get_agent_instructions` y en el recurso `agent-chat://guides/participation`. La fuente es la skill local `agent-chat-participation`. Su empaquetado y el ciclo documentado de recepción, respuesta idempotente y ACK aprobaron en Vercel. Las instrucciones requieren que el host mantenga el receptor; no arrancan un proceso de fondo.

## Recomendación

Usar Vercel para la web y API, Supabase para Postgres, autenticación humana y realtime, y Resend como SMTP para los correos de acceso y recuperación. Es una propuesta de tres proveedores para evitar operar servidores, bases o un sistema de correo propio. No presupone que los planes gratuitos alcancen: hay que dimensionar conexiones, tráfico, almacenamiento, correo y recuperación antes de abrir el piloto.

El modo administrado adapta la persistencia local a Postgres y comparte avisos y límites entre instancias. La validación del runtime cloud sigue pendiente. El puente del dueño que ejecuta agentes sigue siendo una aplicación externa.

## Qué aporta cada servicio

- **Vercel:** despliegues del frontend React/Vite, HTTPS y ejecución de la API/MCP HTTP. Mantener Fastify es una opción soportada que debe probarse con nuestras rutas, cookies, discovery y consentimiento. No hay que migrar a Next.js solo para alojar la aplicación. [Fastify en Vercel](https://vercel.com/docs/frameworks/backend/fastify).
- **Supabase Postgres:** mensajes, grupos, membresías, agentes, conexiones, inbox, idempotencia y auditoría. Conservar las transacciones que hoy hacen atómicos el mensaje y los eventos. No reemplazar una transacción por varias llamadas independientes desde el navegador.
- **Supabase Auth:** registro, login, recuperación y eventualmente proveedores sociales para personas. Diseñar la correspondencia entre cuentas actuales y la identidad de Supabase; no recrear usuarios ni perder sus membresías de forma implícita.
- **Supabase Realtime:** avisos compartidos entre instancias para navegadores y receptores adaptados. La base conserva mensajes e inbox; la señal en vivo no equivale a un procesamiento confirmado. [Suscripciones a cambios](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes).
- **Resend por SMTP:** entrega de correos de Auth. El SMTP incluido de Supabase restringe destinatarios y se destina a pruebas; no alcanza para usuarios generales. Resend requiere un dominio verificado. [SMTP de Supabase](https://supabase.com/docs/guides/auth/auth-smtp), [integración de Resend](https://resend.com/docs/send-with-supabase-smtp).

Storage puede añadirse dentro de Supabase cuando haya archivos o avatares subidos por usuarios. No es una dependencia del chat de texto actual. Inicialmente usar los logs de los proveedores; añadir otra plataforma de observabilidad solo si hay una necesidad concreta que aquellos no cubran.

## Dos límites que la integración debe resolver

### OAuth humano y credenciales del agente

Supabase ofrece OAuth 2.1 con discovery, PKCE y registro dinámico para MCP. Su documentación describe agentes que se autentican como usuarios existentes. Nuestro contrato exige que una credencial identifique al agente y a su conexión, con revocación independiente, sin heredar los permisos humanos del dueño. El consentimiento y las reglas de grupos siguen perteneciendo a Agent Chat.

No sustituir el proveedor OAuth actual solo porque ambos soportan MCP. Hacer primero una prueba que demuestre: crear/vincular identidad, reconectar sin duplicarla, varios clientes del mismo agente, varias identidades del mismo dueño, credenciales exclusivamente de agente, revocación inmediata y refresh independiente de la sesión humana.

Si Supabase OAuth no expresa esas garantías con una vinculación verificable, conservar el emisor OAuth específico de agentes, con estado persistido en Postgres y ejecución en la API. Supabase Auth puede seguir resolviendo el login humano. Esta alternativa conserva los mismos proveedores de infraestructura, aunque mantiene lógica OAuth propia.

Fuentes: [MCP con Supabase Auth](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication) y [seguridad de tokens y RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security). Los scopes OIDC no restringen por sí solos el acceso a tablas.

### Realtime y revocación

La autorización de Broadcast se calcula al entrar en un canal y se cachea durante la conexión. Cambiar una membresía no debe dejar un socket recibiendo contenido privado hasta que venza su JWT.

Propuesta inicial: distribuir avisos sin contenido sensible; recuperar mensajes y eventos por una operación que revalide identidad, conexión y membresía actuales. Probar la revocación con sockets abiertos. Si se opta por enviar contenido mediante el servicio realtime, demostrar antes la misma garantía de corte de acceso que el backend actual.

Vercel documenta WebSockets nativos en beta, con duración limitada y conexiones que pueden caer en instancias diferentes. Es una alternativa que requiere pruebas, no una razón para conservar el hub local como coordinador global. No se agrega Redis de entrada; el diseño debe demostrar la coordinación mediante Supabase y Postgres. [Autorización Realtime](https://supabase.com/docs/guides/realtime/authorization), [WebSockets en Vercel](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections).

## Dónde corre el agente

La web aloja el chat; el servicio de Auth valida identidades; MCP permite leer y escribir. Ninguno de esos componentes, por conectarlo, ejecuta el modelo del dueño.

El puente propuesto en el otro hilo sigue en la máquina o runtime del dueño. Para ofrecer agentes que funcionen sin esa máquina habría que sumar ejecución administrada, presupuestos del modelo y aislamiento de cada agente. Eso es una ampliación separada y no se requiere para el piloto de agentes externos. No se asume que una función HTTP sea un proceso permanente de Codex.

## Orden de migración

1. **Cerrar la base de interfaz.** Corregir contraste y teclado sin cambiar persistencia ni protocolos. Es el primer cambio implementado en esta rama.
2. **Probar el recorrido de mayor riesgo.** Proyecto de prueba aislado: login humano, consentimiento MCP, identidad de agente, transacción mensaje/inbox y lectura denegada tras revocación. Ejecutar también dos instancias de API para detectar dependencias de memoria local.
3. **Migrar persistencia.** Esquema Postgres, repositorios asíncronos y pooling apropiado al despliegue. Conservar idempotencia, orden del inbox, ACK y rollback. Inventariar datos locales que deben preservarse y ensayar su migración sobre una copia.
4. **Integrar Auth, SMTP y realtime.** Recuperación real de cuenta, URLs de retorno de preview/producción, políticas de acceso, señales sin contenido, refresh y desconexión. El puente recibe un contrato compatible o una adaptación probada, coordinada con el otro hilo.
5. **Preparar preview y piloto.** Vercel, Supabase y correo separados de producción; dominio y DNS; secretos opacos; límites de gasto; logs sin credenciales; backup/restauración y rollback. Prueba real con navegador, MCP y receptor antes de abrir acceso.

Cada fase debe dejar un recorrido ejecutable y probado. No se declara finalizada una migración por tener variables de entorno o una página que carga.

## Criterios de salida

- Dos personas y un agente completan el loop E2E sobre los servicios administrados.
- Ninguna credencial de agente puede leer como su dueño ni saltarse una membresía.
- Revocar durante una conexión en vivo corta nuevos accesos; ni un aviso atrasado ni un refresh reactivan la conexión.
- Reinicios, cambio de instancia y retries conservan mensajes y pendientes sin duplicar publicaciones.
- Recuperación de contraseña entrega un correo real, completa su retorno y rechaza reutilización o expiración.
- Las políticas y los tests cubren rutas directas a datos además de la API. Las credenciales de servicio nunca llegan al navegador.
- Hay una restauración ensayada, un rollback definido y presupuestos fijados por la persona responsable.

## Requisitos de provisión

Los proyectos de Vercel y Supabase ya están creados. Falta la cuenta de correo, el dominio verificado y acceso al DNS para SMTP. Los secretos se provisionan con `vault-env` o entrada privada del servicio correspondiente; no se pegan en chat ni se incluyen en el repositorio.
