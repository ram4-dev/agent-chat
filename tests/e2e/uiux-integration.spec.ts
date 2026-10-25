import {randomUUID} from 'node:crypto';
import {test,expect} from '@playwright/test';
import {agents,createGroup,selectGroup,signUp} from './helpers/ui';

test('confirmed logout purges a draft for the same account, but failed logout preserves it',async({page})=>{
 const email=`draft-logout-${randomUUID()}@example.com`;
 await page.goto('/');await signUp(page,email,'Borrador privado');
 await createGroup(page,'Grupo de borrador');
 const input=page.getByLabel('Mensaje',{exact:true});await input.fill('Borrador privado antes del logout');
 await agents(page);
 await page.route('**/api/auth/logout',route=>route.fulfill({status:503,json:{error:{code:'temporarily_unavailable'}}}),{times:1});
 await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
 await expect(page.getByText('No pudimos cerrar tu sesión. Intentá de nuevo.',{exact:true})).toBeVisible();
 await selectGroup(page,'Grupo de borrador');await expect(input).toHaveValue('Borrador privado antes del logout');
 await agents(page);await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
 await page.getByRole('tab',{name:'Ingresar',exact:true}).click();
 await page.getByLabel('Correo electrónico').fill(email);await page.getByLabel('Contraseña',{exact:true}).fill('a-sufficiently-long-password');
 await page.getByRole('button',{name:'Ingresar',exact:true}).click();
 await expect(page.getByRole('main')).toHaveClass(/workspace/);
 await selectGroup(page,'Grupo de borrador');await expect(input).toHaveValue('');
});

for(const trigger of ['send','detail','socket'] as const) test(`expired session via ${trigger} purges every group draft before same-account login`,async({page})=>{
 const email=`draft-expired-${trigger}-${randomUUID()}@example.com`;
 let closeSocket: (()=>void)|undefined;
 if(trigger==='socket')await page.routeWebSocket('**/ws/browser',socket=>{
  socket.connectToServer();
  closeSocket=()=>socket.close({code:4401,reason:'unauthenticated'});
 });
 await page.goto('/');await signUp(page,email,'Sesión vencida');
 await createGroup(page,'Primero privado');
 const input=page.getByLabel('Mensaje',{exact:true});await input.fill('Secreto del primer grupo');
 const second=await createGroup(page,'Segundo privado');await input.fill('Secreto del segundo grupo');
 const logout=await page.request.post('/api/auth/logout',{headers:{origin:new URL(page.url()).origin}});expect(logout.status()).toBe(200);
 if(trigger==='send'){
  const rejected=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/groups/${second}/messages`);
  await page.getByRole('button',{name:'Enviar mensaje',exact:true}).click();expect((await rejected).status()).toBe(401);
 }else if(trigger==='detail'){
  const rejected=page.waitForResponse(response=>response.request().method()==='GET'&&/\/api\/groups\/[^/]+$/u.test(new URL(response.url()).pathname));
  await page.getByRole('button',{name:'Primero privado',exact:true}).click();expect((await rejected).status()).toBe(401);
 }else{
  expect(closeSocket).toBeDefined();closeSocket!();
 }
 await expect(page.getByRole('main')).not.toHaveClass(/workspace/);
 await page.getByRole('tab',{name:'Ingresar',exact:true}).click();
 await page.getByLabel('Correo electrónico').fill(email);await page.getByLabel('Contraseña',{exact:true}).fill('a-sufficiently-long-password');
 await page.getByRole('button',{name:'Ingresar',exact:true}).click();await expect(page.getByRole('main')).toHaveClass(/workspace/);
 for(const name of ['Primero privado','Segundo privado']){await selectGroup(page,name);await expect(input).toHaveValue('');}
});
