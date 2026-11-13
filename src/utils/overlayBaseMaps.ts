// 地図の上の「表示の切り替え」に使う常時表示のベースマップ（POI の編集・ホーム位置と範囲の小窓）。
// MapEdit の setupBaseMaps は地図ごとの可視設定・シフト・Google 源を持つため別実装のまま。
import { Tile as TileLayer, Group } from 'ol/layer';
// @ts-ignore
import { mapSourceFactory } from '@maplat/core/src/source_ex';
import { resolveSourceThumbnail } from './sourceThumbnail';
import { resolveBaseMapLayerMetadata, toBaseMapLayerData } from './baseMapEditorDocument';
import { escapeHtmlText, textAttributions } from './mapOverlayTools';

export interface OverlayBaseMapItem {
  mapID: string;
  /** 札に出す名前（言語解決済み） */
  label: string;
}

export interface OverlayBaseMaps {
  /** 札に出す候補（表示順） */
  items: OverlayBaseMapItem[];
  /** 地図に載せるベースマップのグループ */
  group: Group;
}

const FALLBACK_LIST = [
  { mapID: 'osm', title: 'OpenStreetMap', maxZoom: 18 },
  { mapID: 'gsi', title: 'GSI Maps', maxZoom: 18 },
  { mapID: 'gsi_ortho', title: 'GSI Ortho', maxZoom: 18 },
];

/**
 * 常時表示のベースマップからレイヤのグループを作る。
 * `visibleId` のレイヤだけを表示する（無いときは先頭）。
 */
export async function createOverlayBaseMaps(
  lang: string,
  visibleId: string,
  groupTitle: string,
): Promise<OverlayBaseMaps> {
  let list: Record<string, any>[] = [];
  try {
    const raw = await window.baseMaps.list();
    list = raw.filter((item: any) => item.alwaysVisible).map(toBaseMapLayerData);
  } catch (e) {
    console.error('[overlayBaseMaps] Failed to list base maps:', e);
  }
  if (list.length === 0) list = FALLBACK_LIST.map((entry) => ({ ...entry }));

  const items: OverlayBaseMapItem[] = list.map((tms) => {
    const meta = resolveBaseMapLayerMetadata(tms, lang);
    return { mapID: String(tms.mapID), label: meta.title || String(tms.mapID) };
  });

  const layers = await Promise.all(
    [...list].reverse().map(async (tms) => {
      let source: any;
      try {
        if (['osm', 'gsi', 'gsi_ortho'].includes(tms.mapID)) {
          source = await mapSourceFactory(tms.mapID, {});
        } else {
          source = await mapSourceFactory(
            {
              mapID: tms.mapID || 'custom',
              // m22-t1: merc は url が空で保存される。実行時専用の url_ があればそれを使う
              // （空だと MaplatCore が tiles/{mapID}/…jpg を誤補完して 404 になる）
              url: tms.url_ || tms.url,
              attr: tms.attr,
              maptype: 'base',
              maxZoom: tms.maxZoom || 18,
              minZoom: tms.minZoom || 0,
              // t1 HR-3: thumbnail 未指定だと mixin の相対仮置き fetch が発火するため注入。
              // osm/gsi/gsi_ortho 経由（上の分岐）は source_ex 側で thumbnail 同梱のため不要
              thumbnail: await resolveSourceThumbnail(tms.mapID),
            },
            {},
          );
        }
      } catch (e) {
        console.error(`[overlayBaseMaps] Failed to create source for ${tms.mapID}:`, e);
        return null;
      }
      if (!source) return null;
      const meta = resolveBaseMapLayerMetadata(tms, lang);
      // §5-8: 帰属をソースに載せないと OL の帰属表示が消えるため、ここで写す。
      // 帰属表示とレイヤ名（title）はどちらも innerHTML で描かれるので escape して渡す
      source.setAttributions?.(textAttributions(meta.attr));
      return new TileLayer({
        source,
        properties: { title: escapeHtmlText(meta.title || String(tms.mapID)), mapID: tms.mapID, type: 'base' },
        visible: tms.mapID === visibleId,
      });
    }),
  );

  const validLayers = layers.filter((layer): layer is TileLayer => layer !== null);
  if (visibleId && !validLayers.some((layer) => layer.get('mapID') === visibleId)) {
    validLayers[validLayers.length - 1]?.setVisible(true);
  }

  return {
    items,
    group: new Group({
      properties: { title: escapeHtmlText(groupTitle) },
      layers: validLayers,
    }),
  };
}
