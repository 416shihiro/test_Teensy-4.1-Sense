/**
 * Shared parameter schema for the browser visualizer and future Max for Live.
 * ICM-20948 (9-axis) + piezo + MAX4466 mic.
 */
export const PARAM_SCHEMA_VERSION = 2;
export const PARAM_STORAGE_KEY = "human-instrument-visualizer-params-v3";

/** @typedef {{ threshold: number, ratio: number }} ParamKnob */

/** @type {Record<string, { label: string, unit: string, threshold: { min: number, max: number, step: number, default: number }, ratio: { min: number, max: number, step: number, default: number } }>} */
export const PARAM_SPEC = {
  rotX: {
    label: "Pitch",
    unit: "rad",
    threshold: { min: 0, max: 0.35, step: 0.005, default: 0.01 },
    ratio: { min: 0, max: 3, step: 0.05, default: 1 },
  },
  rotY: {
    label: "Yaw rate",
    unit: "rad/s",
    threshold: { min: 0, max: 2, step: 0.02, default: 0.03 },
    ratio: { min: 0, max: 3, step: 0.05, default: 1 },
  },
  rotZ: {
    label: "Roll",
    unit: "rad",
    threshold: { min: 0, max: 0.35, step: 0.005, default: 0.01 },
    ratio: { min: 0, max: 3, step: 0.05, default: 1 },
  },
  linX: {
    label: "Lin X",
    unit: "m/s²",
    threshold: { min: 0, max: 2, step: 0.02, default: 0.1 },
    ratio: { min: 0, max: 4, step: 0.05, default: 2 },
  },
  linY: {
    label: "Lin Y",
    unit: "m/s²",
    threshold: { min: 0, max: 2, step: 0.02, default: 0.1 },
    ratio: { min: 0, max: 4, step: 0.05, default: 2 },
  },
  linZ: {
    label: "Lin Z",
    unit: "m/s²",
    threshold: { min: 0, max: 2, step: 0.02, default: 0.1 },
    ratio: { min: 0, max: 4, step: 0.05, default: 2 },
  },
  piezo: {
    label: "Piezo",
    unit: "env",
    threshold: { min: 0, max: 1200, step: 10, default: 60 },
    ratio: { min: 0, max: 3, step: 0.05, default: 1 },
  },
  mic: {
    label: "Mic",
    unit: "env",
    threshold: { min: 0, max: 3000, step: 10, default: 80 },
    ratio: { min: 0, max: 3, step: 0.05, default: 1 },
  },
};

export const PARAM_GROUPS = [
  { label: "Gyro", ids: ["rotX", "rotY", "rotZ"] },
  { label: "Lin", ids: ["linX", "linY", "linZ"] },
  { label: "Pz", ids: ["piezo"] },
  { label: "Mc", ids: ["mic"] },
];

export const PARAM_IDS = PARAM_GROUPS.flatMap((group) => group.ids);

/** Axis colors aligned with graph / Three.js (X red, Y green, Z blue). */
export const PARAM_COLORS = {
  rotX: "#ef4444",
  rotY: "#3b82f6",
  rotZ: "#22c55e",
  linX: "#ef4444",
  linY: "#22c55e",
  linZ: "#3b82f6",
  piezo: "#22d3ee",
  mic: "#a78bfa",
};

export const PARAM_SHORT = {
  rotX: "rX",
  rotY: "rY",
  rotZ: "rZ",
  linX: "aX",
  linY: "aY",
  linZ: "aZ",
  piezo: "Pz",
  mic: "Mc",
};

export function createDefaultParams() {
  /** @type {Record<string, ParamKnob>} */
  const params = {};
  for (const id of PARAM_IDS) {
    const spec = PARAM_SPEC[id];
    params[id] = {
      threshold: spec.threshold.default,
      ratio: spec.ratio.default,
    };
  }
  return params;
}

export function loadParams() {
  try {
    const raw = localStorage.getItem(PARAM_STORAGE_KEY);
    if (!raw) {
      return createDefaultParams();
    }
    const parsed = JSON.parse(raw);
    if (parsed?.version !== PARAM_SCHEMA_VERSION || !parsed?.params) {
      return createDefaultParams();
    }
    return { ...createDefaultParams(), ...parsed.params };
  } catch {
    return createDefaultParams();
  }
}

export function saveParams(params) {
  localStorage.setItem(
    PARAM_STORAGE_KEY,
    JSON.stringify({
      version: PARAM_SCHEMA_VERSION,
      params,
    }),
  );
}

/** Signed value with threshold deadzone and ratio gain (for angles, rates, accel). */
export function applyThresholdRatio(value, threshold, ratio) {
  const magnitude = Math.abs(value);
  if (magnitude <= threshold) {
    return 0;
  }
  return Math.sign(value) * (magnitude - threshold) * ratio;
}

/** Unsigned magnitude after threshold, scaled by ratio (for piezo env etc.). */
export function applyThresholdRatioUnsigned(value, threshold, ratio) {
  if (value <= threshold) {
    return 0;
  }
  return (value - threshold) * ratio;
}

/** JSON payload for Max for Live `[dict]` / `pattrstorage` style import. */
export function serializeForMax(params) {
  return {
    version: PARAM_SCHEMA_VERSION,
    source: "human-instrument-visualizer",
    imu: "ICM-20948",
    params: PARAM_IDS.map((id) => ({
      id,
      label: PARAM_SPEC[id].label,
      unit: PARAM_SPEC[id].unit,
      color: PARAM_COLORS[id],
      threshold: params[id].threshold,
      ratio: params[id].ratio,
    })),
  };
}
