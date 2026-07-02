const runtimeKeyMap: Record<string, string> = {
  max_zoom: 'maxZoom',
  min_zoom: 'minZoom',
  envelope_lnglats: 'envelopeLngLats',
  envelopLngLats: 'envelopeLngLats',
  image_extention: 'imageExtension',
  image_extension: 'imageExtension',
  imageExtention: 'imageExtension',
  map_id: 'mapID',
  sourceID: 'mapID',
  source_id: 'mapID',
  merc_max_zoom: 'mercMaxZoom',
  merc_min_zoom: 'mercMinZoom',
  zoom_restriction: 'zoomRestriction',
  enable_cache: 'enableCache',
  default_zoom: 'defaultZoom',
  start_from: 'startFrom',
  home_position: 'homePosition',
  fake_radius: 'fakeRadius',
  fake_center: 'fakeCenter',
  fake_gps: 'fakeGps',
  app_name: 'appName',
  setting_file: 'settingFile',
  merc_zoom: 'mercZoom',
  mapbox_token: 'mapboxToken',
  translate_ui: 'translateUI',
  restore_session: 'restoreSession',
  no_rotate: 'noRotate',
  poi_template: 'poiTemplate',
  poi_style: 'poiStyle',
  icon_template: 'iconTemplate',
  default_center: 'defaultCenter',
  default_rotation: 'defaultRotation',
  selected_icon: 'selectedIcon',
  namespace_id: 'namespaceID',
  mercator_x_shift: 'mercatorXShift',
  mercator_y_shift: 'mercatorYShift',
  state_url: 'stateUrl',
  enable_share: 'enableShare',
  mobile_if: 'mobileIF',
  pwa_manifest: 'pwaManifest',
  pwa_worker: 'pwaWorker',
  pwa_scope: 'pwaScope',
  presentation_mode: 'presentationMode',
};

export function normalizeRuntimeKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => normalizeRuntimeKeys(item)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value as Record<string, any>).reduce((acc, [key, item]) => {
    const normalizedKey = runtimeKeyMap[key] || key;
    acc[normalizedKey] = normalizeRuntimeKeys(item);
    return acc;
  }, {} as Record<string, any>) as T;
}
