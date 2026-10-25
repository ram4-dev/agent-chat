import {randomUUID} from 'node:crypto';
import {expect,test} from '@playwright/test';
import {createGroup,signUp} from './helpers/ui';

test('closing a dialog preserves a newer composer focus when its deferred restoration runs',async({page})=>{
 await page.clock.install({time:new Date('2030-01-01T00:00:00Z')});
 await page.goto('/');await signUp(page,`handoff-${randomUUID()}@example.com`,'Focus owner');await createGroup(page,'Focus handoff');
 await page.getByRole('button',{name:'Invitar',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Invitar personas',exact:true});await expect(dialog).toBeVisible();
 // Hold the deferred restoration so a real user edit can happen first.
 await page.clock.pauseAt(await page.evaluate(()=>Math.ceil(Date.now()/1000)*1000+1000));
 await dialog.getByRole('button',{name:'Cerrar ventana',exact:true}).click();
 await page.clock.runFor(1);await expect(dialog).toHaveCount(0);
 const message=page.getByLabel('Mensaje',{exact:true});await message.fill('Estoy escribiendo');await expect(message).toBeFocused();
 await page.clock.runFor(32);
 await expect(message).toBeFocused();await expect(message).toHaveValue('Estoy escribiendo');
 await page.clock.resume();
});
