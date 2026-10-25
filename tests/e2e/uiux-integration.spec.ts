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
