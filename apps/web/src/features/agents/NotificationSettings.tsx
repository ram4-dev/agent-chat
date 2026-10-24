import { useCallback,useEffect,useState,type FormEvent } from 'react';
import { Modal } from '../../shared/ui';

interface Status {available:boolean;configured?:boolean;active:boolean;enabled?:boolean;receipt_confirmed?:boolean;connection_id?:string;reason?:string;
  destination_host?:string;needs_attention?:boolean;latest_delivery?:{status:string};connections?:Array<{id:string;oauthClientId:string;clientName?:string}>}

export function NotificationSettings({agentId,name,onClose}:{agentId:string;name:string;onClose():void}) {
  const [state,setState]=useState<Status>();const [connection,setConnection]=useState(()=>new URLSearchParams(location.search).get('notification_connection')??'');
  const [url,setUrl]=useState('');const [secret,setSecret]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [platform,setPlatform]=useState(()=>new URLSearchParams(location.search).get('notification_platform')==='generic'?'generic':'grokbot');
  const path=`/api/agents/${encodeURIComponent(agentId)}/notifications`;
  const refresh=useCallback(async()=>{
    const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw new Error();
    const result=await response.json() as Status;setState(result);
    setConnection((current)=>current||result.connection_id||(result.connections?.length===1?result.connections[0]!.id:''));
  },[path]);
  useEffect(()=>{void refresh().catch(()=>setError('No pudimos consultar la configuración.'));const timer=setInterval(()=>{void refresh().catch(()=>{});},2000);return()=>clearInterval(timer);},[refresh]);
  async function action(suffix:string,body?:object){
    const response=await fetch(path+suffix,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body??{})});
    if(!response.ok)throw new Error();return response.json();
  }
  async function test(){setBusy(true);setError('');try{await action('/test');await refresh();}catch{setError('No pudimos completar la prueba. Revisá la rutina y sus credenciales.');}finally{setBusy(false);}}
  async function save(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{
    await action('',{connectionId:connection,platform,url,secret});setSecret('');setUrl('');await refresh();
    await action('/test');await refresh();
  }catch{setError('No pudimos guardar y probar. Usá la URL HTTPS y la clave de la rutina del agente seleccionado.');}finally{setSecret('');setBusy(false);}}
  return <Modal title={`Notificaciones de ${name}`} onClose={onClose}>
    {error&&<p className="error-box" role="alert">{error}</p>}
    {!state?<p role="status">Consultando notificaciones…</p>:!state.available?<p>Este servidor permite recibir mediante el receptor autenticado del cliente. Los webhooks requieren el despliegue con Supabase.</p>:<>
      <p>Creá una rutina con disparador webhook en Grok Bot. Su instrucción debe verificar la identidad, confirmar el aviso con <code>confirm_notification_delivery</code> y atender el inbox mediante su cuenta MCP autorizada.</p>
      <p role="status">{state.active?'Notificaciones activas: recepción confirmada por el agente.':state.reason==='authorization_required'?'Reconectá el cliente MCP antes de activar los avisos.':state.reason==='paused'?'Avisos pausados. Podés probar y activar cuando quieras.':state.needs_attention?'Notificaciones requieren revisión.':state.configured?'Configurado: esperando que el agente confirme una prueba real.':'Falta vincular la rutina del agente.'}</p>
      {state.destination_host&&<p>Destino guardado: {state.destination_host}</p>}
      {state.latest_delivery&&<p>Último aviso: {state.latest_delivery.status==='accepted'?'Aceptado por la plataforma; esperando confirmación del agente.':state.latest_delivery.status==='confirmed'?'Recibido y confirmado por el agente.':state.latest_delivery.status==='queued'?'En cola.':state.latest_delivery.status==='sending'?'Enviando.':state.latest_delivery.status==='uncertain'?'Entrega incierta; revisá el historial de la rutina antes de probar otra vez.':state.latest_delivery.status==='failed'?'La plataforma rechazó el aviso.':'Sin entrega activa.'}</p>}
      {state.needs_attention&&<p className="error-box">Hay avisos que requieren revisión. Los mensajes siguen pendientes en el inbox.</p>}
      <form onSubmit={(event)=>void save(event)}>
        <label>Plataforma<select aria-label="Plataforma de notificaciones" value={platform} onChange={(event)=>setPlatform(event.target.value)}><option value="grokbot">Grok Bot</option><option value="generic">Otro host con webhook</option></select></label>
        <label>Cliente MCP<select aria-label="Cliente MCP para notificaciones" required value={connection} onChange={(event)=>setConnection(event.target.value)}>
          <option value="">Elegí la conexión del bot</option>{state.connections?.map((item)=><option key={item.id} value={item.id}>{item.clientName||item.oauthClientId} · {item.id.slice(-8)}</option>)}
        </select></label>
        <label>URL del webhook<input aria-label="URL del webhook" type="url" required value={url} autoComplete="off" onChange={(event)=>setUrl(event.target.value)}/></label>
        <label>Clave del webhook<input aria-label="Clave del webhook" type="password" required value={secret} autoComplete="off" onChange={(event)=>setSecret(event.target.value)}/></label>
        <p>La clave se guarda de forma privada y no se devuelve al chat ni al navegador. Usá el enlace de configuración del MCP para seleccionar la conexión correcta.</p>
        <button className="button primary" disabled={busy||!connection} type="submit">{busy?'Guardando y probando…':'Guardar y probar'}</button>
      </form>
      {state.configured&&<div className="modal-actions">
        <button className="button secondary" disabled={busy||state.reason==='authorization_required'} onClick={()=>void test()}>Probar y activar</button>
        {state.enabled&&<button className="button secondary" disabled={busy} onClick={()=>{setBusy(true);void action('/pause').then(refresh).catch(()=>setError('No pudimos pausar los avisos.')).finally(()=>setBusy(false));}}>Pausar avisos</button>}
      </div>}
    </>}
  </Modal>;
}
