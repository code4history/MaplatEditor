// nov26-m7-t7（#138）: app:// のローカル配信の封じ込めを realpath（実体）で判定する変更の E2E。
//
// 背景: 従来は path.resolve の字面の前方一致（resolveAppUrl の isUnderRoot）で判定していたため、許可ルートの**中**に
// 置かれた symlink が外を指していても、その先を renderer（同一 origin）へ配信していた。以後は許可ルートと候補の
// 両方を realpath した実体で判定する。本 spec は**実起動の handler**を通して次を確かめる:
//   1. renderer（app://bundle）の fetch から: 外を指すリンク越し → 403・中を指すリンク越し → 200（image/png）・
//      リンクの無い通常のタイル → 200
//   2. renderer の `<img crossOrigin="anonymous">`（MaplatCore のタイル読込と同じ条件）で外を指すリンク越しの PNG は
//      error（描けない）。対照として同じ PNG をリンク無しの URL で読むと読める（画像自体は壊れていない）
//
// URL は spec 内で組み立てる（electron/utils/appScheme.ts を import すると、変更前の版で「変更前の URL 形」を
// 測ってしまう。oct26-m4-t2ff-app-local-cors.spec.ts の sameOriginLocalUrl に倣う）。
// ハーネス（launch・終了処理）も同 spec と m12-t20 の様式に従う。
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// エンコード規約は appScheme.ts と同じ（セグメント単位 encodeURIComponent・先頭 '/' 保証。本 spec は POSIX のパスだけを扱う）
const encodePath = (abs: string): string => abs.split('/').map((s) => encodeURIComponent(s)).join('/');
const sameOriginLocalUrl = (abs: string): string => `app://bundle/__local${encodePath(abs)}`;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('app:// のローカル配信は symlink の先が許可ルートの外なら 403・中なら 200（#138）', async () => {
  const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'nov26-m7-t7-e2e-'));
  const startedAt = Date.now();
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // 1. 保存フォルダを読み、外を指すリンク・中を指すリンク・リンクの無いタイルを置く
    const saveFolder: string = await page.evaluate(() => window.settings.get('saveFolder'));
    const outDir = path.join(e2eRoot, 'outside-of-roots');
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'secret.png'), PNG);
    const linkOut = path.join(saveFolder, 'nov26-m7-t7-out');
    await symlink(outDir, linkOut);

    const tileDir = path.join(saveFolder, 'tiles', 'nov26-m7-t7', '0', '0');
    await mkdir(tileDir, { recursive: true });
    await writeFile(path.join(tileDir, '0.png'), PNG);
    const linkIn = path.join(saveFolder, 'nov26-m7-t7-in');
    await symlink(tileDir, linkIn);

    const urls = {
      outside: sameOriginLocalUrl(path.join(linkOut, 'secret.png')),
      inside: sameOriginLocalUrl(path.join(linkIn, '0.png')),
      plain: sameOriginLocalUrl(path.join(tileDir, '0.png')),
    };

    // 2. renderer から fetch して status を読む
    const fetched = await page.evaluate(async (targets) => {
      const one = async (u: string) => {
        try {
          const r = await fetch(u);
          return { status: r.status, contentType: r.headers.get('content-type') };
        } catch (e) {
          return { status: String(e), contentType: null };
        }
      };
      return { outside: await one(targets.outside), inside: await one(targets.inside), plain: await one(targets.plain) };
    }, urls);
    console.log('[nov26-m7-t7] fetch from renderer', JSON.stringify(fetched));
    expect(fetched.outside.status, '外を指すリンク越しの PNG は 403').toBe(403);
    expect(fetched.inside.status, '中を指すリンク越しの PNG は 200').toBe(200);
    expect(fetched.inside.contentType, '中を指すリンク越しは要求側の拡張子で image/png').toBe('image/png');
    expect(fetched.plain.status, 'リンクの無い通常のタイルは 200').toBe(200);
    expect(fetched.plain.contentType).toBe('image/png');

    // 3. MaplatCore と同じ条件（crossOrigin="anonymous"）の <img> で読めるか
    const images = await page.evaluate(async (targets) => {
      const load = (u: string) =>
        new Promise<string>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          const timer = setTimeout(() => resolve('timeout'), 8000);
          img.onload = () => {
            clearTimeout(timer);
            resolve(img.naturalWidth > 0 ? 'load' : 'load-empty');
          };
          img.onerror = () => {
            clearTimeout(timer);
            resolve('error');
          };
          img.src = u;
        });
      return { outside: await load(targets.outside), plain: await load(targets.plain) };
    }, urls);
    console.log('[nov26-m7-t7] crossOrigin <img>', JSON.stringify(images));
    expect(images.outside, '外を指すリンク越しの PNG は <img> で描けない').toBe('error');
    expect(images.plain, '対照: リンク無しの同じ PNG は描ける（画像自体は壊れていない）').toBe('load');

    // 所要時間（設計 §14 のリスク表: 前後で目立って遅くなっていないかを記録する）
    console.log(`[nov26-m7-t7] elapsed ${Date.now() - startedAt}ms`);
  } finally {
    await quitElectronApplication(app);
  }
});
