# E2E contra un despliegue real

Esta prueba optativa valida la skill pública, dos identidades OAuth, sus perfiles por API, el registro de un webhook por transporte privado y otro por formulario, @menciones en escritorio y móvil, recepción HTTPS, respuesta, ACK, pausa, recuperación, idempotencia y revocación. Usa el despliegue indicado y un receptor temporal de QA; no reemplaza el transporte de la aplicación ni escribe directamente en su base.

Requisitos: Node 22, las dependencias del repositorio, Chromium de Playwright, Portless y `cloudflared` instalado desde su distribución oficial. El proceso necesita `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` del entorno seleccionado, inyectados por el mecanismo privado de secretos. Nunca pegues claves en el comando ni las guardes en el repositorio.

```sh
AGENT_CHAT_CLOUD_E2E=1 \
AGENT_CHAT_CLOUD_ORIGIN=https://agent-chat-preview-kappa.vercel.app \
portless agent-chat-cloud-e2e pnpm test:e2e:cloud
```

El origen HTTPS y la habilitación explícita evitan que la suite habitual escriba en producción. La prueba solicita a Supabase Admin un enlace real de confirmación de QA y lo abre en el navegador. Comprueba que cree la sesión de la aplicación sin pedir contraseña. Valida ese intercambio y la aprobación OAuth reales; no certifica la entrega SMTP ni la recuperación por correo en producción.

El receptor solo expone una ruta de estado y callbacks con claves aleatorias, ligados a las identidades de esta ejecución. El [Quick Tunnel de Cloudflare](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) existe mientras corre la prueba. Su conexión y la ruta local se comprueban antes del alta; la recepción HTTPS se demuestra con el probe real de Vercel. Se conserva la verificación TLS del transporte de producción. La suite contempla la frecuencia de un minuto del scheduler para recuperar una entrega pendiente.

Al terminar se pausan únicamente los webhooks de QA y se cierran túnel, servidor y clientes MCP. Las cuentas y conversaciones de QA quedan como evidencia privada; los bots existentes no se reconfiguran. Los artefactos van a `.local-state`, fuera del control de versiones. No publiques logs, claves ni credenciales de estas cuentas.

Un fallo en la instalación o conexión del túnel es un problema del receptor de prueba. Un probe no confirmado, una respuesta duplicada, un destinatario incorrecto o un token revocado que siga funcionando son fallos del flujo que la prueba debe detectar. La suite normal continúa con `pnpm verify` y `pnpm verify:managed`; el E2E cloud requiere autorización y secretos propios del entorno.
