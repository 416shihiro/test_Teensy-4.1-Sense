import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import {
  PARAM_COLORS,
  PARAM_GROUPS,
  PARAM_IDS,
  PARAM_SHORT,
  PARAM_SPEC,
  applyThresholdRatio,
  applyThresholdRatioUnsigned,
  createDefaultParams,
  loadParams,
  saveParams,
  serializeForMax,
} from "./params.js";
import { createSerialFrameParser } from "./camera.js";
import { createMotionState, processM4lMotion } from "./motion_core.js";

const GRAPH_SIZE = 240;
const PIEZO_REFERENCE_MAX = 2400;
const MIC_REFERENCE_MAX = 3000;
const PITCH_ROLL_REFERENCE = 1.2;
const YAW_RATE_REFERENCE = 0.35;
const LINEAR_REFERENCE = 2.2;
const GRAVITY_MS2 = 9.81;
const STILL_GYRO_RAD = 0.1;
const GRAVITY_LP_ALPHA = 0.07;
const LINEAR_FULL_SCALE = 2.2;
const LINEAR_RESPONSE_POWER = 1.25;
const LINEAR_EDGE_GAIN = 2.2;
const LINEAR_SMOOTH_ALPHA = 0.58;
const ROTATION_ATTENUATION_START = 0.04;
const ROTATION_ATTENUATION_RANGE = 0.22;
const BOX_MIN_HALF = 0.38;
const CUBE_EDGE_LINE_WIDTH = 2;
const BOX_EDGE_SCALE_LARGE = 3;
const BOX_MAX_EXTRA_HALF = BOX_MIN_HALF * 2 * (BOX_EDGE_SCALE_LARGE - 1);

// Teensy firmware outputs bow frame (ICM-20948 mount, calibrated 2026-06-17b).
// +X tip/roll, +Y left/pitch, +Z up. Graphs: red=X green=Y blue=Z.
function sensorToBoardSample(sample) {
  const ax = sample.ax;
  const ay = sample.ay;
  const az = sample.az;
  const gx = sample.gx;
  const gy = sample.gy;
  const gz = sample.gz;
  const mx = sample.mx ?? 0;
  const my = sample.my ?? 0;
  const mz = sample.mz ?? 0;
  return {
    ...sample,
    ax,
    ay,
    az,
    gx,
    gy,
    gz,
    mx,
    my,
    mz,
    magMag: sample.magMag ?? Math.hypot(mx, my, mz),
    headingDeg: sample.headingDeg ?? 0,
    accelMag: Math.hypot(ax, ay, az),
    gyroMag: Math.hypot(gx, gy, gz),
  };
}

const BRIDGE_STREAM_URL = `${location.protocol}//${location.hostname}:8765/stream`;

const DEVICE_PROFILES = {
  teensy: {
    id: "teensy",
    label: "Teensy 4.1",
    short: "Teensy",
    baud: 115200,
    usbVendorId: 0x16c0,
  },
  xiao: {
    id: "xiao",
    label: "XIAO ESP32 S3",
    short: "XIAO",
    baud: 921600,
    usbVendorId: 0x303a,
  },
};

const ui = {
  connectButton: document.querySelector("#connectButton"),
  bridgeButton: document.querySelector("#bridgeButton"),
  disconnectButton: document.querySelector("#disconnectButton"),
  demoButton: document.querySelector("#demoButton"),
  deviceProfileSelect: document.querySelector("#deviceProfileSelect"),
  deviceStatus: document.querySelector("#deviceStatus"),
  serialStatus: document.querySelector("#serialStatus"),
  browserStatus: document.querySelector("#browserStatus"),
  lastLineType: document.querySelector("#lastLineType"),
  rawLine: document.querySelector("#rawLine"),
  motionCanvas: document.querySelector("#motionCanvas"),
  gyroCanvas: document.querySelector("#gyroCanvas"),
  magCanvas: document.querySelector("#magCanvas"),
  magnitudeCanvas: document.querySelector("#magnitudeCanvas"),
  orientationHud: document.querySelector("#orientationHud"),
  piezoCanvas: document.querySelector("#piezoCanvas"),
  micCanvas: document.querySelector("#micCanvas"),
};

function getSelectedDeviceProfile() {
  const id = ui.deviceProfileSelect?.value ?? "teensy";
  return DEVICE_PROFILES[id] ?? DEVICE_PROFILES.teensy;
}

function renderDeviceStatus(deviceId, detail = "") {
  if (!ui.deviceStatus) {
    return;
  }
  const profile = DEVICE_PROFILES[deviceId];
  if (!profile) {
    ui.deviceStatus.textContent = detail || "—";
    return;
  }
  ui.deviceStatus.innerHTML = `<span class="device-tag ${deviceId}">${profile.short}</span>${detail ? `<span>${detail}</span>` : ""}`;
}

function setLinkStatus({ deviceId = null, mode = "none", detail = "", tone = "normal" } = {}) {
  if (deviceId) {
    renderDeviceStatus(deviceId, detail);
  } else if (ui.deviceStatus) {
    ui.deviceStatus.textContent = "—";
  }

  const modeLabels = {
    bridge: "Bridge (hub)",
    serial: "Serial direct",
    demo: "Demo",
    none: "Disconnected",
  };
  const text = mode === "none" ? modeLabels.none : `${modeLabels[mode] ?? mode}${detail ? ` · ${detail}` : ""}`;
  ui.serialStatus.textContent = text;
  ui.serialStatus.style.color =
    tone === "ok" ? "#34d399" : tone === "error" ? "#f87171" : "#ecf4ff";
}

const state = {
  port: null,
  reader: null,
  bridgeSource: null,
  keepReading: false,
  demoEnabled: false,
  lastLine: "",
  lineType: "none",
  sample: {
    ms: 0,
    ax: 0,
    ay: 0,
    az: 0,
    gx: 0,
    gy: 0,
    gz: 0,
    mx: 0,
    my: 0,
    mz: 0,
    magMag: 0,
    headingDeg: 0,
    accelMag: 0,
    gyroMag: 0,
    piezoRaw: 2048,
    piezoEnv: 0,
    piezoPeak: 0,
    piezoHit: 0,
    micRaw: 0,
    micEnv: 0,
  },
  history: {
    pitch: Array(GRAPH_SIZE).fill(0),
    roll: Array(GRAPH_SIZE).fill(0),
    yaw: Array(GRAPH_SIZE).fill(0),
    yawRate: Array(GRAPH_SIZE).fill(0),
    lx: Array(GRAPH_SIZE).fill(0),
    ly: Array(GRAPH_SIZE).fill(0),
    lz: Array(GRAPH_SIZE).fill(0),
    gyroMag: Array(GRAPH_SIZE).fill(0),
    linMag: Array(GRAPH_SIZE).fill(0),
    gyroOnset: Array(GRAPH_SIZE).fill(0),
    linOnset: Array(GRAPH_SIZE).fill(0),
    piezoEnv: Array(GRAPH_SIZE).fill(0),
    piezoPeak: Array(GRAPH_SIZE).fill(0),
    piezoHit: Array(GRAPH_SIZE).fill(0),
    micEnv: Array(GRAPH_SIZE).fill(0),
  },
  motion: {
    ...createMotionState(),
    lastFrameAt: 0,
    lastBoxHalf: null,
    boxSignature: "",
  },
  params: loadParams(),
  serialFrameParser: null,
  needsGraphRedraw: true,
};


function setStatus(text, tone = "normal") {
  ui.serialStatus.textContent = text;
  ui.serialStatus.style.color =
    tone === "ok" ? "#34d399" : tone === "error" ? "#f87171" : "#ecf4ff";
}

function setBrowserStatus() {
  if ("serial" in navigator) {
    ui.browserStatus.textContent = "Web Serial supported (Chrome / Edge)";
    ui.browserStatus.style.color = "#34d399";
  } else {
    ui.browserStatus.textContent =
      "Web Serial unsupported. Use Chrome or Edge on localhost.";
    ui.browserStatus.style.color = "#f87171";
    ui.connectButton.disabled = true;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resetMotionState() {
  const keepBox = {
    lastFrameAt: state.motion.lastFrameAt,
    lastBoxHalf: state.motion.lastBoxHalf,
    boxSignature: state.motion.boxSignature,
  };
  Object.assign(state.motion, createMotionState(), keepBox);
}

function accelTilt(sample) {
  const up = sample.az || 0.0001;
  return {
    pitch: Math.atan2(sample.ay, Math.hypot(sample.az, sample.ax) || 1),
    roll: Math.atan2(sample.ax, up),
  };
}

function updateGravityLowPass(sample) {
  const g = state.motion.gravityLp;
  if (!state.motion.gravityLpReady) {
    g.x = sample.ax;
    g.y = sample.ay;
    g.z = sample.az;
    state.motion.gravityLpReady = true;
    return;
  }
  const nearStill =
    Math.abs(sample.accelMag - GRAVITY_MS2) < 2.5 && sample.gyroMag < STILL_GYRO_RAD;
  if (!nearStill) {
    return;
  }
  g.x += GRAVITY_LP_ALPHA * (sample.ax - g.x);
  g.y += GRAVITY_LP_ALPHA * (sample.ay - g.y);
  g.z += GRAVITY_LP_ALPHA * (sample.az - g.z);
}

function linearResponseScale(sample) {
  return clamp(
    1 - (sample.gyroMag - ROTATION_ATTENUATION_START) / ROTATION_ATTENUATION_RANGE,
    0.12,
    1,
  );
}

function packetDeltaSeconds(sample) {
  const ms = sample.ms || 0;
  let dt = 0.05;
  if (state.motion.lastSampleMs > 0 && ms > state.motion.lastSampleMs) {
    dt = (ms - state.motion.lastSampleMs) / 1000;
    dt = clamp(dt, 0.001, 0.2);
  }
  if (ms > 0) {
    state.motion.lastSampleMs = ms;
  }
  return dt;
}

function frameDeltaSeconds() {
  const now = performance.now();
  const lastFrameAt = state.motion.lastFrameAt || now;
  state.motion.lastFrameAt = now;
  return clamp((now - lastFrameAt) / 1000, 0.001, 0.05);
}

function processMotionSample(sample) {
  packetDeltaSeconds(sample);
  state.motion.lastBoxHalf = boxHalfExtents(sample);
}

function linearAcceleration(sample) {
  updateGravityLowPass(sample);
  const g = state.motion.gravityLp;
  const spinScale = linearResponseScale(sample);
  const raw = {
    lx: (sample.ax - g.x) * spinScale,
    ly: (sample.ay - g.y) * spinScale,
    lz: (sample.az - g.z) * spinScale,
  };
  const smooth = state.motion.smoothLinear;
  smooth.lx += LINEAR_SMOOTH_ALPHA * (raw.lx - smooth.lx);
  smooth.ly += LINEAR_SMOOTH_ALPHA * (raw.ly - smooth.ly);
  smooth.lz += LINEAR_SMOOTH_ALPHA * (raw.lz - smooth.lz);
  return smooth;
}

function linearMagnitudeForAxis(value, threshold) {
  const magnitude = Math.abs(value);
  if (magnitude <= threshold) {
    return 0;
  }
  return magnitude - threshold;
}

function extraHalfExtentFromMag(magnitude, ratio) {
  if (magnitude <= 0) {
    return 0;
  }
  const t = clamp(magnitude / LINEAR_FULL_SCALE, 0, 1);
  return t ** LINEAR_RESPONSE_POWER * BOX_MAX_EXTRA_HALF * ratio * LINEAR_EDGE_GAIN;
}

function axisSignedGrowth(linearComponent, axisParam) {
  const magnitude = linearMagnitudeForAxis(linearComponent, axisParam.threshold);
  const extra = extraHalfExtentFromMag(magnitude, axisParam.ratio);
  if (linearComponent >= 0) {
    return {
      pos: BOX_MIN_HALF + extra,
      neg: BOX_MIN_HALF,
      center: extra / 2,
    };
  }
  return {
    pos: BOX_MIN_HALF,
    neg: BOX_MIN_HALF + extra,
    center: -extra / 2,
  };
}

function computeYawRate(sample) {
  const gravityMag = Math.hypot(sample.ax, sample.ay, sample.az) || GRAVITY_MS2;
  const ux = sample.ax / gravityMag;
  const uy = sample.ay / gravityMag;
  const uz = sample.az / gravityMag;
  return sample.gx * ux + sample.gy * uy + sample.gz * uz;
}

function enrichM4lSample(sample) {
  return {
    ...sample,
    ...processM4lMotion(sample, state.params, state.motion, { integrateYaw: false }),
  };
}

function formatOrientationDeg(rad) {
  return `${THREE.MathUtils.radToDeg(rad).toFixed(1)}°`;
}

function updateOrientationHud({ pitch, roll, yaw, yawRate, gyroOnset, linOnset }) {
  if (!ui.orientationHud) {
    return;
  }
  const gOn = gyroOnset ? "●" : "○";
  const lOn = linOnset ? "●" : "○";
  ui.orientationHud.innerHTML = `
    <span class="ori-pitch">Pitch <b>${formatOrientationDeg(pitch)}</b></span>
    <span class="ori-roll">Roll <b>${formatOrientationDeg(roll)}</b></span>
    <span class="ori-yaw">Yaw <b>${formatOrientationDeg(yaw)}</b> · ${yawRate.toFixed(3)} rad/s</span>
    <span class="ori-onset gyro-onset">gOn ${gOn}</span>
    <span class="ori-onset lin-onset">lOn ${lOn}</span>
  `;
}

function integrateYaw(sample, dt) {
  if ((sample.magMag ?? 0) > 1 && Number.isFinite(sample.headingDeg)) {
    state.motion.yaw = THREE.MathUtils.degToRad(sample.headingDeg);
    return;
  }

  const yawRate = computeYawRate(sample);
  const { threshold, ratio } = state.params.rotY;
  if (Math.abs(yawRate) <= threshold) {
    return;
  }
  const gatedRate = Math.sign(yawRate) * (Math.abs(yawRate) - threshold) * ratio;
  state.motion.yaw += gatedRate * dt;
}

function boxHalfExtents(sample) {
  const linear = linearAcceleration(sample);
  const p = state.params;
  const alongBoardX = axisSignedGrowth(linear.lx, p.linX);
  const alongBoardY = axisSignedGrowth(linear.ly, p.linY);
  const alongUp = axisSignedGrowth(linear.lz, p.linZ);
  return {
    // Board X+ → Three +X, board Y+ (into scene) → Three -Z, board Z+ → Three +Y
    posX: alongBoardX.pos,
    negX: alongBoardX.neg,
    centerX: alongBoardX.center,
    posY: alongUp.pos,
    negY: alongUp.neg,
    centerY: alongUp.center,
    posZ: alongBoardY.neg,
    negZ: alongBoardY.pos,
    centerZ: -alongBoardY.center,
  };
}

function pushHistory(sample) {
  for (const [key, series] of Object.entries(state.history)) {
    series.push(sample[key]);
    if (series.length > GRAPH_SIZE) {
      series.shift();
    }
  }
  state.needsGraphRedraw = true;
}

function updateText(sample) {
  if (ui.rawLine) {
    ui.rawLine.textContent = state.lastLine || "No data yet.";
  }
  if (ui.lastLineType) {
    ui.lastLineType.textContent = state.lineType;
  }
}

function parseFloatSafe(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseIntSafe(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDataLine(line) {
  const parts = line.split(",");
  if (parts.length < 15 || parts[0] !== "DATA") {
    return null;
  }

  const row = {
    ms: parseIntSafe(parts[1]),
    piezoRaw: parseIntSafe(parts[2]),
    piezoCentered: parseFloatSafe(parts[3]),
    piezoEnv: parseFloatSafe(parts[4]),
    piezoPeak: parseFloatSafe(parts[5]),
    piezoHit: parseIntSafe(parts[6]),
    ax: parseFloatSafe(parts[7]),
    ay: parseFloatSafe(parts[8]),
    az: parseFloatSafe(parts[9]),
    gx: parseFloatSafe(parts[10]),
    gy: parseFloatSafe(parts[11]),
    gz: parseFloatSafe(parts[12]),
    accelMag: parseFloatSafe(parts[13]),
    gyroMag: parseFloatSafe(parts[14]),
    micRaw: 0,
    micEnv: 0,
    mx: 0,
    my: 0,
    mz: 0,
    magMag: 0,
    headingDeg: 0,
  };
  if (parts.length >= 17) {
    row.micRaw = parseIntSafe(parts[15]);
    row.micEnv = parseFloatSafe(parts[16]);
  }
  if (parts.length >= 22) {
    row.mx = parseFloatSafe(parts[17]);
    row.my = parseFloatSafe(parts[18]);
    row.mz = parseFloatSafe(parts[19]);
    row.magMag = parseFloatSafe(parts[20]);
    row.headingDeg = parseFloatSafe(parts[21]);
  }
  return row;
}

function parseSensorLine(line) {
  const parts = line.split(",");
  if (parts.length < 19 || parts[0] !== "SENSOR") {
    return null;
  }

  return {
    ms: parseIntSafe(parts[3]),
    piezoRaw: parseIntSafe(parts[13]),
    piezoCentered: 0,
    piezoEnv: parseFloatSafe(parts[14]),
    piezoPeak: parseFloatSafe(parts[15]),
    piezoHit: parseFloatSafe(parts[15]) > 280 ? 1 : 0,
    ax: parseFloatSafe(parts[5]),
    ay: parseFloatSafe(parts[6]),
    az: parseFloatSafe(parts[7]),
    gx: parseFloatSafe(parts[8]),
    gy: parseFloatSafe(parts[9]),
    gz: parseFloatSafe(parts[10]),
    accelMag: parseFloatSafe(parts[11]),
    gyroMag: parseFloatSafe(parts[12]),
    mx: 0,
    my: 0,
    mz: 0,
    magMag: 0,
    headingDeg: 0,
    micRaw: 0,
    micEnv: 0,
  };
}

function consumeLine(rawLine) {
  const line = rawLine.trim();
  if (!line) {
    return;
  }

  state.lastLine = line;
  let parsed = null;
  if (line.startsWith("DATA,")) {
    parsed = parseDataLine(line);
    state.lineType = "DATA";
  } else if (line.startsWith("SENSOR,")) {
    parsed = parseSensorLine(line);
    state.lineType = "SENSOR";
  } else {
    state.lineType = line.split(",")[0] || "other";
  }

  if (!parsed) {
    updateText(state.sample);
    return;
  }

  const board = sensorToBoardSample(parsed);
  state.sample = board;
  processMotionSample(board);
  pushHistory(enrichM4lSample(board));
  updateText(board);
}

async function disconnectSerial() {
  state.demoEnabled = false;
  state.keepReading = false;
  state.serialFrameParser?.reset();
  resetMotionState();

  if (state.bridgeSource) {
    state.bridgeSource.close();
    state.bridgeSource = null;
  }

  try {
    if (state.reader) {
      await state.reader.cancel();
      state.reader.releaseLock();
    }
  } catch {
    // Ignore.
  }

  try {
    if (state.port) {
      await state.port.close();
    }
  } catch {
    // Ignore.
  }

  state.reader = null;
  state.port = null;
  ui.connectButton.disabled = false;
  if (ui.bridgeButton) {
    ui.bridgeButton.disabled = false;
  }
  ui.disconnectButton.disabled = true;
  setLinkStatus({ mode: "none" });
}

async function connectBridge() {
  if (state.port || state.bridgeSource) {
    await disconnectSerial();
  }

  const device = getSelectedDeviceProfile();
  state.demoEnabled = false;
  ui.connectButton.disabled = true;
  if (ui.bridgeButton) {
    ui.bridgeButton.disabled = true;
  }
  setLinkStatus({
    deviceId: device.id,
    mode: "bridge",
    detail: "connecting…",
  });

  const source = new EventSource(BRIDGE_STREAM_URL);
  state.bridgeSource = source;

  source.onopen = () => {
    ui.disconnectButton.disabled = false;
    setLinkStatus({
      deviceId: device.id,
      mode: "bridge",
      detail: "hub",
      tone: "ok",
    });
    ui.serialStatus.textContent = "Bridge (hub) · M4L 共有 · COM8";
    ui.serialStatus.style.color = "#34d399";
  };

  source.onmessage = (event) => {
    consumeLine(event.data);
  };

  source.onerror = () => {
    if (state.bridgeSource !== source) {
      return;
    }
    setLinkStatus({
      deviceId: device.id,
      mode: "bridge",
      detail: "hub 未起動",
      tone: "error",
    });
    source.close();
    state.bridgeSource = null;
    ui.connectButton.disabled = false;
    if (ui.bridgeButton) {
      ui.bridgeButton.disabled = false;
    }
    ui.disconnectButton.disabled = true;
  };
}

async function readLoop() {
  while (state.keepReading && state.port?.readable) {
    state.reader = state.port.readable.getReader();
    try {
      while (state.keepReading) {
        const { value, done } = await state.reader.read();
        if (done) {
          break;
        }

        state.serialFrameParser?.append(value);
      }
    } catch (error) {
      setStatus(`Read error: ${error.message}`, "error");
      break;
    } finally {
      if (state.reader) {
        state.reader.releaseLock();
        state.reader = null;
      }
    }
  }
}

function formatConnectError(error) {
  const message = error?.message ?? String(error);

  if (error?.name === "NotFoundError" || message.includes("No port selected")) {
    return "ポートが選ばれませんでした。Teensy / XIAO の COM を選んで「接続」";
  }
  if (message.includes("Must be handling a user gesture")) {
    return "もう一度 Connect Serial をクリックしてください";
  }
  if (message.includes("Failed to open") || message.includes("Access denied")) {
    return "シリアルが他アプリで使用中です（serial_hub / シリアルモニタを閉じて再試行）";
  }

  return `接続失敗: ${message}`;
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    setLinkStatus({ mode: "none", detail: "Web Serial 非対応", tone: "error" });
    return;
  }

  if (state.port) {
    await disconnectSerial();
  }

  const device = getSelectedDeviceProfile();
  state.demoEnabled = false;
  ui.connectButton.disabled = true;
  setLinkStatus({
    deviceId: device.id,
    mode: "serial",
    detail: `COM 選択 · ${device.baud}`,
  });

  try {
    state.port = await navigator.serial.requestPort({
      filters: [{ usbVendorId: device.usbVendorId }],
    });
    await state.port.open({ baudRate: device.baud });
    resetMotionState();
    state.serialFrameParser = createSerialFrameParser({
      onLine: (line) => consumeLine(line),
    });
    state.keepReading = true;
    ui.disconnectButton.disabled = false;
    if (ui.bridgeButton) {
      ui.bridgeButton.disabled = true;
    }
    setLinkStatus({
      deviceId: device.id,
      mode: "serial",
      detail: `${device.baud} baud`,
      tone: "ok",
    });
    readLoop();
  } catch (error) {
    state.port = null;
    state.keepReading = false;
    ui.connectButton.disabled = false;
    ui.disconnectButton.disabled = true;
    setLinkStatus({
      deviceId: device.id,
      mode: "serial",
      detail: formatConnectError(error),
      tone: "error",
    });
  }
}

function generateDemoSample(timeSeconds) {
  const ax = Math.sin(timeSeconds * 0.7) * 2.4;
  const ay = Math.cos(timeSeconds * 0.55) * 2.8;
  const az = GRAVITY_MS2 + Math.sin(timeSeconds * 0.9) * 1.2;
  const gx = Math.cos(timeSeconds * 1.4) * 0.8;
  const gy = Math.sin(timeSeconds * 1.2) * 0.6;
  const gz = Math.sin(timeSeconds * 0.8) * 0.5;
  const headingDeg = (timeSeconds * 28) % 360;
  const headingRad = THREE.MathUtils.degToRad(headingDeg);
  const mx = Math.cos(headingRad) * 35;
  const my = Math.sin(headingRad) * 35;
  const mz = 8 + Math.sin(timeSeconds * 0.7) * 3;
  const piezoEnv = (Math.sin(timeSeconds * 3.5) * 0.5 + 0.5) ** 2 * 1800;
  const piezoPeak = piezoEnv + Math.sin(timeSeconds * 12.0) * 180;
  const micEnv = (Math.sin(timeSeconds * 2.8) * 0.5 + 0.5) ** 2 * 900;

  return {
    ms: Math.round(timeSeconds * 1000),
    piezoRaw: Math.round(2048 + Math.sin(timeSeconds * 5.2) * 420),
    piezoCentered: Math.abs(Math.sin(timeSeconds * 5.2) * 420),
    piezoEnv,
    piezoPeak: Math.max(piezoPeak, piezoEnv),
    piezoHit: piezoEnv > 320 ? 1 : 0,
    ax,
    ay,
    az,
    gx,
    gy,
    gz,
    mx,
    my,
    mz,
    accelMag: Math.hypot(ax, ay, az),
    gyroMag: Math.hypot(gx, gy, gz),
    magMag: Math.hypot(mx, my, mz),
    headingDeg,
    micRaw: Math.round(2048 + Math.sin(timeSeconds * 4.1) * 320),
    micEnv,
  };
}

function startDemo() {
  state.demoEnabled = true;
  resetMotionState();
  setLinkStatus({ deviceId: "teensy", mode: "demo", detail: "simulated", tone: "ok" });
  ui.connectButton.disabled = false;
  ui.disconnectButton.disabled = true;

  const tick = () => {
    if (!state.demoEnabled) {
      return;
    }
    const sample = generateDemoSample(performance.now() / 1000);
    state.lastLine =
      `DEMO ax=${sample.ax.toFixed(2)} ay=${sample.ay.toFixed(2)} az=${sample.az.toFixed(2)} piezoEnv=${sample.piezoEnv.toFixed(1)}`;
    state.lineType = "DEMO";
    state.sample = sample;
    processMotionSample(sample);
    pushHistory(enrichM4lSample(sample));
    updateText(sample);
    requestAnimationFrame(tick);
  };

  tick();
}

const GRAPH_AXIS_WIDTH = 40;

function formatScaleValue(value) {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return value.toFixed(0);
  }
  if (abs >= 100) {
    return value.toFixed(0);
  }
  if (abs >= 10) {
    return value.toFixed(1);
  }
  if (abs >= 1) {
    return value.toFixed(2);
  }
  if (abs >= 0.01) {
    return value.toFixed(3);
  }
  return value.toFixed(4);
}

function plotArea(width, height) {
  return {
    left: GRAPH_AXIS_WIDTH,
    top: 4,
    width: Math.max(1, width - GRAPH_AXIS_WIDTH - 4),
    height: Math.max(1, height - 8),
  };
}

function drawYAxisScale(ctx, area, min, max, { variable = false, unit = "" } = {}) {
  const suffix = unit ? ` ${unit}` : "";
  const labels = variable
    ? [
        { value: max, y: area.top + 6, prefix: "↑ " },
        { value: (max + min) / 2, y: area.top + area.height / 2, prefix: "" },
        { value: min, y: area.top + area.height - 6, prefix: "" },
      ]
    : [
        { value: max, y: area.top + 6, prefix: "" },
        { value: (max + min) / 2, y: area.top + area.height / 2, prefix: "" },
        { value: min, y: area.top + area.height - 6, prefix: "" },
      ];

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.46)";
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "right";
  labels.forEach(({ value, y, prefix }) => {
    ctx.textBaseline = y <= area.top + 8 ? "top" : y >= area.top + area.height - 8 ? "bottom" : "middle";
    ctx.fillText(`${prefix}${formatScaleValue(value)}${suffix}`, area.left - 4, y);
  });
  ctx.restore();
}

function drawGrid(ctx, area, horizontalLines) {
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= horizontalLines; i += 1) {
    const y = area.top + (area.height / horizontalLines) * i;
    ctx.beginPath();
    ctx.moveTo(area.left, y);
    ctx.lineTo(area.left + area.width, y);
    ctx.stroke();
  }
}

function drawZeroLine(ctx, area, min, max) {
  if (min >= 0 || max <= 0) {
    return;
  }
  const normalized = (0 - min) / (max - min || 1);
  const y = area.top + area.height - normalized * area.height;
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(area.left, y);
  ctx.lineTo(area.left + area.width, y);
  ctx.stroke();
}

function prepareCanvas2d(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawSeries(ctx, data, color, min, max, area) {
  if (data.length < 2) {
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();

  data.forEach((value, index) => {
    const x = area.left + (index / (data.length - 1)) * area.width;
    const normalized = (value - min) / (max - min || 1);
    const y = area.top + area.height - normalized * area.height;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();
}

function yawGraphRange() {
  let min = -Math.PI;
  let max = Math.PI;
  for (const value of state.history.yaw) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const pad = Math.max(0.25, (max - min) * 0.08);
  return { min: min - pad, max: max + pad };
}

function magnitudeGraphMax() {
  let max = 0.05;
  for (const value of state.history.gyroMag) {
    max = Math.max(max, value);
  }
  for (const value of state.history.linMag) {
    max = Math.max(max, value);
  }
  if (max < 8) {
    return Math.max(max * 2.5, 5);
  }
  if (max < 80) {
    return Math.max(max * 1.5, 40);
  }
  return Math.max(max * 1.08, 400);
}

function drawPitchRollGraph() {
  const { ctx, width, height } = prepareCanvas2d(ui.motionCanvas);
  const area = plotArea(width, height);
  const min = -PITCH_ROLL_REFERENCE;
  const max = PITCH_ROLL_REFERENCE;
  ctx.clearRect(0, 0, width, height);
  drawYAxisScale(ctx, area, min, max, { unit: "rad" });
  drawGrid(ctx, area, 4);
  drawZeroLine(ctx, area, min, max);
  drawSeries(ctx, state.history.pitch, "#ef4444", min, max, area);
  drawSeries(ctx, state.history.roll, "#22c55e", min, max, area);
}

function drawYawGraph() {
  if (!ui.gyroCanvas) {
    return;
  }
  const { ctx, width, height } = prepareCanvas2d(ui.gyroCanvas);
  const area = plotArea(width, height);
  const yawRange = yawGraphRange();
  const rateMin = -YAW_RATE_REFERENCE;
  const rateMax = YAW_RATE_REFERENCE;
  ctx.clearRect(0, 0, width, height);
  drawYAxisScale(ctx, area, yawRange.min, yawRange.max, { unit: "rad" });
  drawGrid(ctx, area, 4);
  drawZeroLine(ctx, area, yawRange.min, yawRange.max);
  drawSeries(ctx, state.history.yaw, "#3b82f6", yawRange.min, yawRange.max, area);
  drawSeries(ctx, state.history.yawRate, "#fb923c", rateMin, rateMax, area);
}

function drawLinearGraph() {
  if (!ui.magCanvas) {
    return;
  }
  const { ctx, width, height } = prepareCanvas2d(ui.magCanvas);
  const area = plotArea(width, height);
  const min = -LINEAR_REFERENCE;
  const max = LINEAR_REFERENCE;
  ctx.clearRect(0, 0, width, height);
  drawYAxisScale(ctx, area, min, max, { unit: "m/s²" });
  drawGrid(ctx, area, 4);
  drawZeroLine(ctx, area, min, max);
  drawSeries(ctx, state.history.lx, "#ef4444", min, max, area);
  drawSeries(ctx, state.history.ly, "#22c55e", min, max, area);
  drawSeries(ctx, state.history.lz, "#3b82f6", min, max, area);
}

function drawThresholdLine(ctx, area, min, max, value, color, alpha = 0.4) {
  if (value <= min || value >= max) {
    return;
  }
  const normalized = (value - min) / (max - min || 1);
  const y = area.top + area.height - normalized * area.height;
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(area.left, y);
  ctx.lineTo(area.left + area.width, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawOnsetTicks(ctx, data, area, color, laneOffset = 0) {
  if (data.length < 2) {
    return;
  }
  ctx.fillStyle = color;
  data.forEach((value, index) => {
    if (value < 1) {
      return;
    }
    const x = area.left + (index / (data.length - 1)) * area.width;
    ctx.fillRect(x - 1, area.top + area.height - 9 - laneOffset, 2, 7);
  });
}

function drawMagnitudeGraph() {
  if (!ui.magnitudeCanvas) {
    return;
  }
  const { ctx, width, height } = prepareCanvas2d(ui.magnitudeCanvas);
  const area = plotArea(width, height);
  const max = magnitudeGraphMax();
  const gyroTh = state.params.gyroOnset.threshold;
  const linTh = state.params.linOnset.threshold;
  ctx.clearRect(0, 0, width, height);
  drawYAxisScale(ctx, area, 0, max, { variable: true });
  drawGrid(ctx, area, 4);
  drawThresholdLine(ctx, area, 0, max, gyroTh, "#fb923c");
  drawThresholdLine(ctx, area, 0, max, linTh, "#22d3ee");
  drawSeries(ctx, state.history.gyroMag, "#fb923c", 0, max, area);
  drawSeries(ctx, state.history.linMag, "#22d3ee", 0, max, area);
  drawOnsetTicks(ctx, state.history.gyroOnset, area, "rgba(251, 146, 60, 0.9)", 0);
  drawOnsetTicks(ctx, state.history.linOnset, area, "rgba(34, 211, 238, 0.9)", 10);
}

function piezoGraphMax() {
  let max = 0;
  for (const value of state.history.piezoEnv) {
    max = Math.max(max, value);
  }
  for (const value of state.history.piezoPeak) {
    max = Math.max(max, value);
  }
  if (max < 8) {
    return Math.max(max * 2.5, 5);
  }
  if (max < 80) {
    return Math.max(max * 1.5, 40);
  }
  return Math.max(max * 1.08, 400);
}

function drawPiezoGraph() {
  const { ctx, width, height } = prepareCanvas2d(ui.piezoCanvas);
  const area = plotArea(width, height);
  const max = piezoGraphMax();
  ctx.clearRect(0, 0, width, height);
  drawYAxisScale(ctx, area, 0, max, { variable: true });
  drawGrid(ctx, area, 4);
  drawSeries(ctx, state.history.piezoEnv, "#22d3ee", 0, max, area);
  drawSeries(ctx, state.history.piezoPeak, "#fb923c", 0, max, area);

  if (state.history.piezoHit.length < 2) {
    return;
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  state.history.piezoHit.forEach((value, index) => {
    if (value < 1) {
      return;
    }
    const x = area.left + (index / (state.history.piezoHit.length - 1)) * area.width;
    ctx.fillRect(x - 1, area.top + area.height - 7, 2, 7);
  });
}

function micGraphMax() {
  let max = 0;
  for (const value of state.history.micEnv) {
    max = Math.max(max, value);
  }
  if (max < 8) {
    return Math.max(max * 2.5, 5);
  }
  if (max < 80) {
    return Math.max(max * 1.5, 40);
  }
  return Math.max(max * 1.08, 400);
}

function drawMicGraph() {
  if (!ui.micCanvas) {
    return;
  }
  const { ctx, width, height } = prepareCanvas2d(ui.micCanvas);
  const area = plotArea(width, height);
  const max = micGraphMax();
  ctx.clearRect(0, 0, width, height);
  drawYAxisScale(ctx, area, 0, max, { variable: true });
  drawGrid(ctx, area, 4);
  drawSeries(ctx, state.history.micEnv, "#a78bfa", 0, max, area);
}

const threeContainer = document.querySelector("#threeContainer");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
renderer.setClearColor(0x000000, 0);
renderer.sortObjects = true;
threeContainer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(
  45,
  threeContainer.clientWidth / threeContainer.clientHeight,
  0.1,
  100,
);
// Bow +X tip → Three +X, bow +Y left → Three -Z, bow +Z up → Three +Y
const INITIAL_CAMERA_POSITION = new THREE.Vector3(-8, 6.2, 8);
camera.position.copy(INITIAL_CAMERA_POSITION);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 1.4));

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(3, 5, 4);
scene.add(directionalLight);

const gridHelper = new THREE.GridHelper(12, 24, 0x35507a, 0x203145);
scene.add(gridHelper);

const cubeGroup = new THREE.Group();
scene.add(cubeGroup);

const BOARD_AXIS_LENGTH = 1.85;

function createBoardAxisLines(length) {
  const group = new THREE.Group();
  const axes = [
    { dir: [1, 0, 0], color: 0xef4444 },
    { dir: [0, 0, -1], color: 0x22c55e },
    { dir: [0, 1, 0], color: 0x3b82f6 },
  ];
  for (const { dir, color } of axes) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(dir[0] * length, dir[1] * length, dir[2] * length),
    ]);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color, depthTest: false }),
    );
    line.renderOrder = 9;
    group.add(line);
  }
  return group;
}

cubeGroup.add(createBoardAxisLines(BOARD_AXIS_LENGTH));

function createAxisLabel(text, color, position) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = color;
  ctx.font = "bold 76px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(0.62, 0.62, 1);
  sprite.renderOrder = 10;
  return sprite;
}

const axisLabelDistance = BOARD_AXIS_LENGTH + 0.2;
cubeGroup.add(createAxisLabel("X", "#ef4444", new THREE.Vector3(axisLabelDistance, 0, 0)));
cubeGroup.add(createAxisLabel("Y", "#22c55e", new THREE.Vector3(0, 0, -axisLabelDistance)));
cubeGroup.add(createAxisLabel("Z", "#3b82f6", new THREE.Vector3(0, axisLabelDistance, 0)));

const cubeMaterial = new THREE.MeshBasicMaterial({
  color: 0x2563eb,
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const cubeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  cubeMaterial,
);
cubeMesh.renderOrder = 0;
cubeGroup.add(cubeMesh);

function setCubeEdgePositions(boxGeometry, lineGeometry) {
  const edges = new THREE.EdgesGeometry(boxGeometry);
  lineGeometry.setPositions(edges.attributes.position.array);
  edges.dispose();
}

const edgeLineGeometry = new LineSegmentsGeometry();
setCubeEdgePositions(new THREE.BoxGeometry(1.02, 1.02, 1.02), edgeLineGeometry);

const edgeLineResolution = new THREE.Vector2();
const edgeLineMaterial = new LineMaterial({
  color: 0xffffff,
  linewidth: CUBE_EDGE_LINE_WIDTH,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});

const edgeLines = new LineSegments2(edgeLineGeometry, edgeLineMaterial);
edgeLines.renderOrder = 1;
cubeGroup.add(edgeLines);

function updateEdgeLineResolution() {
  const pixelRatio = renderer.getPixelRatio();
  edgeLineResolution.set(
    threeContainer.clientWidth * pixelRatio,
    threeContainer.clientHeight * pixelRatio,
  );
  edgeLineMaterial.resolution.copy(edgeLineResolution);
}
updateEdgeLineResolution();

const glowMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1.0, 32, 32),
  new THREE.MeshBasicMaterial({
    color: 0x2563eb,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    visible: false,
  }),
);
glowMesh.visible = false;
cubeGroup.add(glowMesh);

const THERMAL_COLOR_STOPS = [
  { t: 0.0, r: 0.0, g: 0.0, b: 0.0 },
  { t: 0.14, r: 0.29, g: 0.03, b: 0.03 },
  { t: 0.28, r: 0.9, g: 0.08, b: 0.05 },
  { t: 0.48, r: 1.0, g: 0.45, b: 0.0 },
  { t: 0.68, r: 1.0, g: 0.92, b: 0.12 },
  { t: 0.84, r: 1.0, g: 1.0, b: 1.0 },
  { t: 1.0, r: 0.82, g: 0.93, b: 1.0 },
];

function piezoColor(normalized) {
  const t = clamp(normalized, 0, 1);
  const color = new THREE.Color();
  for (let i = 0; i < THERMAL_COLOR_STOPS.length - 1; i += 1) {
    const start = THERMAL_COLOR_STOPS[i];
    const end = THERMAL_COLOR_STOPS[i + 1];
    if (t < start.t || t > end.t) {
      continue;
    }
    const local = (t - start.t) / (end.t - start.t || 1);
    color.setRGB(
      start.r + (end.r - start.r) * local,
      start.g + (end.g - start.g) * local,
      start.b + (end.b - start.b) * local,
    );
    return color;
  }
  const last = THERMAL_COLOR_STOPS[THERMAL_COLOR_STOPS.length - 1];
  color.setRGB(last.r, last.g, last.b);
  return color;
}

function applyAsymmetricBox(half) {
  const sizeX = half.posX + half.negX;
  const sizeY = half.posY + half.negY;
  const sizeZ = half.posZ + half.negZ;
  const signature = [
    half.posX.toFixed(2),
    half.negX.toFixed(2),
    half.centerX.toFixed(2),
    half.posY.toFixed(2),
    half.negY.toFixed(2),
    half.centerY.toFixed(2),
    half.posZ.toFixed(2),
    half.negZ.toFixed(2),
    half.centerZ.toFixed(2),
  ].join("|");

  if (signature === state.motion.boxSignature) {
    return;
  }
  state.motion.boxSignature = signature;

  const centerX = half.centerX;
  const centerY = half.centerY;
  const centerZ = half.centerZ;

  cubeMesh.geometry.dispose();
  cubeMesh.geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
  cubeMesh.position.set(centerX, centerY, centerZ);

  setCubeEdgePositions(cubeMesh.geometry, edgeLineGeometry);
  edgeLines.computeLineDistances();
  edgeLines.position.copy(cubeMesh.position);

  const glowRadius = Math.max(sizeX, sizeY, sizeZ) * 0.72;
  glowMesh.geometry.dispose();
  glowMesh.geometry = new THREE.SphereGeometry(glowRadius, 24, 24);
  glowMesh.position.copy(cubeMesh.position);
}

function updateThreeObject(sample) {
  const frameDt = frameDeltaSeconds();
  integrateYaw(sample, frameDt);

  const { pitch, roll } = accelTilt(sample);
  const p = state.params;
  const pitchOut = applyThresholdRatio(pitch, p.rotX.threshold, p.rotX.ratio);
  const rollOut = applyThresholdRatio(roll, p.rotZ.threshold, p.rotZ.ratio);
  cubeGroup.rotation.order = "YXZ";
  cubeGroup.rotation.set(pitchOut, state.motion.yaw, rollOut);

  updateOrientationHud({
    pitch,
    roll,
    yaw: state.motion.yaw,
    yawRate: computeYawRate(sample),
    gyroOnset: state.sample.gyroOnset,
    linOnset: state.sample.linOnset,
  });

  applyAsymmetricBox(state.motion.lastBoxHalf ?? boxHalfExtents(sample));

  const piezoScaled = applyThresholdRatioUnsigned(
    sample.piezoEnv,
    p.piezo.threshold,
    p.piezo.ratio,
  );
  const piezoNormalized = clamp(piezoScaled / PIEZO_REFERENCE_MAX, 0, 1);
  const color = piezoColor(piezoNormalized);
  cubeMaterial.color.copy(color);
  edgeLines.material.color.copy(color).lerp(new THREE.Color(0xffffff), 0.35);
}

function render() {
  controls.update();
  updateThreeObject(state.sample);
  if (state.needsGraphRedraw) {
    drawPitchRollGraph();
    drawYawGraph();
    drawLinearGraph();
    drawMagnitudeGraph();
    drawPiezoGraph();
    drawMicGraph();
    state.needsGraphRedraw = false;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

function prepareAllCanvases() {
  prepareCanvas2d(ui.motionCanvas);
  if (ui.gyroCanvas) {
    prepareCanvas2d(ui.gyroCanvas);
  }
  if (ui.magCanvas) {
    prepareCanvas2d(ui.magCanvas);
  }
  if (ui.magnitudeCanvas) {
    prepareCanvas2d(ui.magnitudeCanvas);
  }
  prepareCanvas2d(ui.piezoCanvas);
  if (ui.micCanvas) {
    prepareCanvas2d(ui.micCanvas);
  }
}

function onResize() {
  const width = threeContainer.clientWidth;
  const height = threeContainer.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  updateEdgeLineResolution();
  prepareAllCanvases();
  state.needsGraphRedraw = true;
  fitAppToWindow();
}

function fitParamStrip() {
  const strip = document.querySelector("#paramControls");
  const panel = document.querySelector(".tuning-panel");
  if (!strip || !panel) {
    return;
  }
  strip.style.transform = "none";
  strip.style.width = "max-content";
  const available = panel.clientWidth - 8;
  const needed = strip.scrollWidth;
  if (needed > available && available > 0) {
    const scale = available / needed;
    strip.style.transform = `scale(${scale})`;
    strip.style.transformOrigin = "left bottom";
    strip.style.width = `${needed}px`;
    strip.style.marginBottom = `${strip.offsetHeight * (scale - 1)}px`;
  } else {
    strip.style.width = "100%";
    strip.style.marginBottom = "0";
  }
}

function fitAppToWindow() {
  const shell = document.getElementById("appShell");
  if (!shell) {
    return;
  }
  shell.style.transform = "none";
  const scaleX = window.innerWidth / shell.scrollWidth;
  const scaleY = window.innerHeight / shell.scrollHeight;
  const scale = Math.min(1, scaleX, scaleY);
  shell.style.transform = scale < 0.999 ? `scale(${scale})` : "none";
  fitParamStrip();
}

function initAppTitleGradient() {
  const el = document.querySelector("#appTitleText");
  if (!el) {
    return;
  }
  const text = el.textContent ?? "";
  const start = { r: 249, g: 168, b: 212 };
  const end = { r: 16, g: 185, b: 129 };
  const chars = [...text];
  const denom = Math.max(chars.length - 1, 1);

  el.textContent = "";
  for (let i = 0; i < chars.length; i += 1) {
    const t = i / denom;
    const r = Math.round(start.r + (end.r - start.r) * t);
    const g = Math.round(start.g + (end.g - start.g) * t);
    const b = Math.round(start.b + (end.b - start.b) * t);
    const span = document.createElement("span");
    span.className = "app-title-char";
    span.style.color = `rgb(${r}, ${g}, ${b})`;
    span.textContent = chars[i] === " " ? "\u00a0" : chars[i];
    el.appendChild(span);
  }
}

window.addEventListener("resize", onResize);
window.addEventListener("load", () => {
  initAppTitleGradient();
  requestAnimationFrame(fitAppToWindow);
  const bridgeParam = new URLSearchParams(location.search).get("bridge");
  if (bridgeParam !== "0") {
    connectBridge();
  }
});
ui.deviceProfileSelect?.addEventListener("change", () => {
  const device = getSelectedDeviceProfile();
  if (ui.bridgeButton) {
    ui.bridgeButton.textContent = `Bridge · ${device.short}`;
  }
  if (!state.port && !state.bridgeSource && !state.demoEnabled) {
    renderDeviceStatus(device.id, "待機中");
  }
});
ui.connectButton.addEventListener("click", connectSerial);
if (ui.bridgeButton) {
  ui.bridgeButton.addEventListener("click", connectBridge);
}
if (ui.deviceProfileSelect) {
  ui.deviceProfileSelect.dispatchEvent(new Event("change"));
}
ui.disconnectButton.addEventListener("click", disconnectSerial);
ui.demoButton.addEventListener("click", () => {
  if (state.demoEnabled) {
    state.demoEnabled = false;
    setStatus("Demo stopped");
    setLinkStatus({ mode: "none" });
    return;
  }
  startDemo();
});

function formatParamValue(id, key, value) {
  if (key === "threshold" && (id === "piezo" || id === "mic")) {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toFixed(0);
  }
  if (key === "threshold" && (id === "rotX" || id === "rotZ")) {
    return value.toFixed(2);
  }
  if (key === "threshold" && id === "rotY") {
    return value.toFixed(1);
  }
  if (key === "threshold" && (id === "gyroOnset" || id === "linOnset")) {
    return value.toFixed(2);
  }
  if (key === "ratio" && (id === "gyroOnset" || id === "linOnset")) {
    return value.toFixed(2);
  }
  if (key === "ratio") {
    return value.toFixed(1);
  }
  if (key === "threshold" && id.startsWith("lin")) {
    return value.toFixed(1);
  }
  return value.toFixed(1);
}

function dialAngleDeg(value, min, max) {
  const t = clamp((value - min) / (max - min || 1), 0, 1);
  return -135 + t * 270;
}

function initParamControls() {
  const root = document.querySelector("#paramControls");
  const exportPre = document.querySelector("#paramExportJson");
  if (!root) {
    return;
  }

  const dialRefs = [];

  const refreshExport = () => {
    if (exportPre) {
      exportPre.textContent = JSON.stringify(serializeForMax(state.params), null, 2);
    }
  };

  const syncDial = (id, key, input, pointer, readout) => {
    const knobSpec = PARAM_SPEC[id][key];
    const value = Number.parseFloat(input.value);
    pointer.style.setProperty("--dial-angle", `${dialAngleDeg(value, knobSpec.min, knobSpec.max)}deg`);
    readout.textContent = formatParamValue(id, key, value);
  };

  const bindDial = (id, key, input, pointer, readout) => {
    input.addEventListener("input", () => {
      const value = Number.parseFloat(input.value);
      state.params[id][key] = value;
      syncDial(id, key, input, pointer, readout);
      saveParams(state.params);
      refreshExport();
      if (id === "gyroOnset" || id === "linOnset") {
        state.needsGraphRedraw = true;
      }
    });
    dialRefs.push({ id, key, input, pointer, readout });
    syncDial(id, key, input, pointer, readout);
  };

  for (const group of PARAM_GROUPS) {
    const groupEl = document.createElement("div");
    groupEl.className = "param-group";
    groupEl.style.setProperty("--group-color", PARAM_COLORS[group.ids[0]]);

    const title = document.createElement("span");
    title.className = "param-group-label";
    title.textContent = group.label;
    groupEl.appendChild(title);

    const dials = document.createElement("div");
    dials.className = "param-group-dials";

    for (const id of group.ids) {
      const spec = PARAM_SPEC[id];
      const color = PARAM_COLORS[id];

      for (const key of ["threshold", "ratio"]) {
        const knobSpec = spec[key];
        const dial = document.createElement("label");
        dial.className = "param-dial";
        dial.style.setProperty("--dial-color", color);
        dial.title = `${spec.label} ${key}`;

        const keyLabel = document.createElement("span");
        keyLabel.className = "param-dial-key";
        keyLabel.textContent =
          key === "threshold"
            ? PARAM_SHORT[id]
            : id === "gyroOnset" || id === "linOnset"
              ? "Ra"
              : "R";

        const ring = document.createElement("div");
        ring.className = "param-dial-ring";

        const pointer = document.createElement("div");
        pointer.className = "param-dial-pointer";

        const input = document.createElement("input");
        input.type = "range";
        input.className = "param-dial-input";
        input.min = String(knobSpec.min);
        input.max = String(knobSpec.max);
        input.step = String(knobSpec.step);
        input.value = String(state.params[id][key]);
        input.dataset.paramId = id;
        input.dataset.paramKey = key;

        const readout = document.createElement("output");
        readout.className = "param-dial-value";

        ring.appendChild(pointer);
        dial.appendChild(input);
        dial.appendChild(ring);
        dial.appendChild(keyLabel);
        dial.appendChild(readout);
        dials.appendChild(dial);
        bindDial(id, key, input, pointer, readout);
      }
    }

    groupEl.appendChild(dials);
    root.appendChild(groupEl);
  }

  document.querySelector("#paramResetButton")?.addEventListener("click", () => {
    state.params = createDefaultParams();
    saveParams(state.params);
    for (const ref of dialRefs) {
      ref.input.value = String(state.params[ref.id][ref.key]);
      syncDial(ref.id, ref.key, ref.input, ref.pointer, ref.readout);
    }
    refreshExport();
  });

  document.querySelector("#paramCopyButton")?.addEventListener("click", async () => {
    const text = JSON.stringify(serializeForMax(state.params), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setStatus("M4L params copied", "ok");
    } catch {
      setStatus("Copy failed — select JSON manually", "error");
    }
  });

  refreshExport();
  requestAnimationFrame(fitParamStrip);
}

setBrowserStatus();
setLinkStatus({ mode: "none" });
initParamControls();
updateText(state.sample);
onResize();
requestAnimationFrame(fitAppToWindow);
render();

export { state, serializeForMax };
