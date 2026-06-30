import { randomUUID } from 'node:crypto';

const MAX_FEATURE_COUNT = 5000;

export function validatePointCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length !== 2) return false;
  const [lon, lat] = coords;
  if (typeof lon !== 'number' || typeof lat !== 'number') return false;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (lon < -180 || lon > 180) return false;
  if (lat < -90 || lat > 90) return false;
  return true;
}

export function validateFeatureCollection(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, errorCode: 'not_feature_collection', message: 'Root is not an object' };
  }
  if (data.type !== 'FeatureCollection') {
    return { valid: false, errorCode: 'not_feature_collection', message: 'Root type is not FeatureCollection' };
  }
  if (!Array.isArray(data.features)) {
    return { valid: false, errorCode: 'not_feature_collection', message: 'features is not an array' };
  }
  const features = data.features;
  if (features.length > MAX_FEATURE_COUNT) {
    return { valid: false, errorCode: 'payload_too_large', message: `Feature count ${features.length} exceeds limit ${MAX_FEATURE_COUNT}` };
  }

  const idSet = new Set();
  const normalized = [];

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (!f || typeof f !== 'object' || f.type !== 'Feature') {
      return { valid: false, errorCode: 'not_feature_collection', message: `Feature at index ${i} is not a Feature` };
    }
    if (!f.geometry || f.geometry.type !== 'Point') {
      return { valid: false, errorCode: 'unsupported_geometry', message: `Feature at index ${i} geometry is not Point` };
    }
    if (!validatePointCoordinates(f.geometry.coordinates)) {
      return { valid: false, errorCode: 'unsupported_geometry', message: `Feature at index ${i} has invalid coordinates` };
    }
    const props = f.properties && typeof f.properties === 'object' ? f.properties : {};
    if (!props.name || typeof props.name !== 'string' || !props.name.trim()) {
      return { valid: false, errorCode: 'missing_name', message: `Feature at index ${i} is missing name` };
    }

    let featureId;
    if (f.id != null) {
      featureId = String(f.id);
    } else if (props.id != null && (typeof props.id === 'string' || typeof props.id === 'number')) {
      featureId = String(props.id);
    } else {
      featureId = randomUUID();
    }

    if (idSet.has(featureId)) {
      return { valid: false, errorCode: 'duplicate_feature_id', message: `Duplicate Feature.id: ${featureId}` };
    }
    idSet.add(featureId);

    normalized.push({
      ...f,
      id: featureId,
      properties: { ...props },
    });
  }

  return { valid: true, features: normalized };
}
