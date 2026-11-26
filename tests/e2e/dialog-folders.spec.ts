// 実main IPCのダイアログ初期値を記録し、隔離設定で再起動を跨ぐ。
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { evalMain } from './helpers/evalMain';
const projectRoot=path.resolve(import.meta.dirname,'../..');
// renderer からは読めないキーなので、隔離した設定ファイルを直接読む
async function readLastDialogFolders(root: string) {
 const config=JSON.parse(await readFile(path.join(root,'electron-store','settings','config.json'),'utf8'));
 return config.lastDialogFolders;
}
async function launch(root: string) {
 const app=await electron.launch({args:[projectRoot,`--user-data-dir=${root}`],cwd:projectRoot,
  env:{...process.env,VITE_DEV_SERVER_URL:'',MAPLAT_E2E_ROOT:root}});
 const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
 const save=await page.evaluate(()=>window.settings.get('saveFolder'));
 expect(path.resolve(save).startsWith(root+path.sep)).toBe(true);
 await evalMain(app, ({dialog})=>{
  const g=globalThis as any;g.__E2E_PICK__=null;g.__E2E_OPEN__=[];g.__E2E_SAVE__=[];
  dialog.showOpenDialog=(async (...args: any[])=>{ const options=args[args.length-1];g.__E2E_OPEN__.push(options.defaultPath);
   return g.__E2E_PICK__ ? {canceled:false,filePaths:[g.__E2E_PICK__]} : {canceled:true,filePaths:[]};}) as any;
  dialog.showSaveDialog=(async (...args: any[])=>{g.__E2E_SAVE__.push(args[args.length-1].defaultPath);
   return {canceled:true,filePath:undefined};}) as any;
 });
 return {app,page};
}
test('取り込み元を再起動後も記憶し、用途を分離し、消失と取消を扱う',async()=>{
 test.setTimeout(180000);
 const fixtureRoot=path.join(projectRoot,'.tmp-smoke');await mkdir(fixtureRoot,{recursive:true});
 const root=await mkdtemp(path.join(fixtureRoot,'dialog-folders-e2e-'));
 const source=path.join(root,'import-source');await mkdir(source);
 const zip=path.join(source,'fixture.zip');await writeFile(zip,'今回専用の不正ZIPfixture');
 let running=await launch(root);
 try {
  await evalMain(running.app, (_electron,picked)=>{(globalThis as any).__E2E_PICK__=picked;},zip);
  const invalid=await running.page.evaluate(()=>(window as any).dataupload.showDataSelectDialog());
  expect(invalid.err).toBe('Corrupt'); // 既存fx関所を通り、利用者データは取り込まない
  expect(await readLastDialogFolders(root)).toEqual({import:source});
  await quitElectronApplication(running.app);
  running=await launch(root);
  const documents=await evalMain(running.app, ({app})=>app.getPath('documents'));
  expect(await running.page.evaluate(()=>(window as any).dataupload.showDataSelectDialog())).toEqual({err:'Canceled'});
  const remembered=await evalMain(running.app, ()=> (globalThis as any).__E2E_OPEN__.at(-1));
  expect(remembered).toBe(source);
  const exported=await running.page.evaluate(()=>window.appedit.export({appID:'folder-test',appName:{ja:'記憶検査'},lang:'ja',sources:[],pois:[]}));
  expect(exported.result).toBe('Canceled');
  const save=await evalMain(running.app, ()=>(globalThis as any).__E2E_SAVE__.at(-1));
  expect(save).toBe(path.join(documents,'folder-test.zip'));
  expect(await readLastDialogFolders(root)).toEqual({import:source});
  expect(source.startsWith(root+path.sep)).toBe(true);expect(await readdir(source)).toEqual(['fixture.zip']);
  await rm(source,{recursive:true}); // 設計case 2の消失。自己生成の不正ZIP1件だけを消す。
  await running.page.evaluate(()=>(window as any).dataupload.showDataSelectDialog());
  expect(await evalMain(running.app, ()=>(globalThis as any).__E2E_OPEN__.at(-1))).toBe(documents);
  expect(await readLastDialogFolders(root)).toEqual({import:source});
 }finally{await quitElectronApplication(running.app);}
});
