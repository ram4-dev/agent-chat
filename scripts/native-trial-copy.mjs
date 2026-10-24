import { resolve, dirname, join } from 'node:path';
import { mkdtemp, link, rm, chmod } from 'node:fs/promises';
import process from 'node:process';
import { log } from 'node:console';
import Database from '../apps/server/node_modules/better-sqlite3/lib/index.js';
const [source,destination]=process.argv.slice(2);
if(!source||!destination||source!==source.trim()||destination!==destination.trim())throw new Error('Source and destination must not have surrounding whitespace');
const sourcePath=resolve(source);const destinationPath=resolve(destination);
if(sourcePath!==sourcePath.trim()||destinationPath!==destinationPath.trim())throw new Error('Resolved paths must not have surrounding whitespace');
if(sourcePath===destinationPath)throw new Error('Source and destination must differ');
// Backup into a private sibling directory; publish with an atomic no-replace link.
// The library never sees a user destination that it could trim or overwrite.
const temporary=await mkdtemp(join(dirname(destinationPath),'.agent-chat-backup-'));
const backupPath=join(temporary,'copy.db');
let db;
try{
  db=new Database(sourcePath,{readonly:true,fileMustExist:true});
  await db.backup(backupPath);
  await chmod(backupPath,0o600);
  await link(backupPath,destinationPath);
  log('Consistent copy created. Use only with isolated test services; source configuration is unchanged.');
}finally{
  try{db?.close();}finally{await rm(temporary,{recursive:true,force:true});}
}
