// Source 生成時に MaplatCore へ渡す thumbnail を解決する単一実装（t1 設計 §7.3・§8.1 契約表 SSOT）。
//
// 背景: MaplatCore の Source mixin は options.thumbnail が falsy だと相対パス
// （`./tmbs/<mapID>.jpg`。ページ相対に解決される）を仮置きして fetch 存在確認を行う。
// file:// 配布物では dist/tmbs/ 宛の要求になり必ず失敗する（t1 設計 §7.3.1 実測）。
// 相対既定は viewer 実行形態向けの正しい契約なので MaplatCore 側は変更せず、
// エディタ側で契約（options.thumbnail を渡す）を遵守する。
//
// 契約（§8.1）:
// - 入力 fileKey はサムネイルのファイルキー（uid または slug。拡張子は含めない）
// - 出力は絶対 file:// URL または noImage バンドル URL。**null / 空文字を返さない**
//   （常に truthy。falsy を MaplatCore mixin へ渡すと既定 fetch が発火するため）
// - fileUrl の throw / null 返しもここで吸収し、呼び出し側に try/catch を書かせない単一実装
// - 戻り値を永続化しない（Source オブジェクトは保存対象外。AppEdit hydrateSourceThumbnails
//   と同様「表示/実行時専用」）
import noImage from '../assets/img/no_image.png';

export async function resolveSourceThumbnail(fileKey: string): Promise<string> {
  if (!fileKey) return noImage;
  try {
    const url = await window.appAssets.fileUrl(`tmbs/${fileKey}.jpg`);
    return url || noImage;
  } catch {
    // IPC 不在環境（preload スタブなしテスト等）でも既定 fetch を通さない
    return noImage;
  }
}
