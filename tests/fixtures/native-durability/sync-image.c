/* Test-only VFS: forward real SQLite I/O; save a disk image only after successful xSync.
 * Recovery discards writes absent from these images, modeling loss of volatile storage.
 * Loaded in a dedicated subprocess, never in the test worker or production server. */
#include "sqlite3ext.h"
SQLITE_EXTENSION_INIT1
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { sqlite3_file file; sqlite3_file *real; int tracked; } SyncFile;
static sqlite3_vfs shim;
static sqlite3_vfs *underlying;
static int syncCount=0;
static void observedCount(sqlite3_context *context,int argc,sqlite3_value **argv) { (void)argc; (void)argv; sqlite3_result_int(context,syncCount); }
static int image(sqlite3_file *p) {
  SyncFile *f = (SyncFile *)p;
  if (!f->tracked) return SQLITE_OK;
  syncCount++;
  const char *destination = getenv(f->tracked == 1 ? "TEST_SYNC_DB_IMAGE" : "TEST_SYNC_WAL_IMAGE");
  if (!destination) return SQLITE_IOERR;
  sqlite3_int64 size = 0;
  int rc = f->real->pMethods->xFileSize(f->real, &size);
  if (rc != SQLITE_OK) return rc;
  FILE *out = fopen(destination, "wb");
  if (!out) return SQLITE_IOERR;
  unsigned char buffer[4096];
  for (sqlite3_int64 offset = 0; offset < size; ) {
    int count = (int)((size - offset) < 4096 ? (size - offset) : 4096);
    rc = f->real->pMethods->xRead(f->real, buffer, count, offset);
    if (rc != SQLITE_OK || fwrite(buffer, 1, count, out) != (size_t)count) { fclose(out); return SQLITE_IOERR; }
    offset += count;
  }
  if (fclose(out)) return SQLITE_IOERR;
  return SQLITE_OK;
}
static int closeFile(sqlite3_file *p) { SyncFile *f=(SyncFile *)p; int rc=f->real->pMethods->xClose(f->real); sqlite3_free(f->real); p->pMethods=0; return rc; }
static int readFile(sqlite3_file *p,void *b,int n,sqlite3_int64 o) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xRead(f->real,b,n,o); }
static int writeFile(sqlite3_file *p,const void *b,int n,sqlite3_int64 o) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xWrite(f->real,b,n,o); }
static int truncateFile(sqlite3_file *p,sqlite3_int64 n) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xTruncate(f->real,n); }
static int syncFile(sqlite3_file *p,int flags) { SyncFile *f=(SyncFile *)p; int rc=f->real->pMethods->xSync(f->real,flags); return rc==SQLITE_OK ? image(p) : rc; }
static int sizeFile(sqlite3_file *p,sqlite3_int64 *n) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xFileSize(f->real,n); }
static int lockFile(sqlite3_file *p,int n) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xLock(f->real,n); }
static int unlockFile(sqlite3_file *p,int n) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xUnlock(f->real,n); }
static int reservedFile(sqlite3_file *p,int *n) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xCheckReservedLock(f->real,n); }
static int controlFile(sqlite3_file *p,int n,void *v) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xFileControl(f->real,n,v); }
static int sectorFile(sqlite3_file *p) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xSectorSize(f->real); }
static int deviceFile(sqlite3_file *p) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xDeviceCharacteristics(f->real); }
static int shmMap(sqlite3_file *p,int a,int b,int c,void volatile **v) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xShmMap(f->real,a,b,c,v); }
static int shmLock(sqlite3_file *p,int a,int b,int c) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xShmLock(f->real,a,b,c); }
static void shmBarrier(sqlite3_file *p) { SyncFile *f=(SyncFile *)p; f->real->pMethods->xShmBarrier(f->real); }
static int shmUnmap(sqlite3_file *p,int a) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->xShmUnmap(f->real,a); }
static int fetchFile(sqlite3_file *p,sqlite3_int64 o,int n,void **v) { SyncFile *f=(SyncFile *)p; if(f->real->pMethods->iVersion<3 || !f->real->pMethods->xFetch) { *v=0; return SQLITE_OK; } return f->real->pMethods->xFetch(f->real,o,n,v); }
static int unfetchFile(sqlite3_file *p,sqlite3_int64 o,void *v) { SyncFile *f=(SyncFile *)p; return f->real->pMethods->iVersion>=3 && f->real->pMethods->xUnfetch ? f->real->pMethods->xUnfetch(f->real,o,v) : SQLITE_OK; }
static const sqlite3_io_methods methods={3,closeFile,readFile,writeFile,truncateFile,syncFile,sizeFile,lockFile,unlockFile,reservedFile,controlFile,sectorFile,deviceFile,shmMap,shmLock,shmBarrier,shmUnmap,fetchFile,unfetchFile};
static int openFile(sqlite3_vfs *v,const char *name,sqlite3_file *p,int flags,int *outFlags) {
  (void)v;
  SyncFile *f=(SyncFile *)p; memset(f,0,sizeof(*f));
  f->real=sqlite3_malloc(underlying->szOsFile); if(!f->real) return SQLITE_NOMEM;
  memset(f->real,0,underlying->szOsFile);
  int rc=underlying->xOpen(underlying,name,f->real,flags,outFlags);
  if(rc!=SQLITE_OK) { sqlite3_free(f->real); return rc; }
  const char *target=getenv("TEST_SYNC_TARGET");
  if(name && target) {
    size_t n=strlen(target);
    if(strcmp(name,target)==0) f->tracked=1;
    else if(strncmp(name,target,n)==0 && strcmp(name+n,"-wal")==0) f->tracked=2;
  }
  f->file.pMethods=&methods; return SQLITE_OK;
}
#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_syncimage_init(sqlite3 *db,char **error,const sqlite3_api_routines *api) {
  (void)db; (void)error; SQLITE_EXTENSION_INIT2(api);
  underlying=sqlite3_vfs_find(0); if(!underlying) return SQLITE_ERROR;
  shim=*underlying; shim.zName="native-sync-image"; shim.pNext=0; shim.szOsFile=sizeof(SyncFile); shim.xOpen=openFile;
  int rc=sqlite3_create_function(db,"sync_image_count",0,SQLITE_UTF8,0,observedCount,0,0);
  return rc==SQLITE_OK ? sqlite3_vfs_register(&shim,1) : rc;
}
