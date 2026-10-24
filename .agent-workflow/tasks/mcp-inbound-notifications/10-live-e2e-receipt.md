# Reanudación: prueba real y circuito funcional

Usuario: «Usa algun modelo y probalo a ver si fucniona, deja todo funcionando e2e».
Autoriza seleccionar modelo Codex disponible e iniciar prueba real acotada, sin
volver a pedir aprobación de consumo para esa prueba. Se sustituye la prohibición
de ensayo real basada en ausencia de monto; no se presenta como techo monetario
exacto ni como una cota que el runtime no ofrece. Aislamiento y no duplicación se
implementan y verifican; no se omiten silenciosamente.

Worktrunk: wt switch --create feat/mcp-inbound-e2e --base feat/mcp-inbound-notifications --format json --yes
Source: /Users/ramiro/Desktop/projects/agent_chat.feat-mcp-inbound-notifications
Base branch / commit: feat/mcp-inbound-notifications / 91794f3
Nueva rama: feat/mcp-inbound-e2e
Worktree: /Users/ramiro/Desktop/projects/agent_chat.feat-mcp-inbound-e2e
Estado: conservado para implementar/verificar; sin merge, push o PR.

Ruta local que se evaluará: control-plane App Server usa MCP ya autorizado mediante
su API oficial, sin extraer tokens; worker Codex ignora config de usuario y excluye
herramientas. Es una alternativa al OAuth propio del puente: se registra como
desviación, manteniendo autenticación en el almacén administrado por Codex.

## Ruta funcional implementada

Se usa MCP runtime_next con espera despertada por el hub y reconciliación del inbox,
no el token extraído para WS ni un webhook HTTP remoto. El control plane administra
OAuth a través de Codex App Server; el worker CLI ignora configuración de usuario,
usa catálogo restringido y valida salida JSON. Cada prepare exige cero herramientas
renderizadas para start y resume contra un backend local falso, sin inferencia.
El E2E real invoca supervisor.js/main.js/CodexControl, no llama processNext desde
el test, y mata el control-plane para probar el reinicio supervisado real.

Se autoriza una conexión de agente para inicializar grupos no configurados (acción
explícita del CLI); solo el dueño puede cambiar una configuración existente. La
pausa del dueño prevalece incluso al reiniciar el receptor. No se agregan nuevos
permisos a defaults OAuth ni se entregan credenciales o tools MCP al modelo.

Los recibos, salida inmutable, claim y generación de controlador se guardan en
servidor. Un controller_id nuevo invalida las esperas anteriores: fue necesario
para que un long poll de un proceso muerto no reclamara otro evento. Un resultado
sin confirmación queda bloqueado; nunca se regenera de forma automática.

La prueba real y suite completa pasaron con gpt-6.1-sol, incluyendo dos mensajes
en un mismo hilo, otro grupo con hilo distinto y reinicio tras matar App Server.
Se mantiene límite operativo de 30 eventos/hora y timeout 120 s; no se afirma un
techo USD preventivo que Codex no ofrece. El usuario autorizó el ensayo real y
la operación automática; estos límites sustituyen el bloqueo de la estrategia S0.

Worktrees y ramas fuente preservados. Servicio local previsto mediante LaunchAgents
usuario: local.agent-chat.server y local.agent-chat.receiver. Instalador revisable
scripts/install-local-services.py. Backup SQLite privado listo antes de migración.
