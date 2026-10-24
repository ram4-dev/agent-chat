import { resolve } from 'node:path';
import { open } from 'node:fs/promises';
import process from 'node:process';
import { log } from 'node:console';
import Database from '../apps/server/node_modules/better-sqlite3/lib/index.js';
const [source,destination]=process.argv.slice(2);
if(!source||!destination||resolve(source)===resolve(destination))throw new Error('Usage: native-trial-copy SOURCE_DB NEW_COPY_DB');
// Exclusive reservation prevents overwriting any existing user database.
const reserved=await open(destination,'wx',0o600);await reserved.close();
const db=new Database(source,{readonly:true,fileMustExist:true});
try{await db.backup(destination);log('Consistent copy created. Use only with isolated test services; source configuration is unchanged.');}
finally{db.close();}
