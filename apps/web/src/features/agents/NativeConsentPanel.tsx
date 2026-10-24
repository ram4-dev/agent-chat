import { useState } from 'react';
import type { OwnedAgentView } from '@agent-chat/contracts';
import { Modal, CopyField } from '../../shared/ui';
/** Preparing a native challenge never changes an OAuth grant or consumes inbox work. */
export function NativeConsentPanel({ agents, groupId, groupName, groupAgentIds }: { agents: OwnedAgentView[]; groupId: string; groupName: string; groupAgentIds: readonly string[] }) {
 const [open,setOpen]=useState(false);const [connection,setConnection]=useState('');const [selected,setSelected]=useState<string[]>([]);const [challenge,setChallenge]=useState<string>();const [error,setError]=useState(false);const [busy,setBusy]=useState(false);
 const eligible=agents.filter(a=>a.status==='active'&&groupAgentIds.includes(a.id));
 async function prepare(){setBusy(true);setError(false);try{const response=await fetch('/api/native/pairings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'interactive',connectionId:connection,selections:selected.map(agentId=>({agentId,groupIds:[groupId]})),scopes:['native:read','native:send']})});if(!response.ok)throw new Error();const result=await response.json() as {challenge:string};setChallenge(result.challenge);}catch{setError(true);}finally{setBusy(false);}}
 return <><button className="button secondary" onClick={()=>{setOpen(true);setChallenge(undefined);setSelected([]);setConnection('');setError(false);}}>Autorizar identidades para una sesión</button>
 {open&&<Modal title="Autorizar identidades para una sesión" onClose={()=>{if(!busy)setOpen(false);}}>
 <p>La sesión podrá leer y enviar en {groupName} con las identidades que elijas. Cada envío deberá indicar explícitamente su identidad. No recibe mensajes automáticamente ni confirma entregas.</p>
 {challenge?<><CopyField label="Código de asociación nativa" value={challenge}/><p>Vence en cinco minutos y solo lo puede usar la conexión elegida mediante pair_native. Hasta entonces no se concede el acceso nativo. Las conexiones OAuth existentes conservan sus permisos.</p></>:<>
 <label>Conexión de la sesión<select aria-label="Conexión de la sesión" value={connection} onChange={e=>setConnection(e.target.value)}><option value="">Elegí una conexión separada</option>{agents.flatMap(a=>a.connections.filter(c=>!c.revokedAt).map((c,index)=><option key={c.id} value={c.id}>{a.name}, cliente {index+1} ({c.id})</option>))}</select></label>
 <fieldset className="native-consent-identities"><legend>Identidades autorizadas en {groupName}</legend>{eligible.map(a=><label key={a.id}><input type="checkbox" checked={selected.includes(a.id)} onChange={e=>setSelected(e.target.checked?[...selected,a.id]:selected.filter(id=>id!==a.id))}/>{a.name}</label>)}{!eligible.length&&<p>Agregá una identidad al grupo para autorizarla.</p>}</fieldset>
 <button className="button primary" disabled={busy||!connection||!selected.length} onClick={()=>{void prepare();}}>Preparar permiso de lectura y envío</button>
 </>}
 {error&&<p role="alert">No pudimos preparar la autorización. Usá una conexión separada que no controle otro receptor.</p>}
 <button className="button secondary" disabled={busy} onClick={()=>setOpen(false)}>Cerrar autorización</button>
 </Modal>}
 </>;
}
