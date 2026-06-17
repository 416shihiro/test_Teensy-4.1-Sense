/**
 * Shared parameter schema for the browser visualizer and future Max for Live.
 * ICM-20948 (9-axis) + piezo + MAX4466 mic.
 */
export const PARAM_SCHEMA_VERSION = 4;
export const PARAM_STORAGE_KEY = "human-instrument-visualizer-params-v4";

/** Set true when the last loadParams() restored from localStorage. */
export let paramsRestoredFromStorage = false;

/** @typedef {{ threshold: number, ratio: number }} ParamKnob */

/** @type {Record<string, { label: string, unit: string, threshold: { min: number, max: number, step: number, default: number }, ratio: { min: number, max: number, step: number, default: number } }>} */
export const PARAM_SPEC = {
  rotX: {
    label: "Pitch",
    unit: "rad/s",
    threshold: { min: 0, max: 2, step: 0.02, default: 0.03 },
    ratio: { min: 0, max: 3, step: 0.05, default: 1 },
  },
  rotY: {
    label: "Yaw",
    unit: "rad/s",
    threshold: { min: 0, max: 2, step: 0.02, default: 0.03 },
    ratio: { min: 0, max: 3, step: 0.05, default: 1 },
  },
  rotZ: {
    label: "Roll",
    unit: "rad/s",
    threshold: { min: 0, max: 2, step: 0.02, default: 0.03 },
    ratio: { min: 0, max: 3, step: 0.05, default: 1 },
  },
  linX: {
    label: "Lin tip",
    unit: "m/s²",
    threshold: { min: 0, max: 2, step: 0.02, default: 0.1 },
    ratio: { min: 0, max: 4, step: 0.05, default: 2 },
  },
  linY: {
    label: "Lin left",
    unit: "m/s²",
    threshold: { min: 0, max: 2, step: 0.02, default: 0.1 },
    ratio: { min: 0, max: 4, step: 0.05, default: 2 },
  },
  linZ: {
    label: "Lin up",
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
  gyroOnset: {
    label: "Gyro onset",
    unit: "ω|",
    threshold: { min: 0.05, max: 4, step: 0.02, default: 0.28 },
    ratio: { min: 0.05, max: 0.98, step: 0.01, default: 0.35 },
  },
  linOnset: {
    label: "Lin onset",
    unit: "|a|",
    threshold: { min: 0.1, max: 15, step: 0.1, default: 0.85 },
    ratio: { min: 0.05, max: 0.98, step: 0.01, default: 0.35 },
  },
};

export const PARAM_GROUPS = [
  { label: "Pitch·Roll·Yaw", ids: ["rotX", "rotY", "rotZ"] },
  { label: "Linear", ids: ["linX", "linY", "linZ"] },
  { label: "Onset", ids: ["gyroOnset", "linOnset"] },
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
  gyroOnset: "#fb923c",
  linOnset: "#22d3ee",
};

export const PARAM_SHORT = {
  rotX: "Pt",
  rotY: "Yw",
  rotZ: "Rl",
  linX: "lX",
  linY: "lY",
  linZ: "lZ",
  piezo: "Pz",
  mic: "Mc",
  gyroOnset: "gOn",
  linOnset: "lOn",
};

/** G01 Granulator mapping hints (Live 11 · live.object → Rack Macro, no CC). */
export const PARAM_M4L_TARGET = {
  piezo: "Gate · Vel · Macro4 Vol",
  rotZ: "Macro1 FilePos (Roll角)",
  rotX: "Macro2 Grain (回転角スキャン)",
  rotY: "Macro3 FMfreq (Yawひねりトリガ)",
  linX: "Macro5 Release",
  gyroOnset: "NoteOn トリガ (vel)",
};

export const G01_STORAGE_KEY = "human-instrument-visualizer-g01-v1";

const G01_OUTPUT_FIELD = { min: 0, max: 127, step: 1 };

/** @type {Record<string, { label: string, color: string, fields: Record<string, { short: string, label: string, min: number, max: number, step: number, default: number }> }>} */
export const G01_OUTPUT_GROUPS = {
  piezo: {
    label: "Pz → Gate · Vel · Macro4 Vol",
    color: "#22d3ee",
    fields: {
      outMin: { short: "Lo", label: "OutLo", ...G01_OUTPUT_FIELD, default: 0 },
      outMax: { short: "Hi", label: "OutHi", ...G01_OUTPUT_FIELD, default: 127 },
      gateOn: { short: "GOn", label: "Gate on", ...G01_OUTPUT_FIELD, default: 18 },
      gateOff: { short: "GOff", label: "Gate off", ...G01_OUTPUT_FIELD, default: 8 },
    },
  },
  rotZ: {
    label: "Rl → Macro1 FilePos",
    color: "#22c55e",
    fields: {
      outMin: { short: "Lo", label: "OutLo", ...G01_OUTPUT_FIELD, default: 0 },
      outMax: { short: "Hi", label: "OutHi", ...G01_OUTPUT_FIELD, default: 127 },
    },
  },
  rotX: {
    label: "Pt → Macro2 Grain (回転角スキャン)",
    color: "#ef4444",
    fields: {
      outMin: { short: "Lo", label: "OutLo", ...G01_OUTPUT_FIELD, default: 0 },
      outMax: { short: "Hi", label: "OutHi", ...G01_OUTPUT_FIELD, default: 127 },
    },
  },
  rotY: {
    label: "Yw → Macro3 FMfreq (ひねりトリガ)",
    color: "#3b82f6",
    fields: {
      outMin: { short: "Lo", label: "OutLo", ...G01_OUTPUT_FIELD, default: 0 },
      outMax: { short: "Hi", label: "OutHi", ...G01_OUTPUT_FIELD, default: 127 },
    },
  },
  linX: {
    label: "lX → Macro5 Release",
    color: "#ef4444",
    fields: {
      outMin: { short: "Lo", label: "OutLo", ...G01_OUTPUT_FIELD, default: 0 },
      outMax: { short: "Hi", label: "OutHi", ...G01_OUTPUT_FIELD, default: 127 },
    },
  },
};

export const G01_OUTPUT_IDS = Object.keys(G01_OUTPUT_GROUPS);

export function createDefaultG01Params() {
  /** @type {Record<string, Record<string, number>>} */
  const g01 = {};
  for (const id of G01_OUTPUT_IDS) {
    g01[id] = {};
    for (const [key, field] of Object.entries(G01_OUTPUT_GROUPS[id].fields)) {
      g01[id][key] = field.default;
    }
  }
  return g01;
}

function mergeSavedG01(saved) {
  const g01 = createDefaultG01Params();
  if (!saved || typeof saved !== "object") {
    return g01;
  }
  for (const id of G01_OUTPUT_IDS) {
    const slot = saved[id];
    if (!slot || typeof slot !== "object") {
      continue;
    }
    for (const [key, field] of Object.entries(G01_OUTPUT_GROUPS[id].fields)) {
      const value = slot[key];
      if (Number.isFinite(value)) {
        g01[id][key] = Math.min(Math.max(value, field.min), field.max);
      }
    }
  }
  return g01;
}

export function loadG01Params() {
  try {
    const raw = localStorage.getItem(G01_STORAGE_KEY);
    if (!raw) {
      return createDefaultG01Params();
    }
    return mergeSavedG01(JSON.parse(raw));
  } catch {
    return createDefaultG01Params();
  }
}

export function saveG01Params(g01) {
  localStorage.setItem(G01_STORAGE_KEY, JSON.stringify(g01));
}

/** Match hi_g01_ctrl.js piezoTo01 — preview Volume / Velocity range in viz HUD. */
export function g01PiezoTo01(value127, piezoCfg) {
  const t = Math.min(Math.max(value127, 0), 127) / 127;
  const lo = (piezoCfg?.outMin ?? 0) / 127;
  const hi = (piezoCfg?.outMax ?? 127) / 127;
  return lo + t * (hi - lo);
}

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

function clampParamField(id, key, value) {
  const spec = PARAM_SPEC[id]?.[key];
  if (!spec || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(Math.max(value, spec.min), spec.max);
}

function mergeSavedParams(saved) {
  const params = createDefaultParams();
  if (!saved || typeof saved !== "object") {
    return params;
  }
  for (const id of PARAM_IDS) {
    const slot = saved[id];
    if (!slot || typeof slot !== "object") {
      continue;
    }
    const threshold = clampParamField(id, "threshold", slot.threshold);
    const ratio = clampParamField(id, "ratio", slot.ratio);
    if (threshold != null) {
      params[id].threshold = threshold;
    }
    if (ratio != null) {
      params[id].ratio = ratio;
    }
  }
  return params;
}

export function loadParams() {
  paramsRestoredFromStorage = false;
  try {
    const raw = localStorage.getItem(PARAM_STORAGE_KEY);
    if (!raw) {
      return createDefaultParams();
    }
    const parsed = JSON.parse(raw);
    if (parsed?.version !== PARAM_SCHEMA_VERSION || !parsed?.params) {
      return createDefaultParams();
    }
    paramsRestoredFromStorage = true;
    return mergeSavedParams(parsed.params);
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
export function serializeForMax(params, g01 = createDefaultG01Params()) {
  return {
    version: PARAM_SCHEMA_VERSION,
    source: "human-instrument-visualizer",
    imu: "MPU6050",
    params: PARAM_IDS.map((id) => ({
      id,
      label: PARAM_SPEC[id].label,
      unit: PARAM_SPEC[id].unit,
      color: PARAM_COLORS[id],
      m4lTarget: PARAM_M4L_TARGET[id] ?? null,
      threshold: params[id].threshold,
      ratio: params[id].ratio,
    })),
    g01,
  };
}

/** Whole-screen color grading (CSS filter on viewport). */
export const DISPLAY_PARAM_SCHEMA_VERSION = 1;
export const DISPLAY_STORAGE_KEY = "human-instrument-visualizer-display-v1";

export let displayRestoredFromStorage = false;

export const UI_STORAGE_KEY = "human-instrument-visualizer-ui-v1";
export const UI_SCHEMA_VERSION = 2;
export const MOTION_MODE_DIRECT = "direct";
export const MOTION_MODE_TILT = "tilt";

/** @type {Record<string, { label: string, short: string, unit: string, min: number, max: number, step: number, default: number }>} */
export const DISPLAY_PARAM_SPEC = {
  hue: {
    label: "Hue",
    short: "1",
    unit: "°",
    min: 0,
    max: 360,
    step: 1,
    default: 0,
  },
  hueRot: {
    label: "Hue rotation",
    short: "2",
    unit: "°",
    min: 0,
    max: 360,
    step: 1,
    default: 0,
  },
  saturation: {
    label: "Saturation",
    short: "3",
    unit: "%",
    min: 0,
    max: 2,
    step: 0.01,
    default: 1,
  },
  brightness: {
    label: "Brightness",
    short: "4",
    unit: "%",
    min: 0,
    max: 2,
    step: 0.01,
    default: 1,
  },
  contrast: {
    label: "Contrast",
    short: "5",
    unit: "%",
    min: 0,
    max: 2,
    step: 0.01,
    default: 1,
  },
};

export const DISPLAY_PARAM_IDS = ["hue", "hueRot", "saturation", "brightness", "contrast"];

export const DISPLAY_PARAM_COLORS = {
  hue: "#f472b6",
  hueRot: "#e879f9",
  saturation: "#a3e635",
  brightness: "#fbbf24",
  contrast: "#38bdf8",
};

export function createDefaultDisplayParams() {
  /** @type {Record<string, number>} */
  const display = {};
  for (const id of DISPLAY_PARAM_IDS) {
    display[id] = DISPLAY_PARAM_SPEC[id].default;
  }
  return display;
}

export function loadDisplayParams() {
  displayRestoredFromStorage = false;
  try {
    const raw = localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (!raw) {
      return createDefaultDisplayParams();
    }
    const parsed = JSON.parse(raw);
    if (parsed?.version !== DISPLAY_PARAM_SCHEMA_VERSION || !parsed?.display) {
      return createDefaultDisplayParams();
    }
    displayRestoredFromStorage = true;
    const display = createDefaultDisplayParams();
    for (const id of DISPLAY_PARAM_IDS) {
      const value = parsed.display[id];
      const spec = DISPLAY_PARAM_SPEC[id];
      if (Number.isFinite(value) && spec) {
        display[id] = Math.min(Math.max(value, spec.min), spec.max);
      }
    }
    return display;
  } catch {
    return createDefaultDisplayParams();
  }
}

export function saveDisplayParams(display) {
  localStorage.setItem(
    DISPLAY_STORAGE_KEY,
    JSON.stringify({
      version: DISPLAY_PARAM_SCHEMA_VERSION,
      display,
    }),
  );
}

/** @typedef {{ deviceProfile: string, motionMode: string }} UiPrefs */

export function createDefaultUiPrefs() {
  return { deviceProfile: "teensy", motionMode: MOTION_MODE_DIRECT };
}

export function loadUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) {
      return createDefaultUiPrefs();
    }
    const parsed = JSON.parse(raw);
    if (parsed?.version !== UI_SCHEMA_VERSION || !parsed?.ui) {
      return createDefaultUiPrefs();
    }
    const defaults = createDefaultUiPrefs();
    if (typeof parsed.ui.deviceProfile === "string" && parsed.ui.deviceProfile) {
      defaults.deviceProfile = parsed.ui.deviceProfile;
    }
    if (
      parsed.ui.motionMode === MOTION_MODE_DIRECT ||
      parsed.ui.motionMode === MOTION_MODE_TILT
    ) {
      defaults.motionMode = parsed.ui.motionMode;
    }
    return defaults;
  } catch {
    return createDefaultUiPrefs();
  }
}

export function saveUiPrefs(ui) {
  localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({
      version: UI_SCHEMA_VERSION,
      ui,
    }),
  );
}

export function persistSessionState(params, display, ui, g01) {
  saveParams(params);
  saveDisplayParams(display);
  saveUiPrefs(ui);
  if (g01) {
    saveG01Params(g01);
  }
}
