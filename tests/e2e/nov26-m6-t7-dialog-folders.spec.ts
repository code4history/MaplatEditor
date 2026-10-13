// nov26-m6-t7: 実main IPCのダイアログ初期値を記録し、隔離設定で再起動を跨ぐ。
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
const projectRoot=path.resolve(import.meta.dirname,'../..');
async function launch(root: string) {
 const app=await electron.launch({args:[projectRoot,`--user-data-dir=${root}`],cwd:projectRoot,
  env:{...process.env,VITE_DEV_SERVER_URL:'',MAPLAT_E2E_ROOT:root}});
 const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
 const save=await page.evaluate(()=>window.settings.get('saveFolder'));
 expect(path.resolve(save).startsWith(root+path.sep)).toBe(true);
 await app.evaluate(({dialog})=>{
  const g=globalThis as any;g.__T7_PICK__=null;g.__T7_OPEN__=[];g.__T7_SAVE__=[];
  dialog.showOpenDialog=(async (...args: any[])=>{ const options=args[args.length-1];g.__T7_OPEN__.push(options.defaultPath);
   return g.__T7_PICK__ ? {canceled:false,filePaths:[g.__T7_PICK__]} : {canceled:true,filePaths:[]};}) as any;
  dialog.showSaveDialog=(async (...args: any[])=>{g.__T7_SAVE__.push(args[args.length-1].defaultPath);
   return {canceled:true,filePath:undefined};}) as any;
 });
 return {app,page};
}
test('AC2/AC3: 取り込み元を再起動後も記憶し、用途を分離し、消失と取消を扱う',async()=>{
 test.setTimeout(180000);
 const fixtureRoot=path.join(projectRoot,'.tmp-smoke');await mkdir(fixtureRoot,{recursive:true});
 const root=await mkdtemp(path.join(fixtureRoot,'nov26-m6-t7-e2e-'));
 const source=path.join(root,'import-source');await mkdir(source);
 const zip=path.join(source,'fixture.zip');await writeFile(zip,'今回専用の不正ZIPfixture');
 let running=await launch(root);
 try {
  await running.app.evaluate((_electron,picked)=>{(globalThis as any).__T7_PICK__=picked;},zip);
  const invalid=await running.page.evaluate(()=>(window as any).dataupload.showDataSelectDialog());
  expect(invalid.err).toBe('Corrupt'); // 既存m6t3関所を通り、利用者データは取り込まない
  expect(await running.page.evaluate(()=>window.settings.get('lastDialogFolders'))).toEqual({import:source});
  await quitElectronApplication(running.app);
  running=await launch(root);
  const documents=await running.app.evaluate(({app})=>app.getPath('documents'));
  expect(await running.page.evaluate(()=>(window as any).dataupload.showDataSelectDialog())).toEqual({err:'Canceled'});
  const remembered=await running.app.evaluate(()=> (globalThis as any).__T7_OPEN__.at(-1));
  expect(remembered).toBe(source);
  const exported=await running.page.evaluate(()=>window.appedit.export({appID:'folder-test',appName:{ja:'記憶検査'},lang:'ja',sources:[],pois:[]}));
  expect(exported.result).toBe('Canceled');
  const save=await running.app.evaluate(()=>(globalThis as any).__T7_SAVE__.at(-1));
  expect(save).toBe(path.join(documents,'folder-test.zip'));
  expect(await running.page.evaluate(()=>window.settings.get('lastDialogFolders'))).toEqual({import:source});
  expect(source.startsWith(root+path.sep)).toBe(true);expect(await readdir(source)).toEqual(['fixture.zip']);
  await rm(source,{recursive:true}); // 設計AC2の消失。自己生成の不正ZIP1件だけを消す。
  await running.page.evaluate(()=>(window as any).dataupload.showDataSelectDialog());
  expect(await running.app.evaluate(()=>(globalThis as any).__T7_OPEN__.at(-1))).toBe(documents);
  expect(await running.page.evaluate(()=>window.settings.get('lastDialogFolders'))).toEqual({import:source});
 }finally{await quitElectronApplication(running.app);}
});
