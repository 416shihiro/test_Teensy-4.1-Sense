import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  DISPLAY_PARAM_COLORS,
  DISPLAY_PARAM_IDS,
  DISPLAY_PARAM_SPEC,
  PARAM_COLORS,
  PARAM_GROUPS,
  PARAM_IDS,
  PARAM_SHORT,
  PARAM_SPEC,
  applyThresholdRatio,
  applyThresholdRatioUnsigned,
  createDefaultDisplayParams,
  createDefaultParams,
  loadDisplayParams,
  loadParams,
  saveDisplayParams,
  saveParams,
  serializeForMax,
} from "./params.js";
import { createSerialFrameParser } from "./camera.js";
import { createMotionState, processM4lMotion } from "./motion_core.js";

const GRAPH_SIZE = 240;
const PIEZO_REFERENCE_MAX = 2400;
const MIC_REFERENCE_MAX = 3000;
const PIEZO_THERMAL_REFERENCE = 900;
const MIC_GRID_REFERENCE = 500;
const MIC_GRID_FLOOR = 18;
const MIC_GRID_GAMMA = 0.68;
const MIC_GRID_PEAK_DECAY_TAU = 0.55;
const PITCH_ROLL_REFERENCE = 1.2;
const YAW_RATE_REFERENCE = 0.35;
const LINEAR_REFERENCE = 2.2;
const GRAVITY_MS2 = 9.81;

// Teensy firmware outputs MPU6050 chip frame (raw ax..gz, no remapping).
// +X ≈ bow tip in acrylic tube. Graphs: red=X green=Y blue=Z.
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

function resolveBridgeStreamUrl() {
  // serve.py on :4173 proxies /stream — same origin is more reliable than :8765
  if (location.port === "4173") {
    return `${location.origin}/stream`;
  }
  return `${location.protocol}//${location.hostname}:8765/stream`;
}

const BRIDGE_STREAM_URL = resolveBridgeStreamUrl();

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
  preview: {
    gridGlow: 0,
    thermalBg: 0,
    micPeakTrack: 12,
  },
  motion: {
    ...createMotionState(),
    lastFrameAt: 0,
    lastBoxHalf: null,
    boxSignature: "",
  },
  lastM4l: null,
  params: loadParams(),
  display: loadDisplayParams(),
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
  const keepFrameAt = state.motion.lastFrameAt;
  Object.assign(state.motion, createMotionState());
  state.motion.lastFrameAt = keepFrameAt;
  state.lastM4l = null;
  delete state.motion.arcSmooth;
}

function processMotionSample(sample) {
  const dt = packetDeltaSeconds(sample);
  state.lastM4l = processM4lMotion(sample, state.params, state.motion, {
    integrateYaw: true,
    dt,
  });
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
    ...(state.lastM4l ?? processM4lMotion(sample, state.params, state.motion, { integrateYaw: false })),
  };
}

function formatOrientationDeg(rad) {
  return `${THREE.MathUtils.radToDeg(rad).toFixed(1)}°`;
}

function formatLiveRad(rad) {
  const sign = rad >= 0 ? "+" : "";
  return `${sign}${rad.toFixed(2)}`;
}

function updateLiveHud(m4l, live) {
  if (!ui.orientationHud) {
    return;
  }
  const gOn = m4l.gyroOnset ? "●" : "○";
  const lOn = m4l.linOnset ? "●" : "○";
  ui.orientationHud.innerHTML = `
    <span class="ori-live-label">→ Live</span>
    <span class="ori-pitch">Pt <b>${formatLiveRad(live.pitchOut)}</b></span>
    <span class="ori-roll">Rl <b>${formatLiveRad(live.rollOut)}</b></span>
    <span class="ori-yaw">Yw <b>${formatOrientationDeg(m4l.yaw)}</b></span>
    <span class="ori-mag">|ω| <b>${m4l.gyroMag.toFixed(2)}</b></span>
    <span class="ori-mag">|a| <b>${m4l.linMag.toFixed(2)}</b></span>
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
  let bridgeOpenedAt = Date.now();
  let bridgeDataSeen = false;
  const bridgeWatchdog = window.setInterval(() => {
    if (state.bridgeSource !== source) {
      window.clearInterval(bridgeWatchdog);
      return;
    }
    if (bridgeDataSeen) {
      return;
    }
    if (Date.now() - bridgeOpenedAt < 3500) {
      return;
    }
    ui.serialStatus.textContent = "Bridge · hub OK · no COM data (plug Teensy USB?)";
    ui.serialStatus.style.color = "#fbbf24";
  }, 1500);

  source.onopen = () => {
    bridgeOpenedAt = Date.now();
    ui.disconnectButton.disabled = false;
    setLinkStatus({
      deviceId: device.id,
      mode: "bridge",
      detail: "hub",
      tone: "ok",
    });
    ui.serialStatus.textContent = "Bridge · waiting for DATA…";
    ui.serialStatus.style.color = "#fbbf24";
  };

  source.onmessage = (event) => {
    if (!bridgeDataSeen) {
      bridgeDataSeen = true;
      window.clearInterval(bridgeWatchdog);
      ui.serialStatus.textContent = "Bridge (hub) · M4L 共有 · COM8";
      ui.serialStatus.style.color = "#34d399";
    }
    consumeLine(event.data);
  };

  source.onerror = () => {
    window.clearInterval(bridgeWatchdog);
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

function drawGraphCaption(ctx, text, color, x, y) {
  ctx.save();
  ctx.font = "600 10px Inter, system-ui, sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
  ctx.restore();
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
  drawGraphCaption(ctx, "Twist bow → gOn", "#fb923c", area.left, area.top + 2);
  drawYAxisScale(ctx, area, yawRange.min, yawRange.max, { unit: "rad" });
  drawGrid(ctx, area, 4);
  drawZeroLine(ctx, area, yawRange.min, yawRange.max);
  drawSeries(ctx, state.history.yaw, "#3b82f6", yawRange.min, yawRange.max, area);
  drawSeries(ctx, state.history.yawRate, "#fb923c", rateMin, rateMax, area);
}

function linearGraphRange() {
  let peak = 0.15;
  for (const key of ["lx", "ly", "lz"]) {
    for (const value of state.history[key]) {
      peak = Math.max(peak, Math.abs(value));
    }
  }
  const bound = Math.max(0.45, Math.min(LINEAR_REFERENCE, peak * 1.25));
  return { min: -bound, max: bound };
}

function drawGraphAxisLegend(ctx, area, items) {
  let x = area.left + 3;
  const y = area.top + area.height - 5;
  ctx.font = "600 9px Inter, system-ui, sans-serif";
  for (const { text, color } of items) {
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    x += ctx.measureText(text).width + 12;
  }
}

function drawLinearGraph() {
  if (!ui.magCanvas) {
    return;
  }
  const { ctx, width, height } = prepareCanvas2d(ui.magCanvas);
  const area = plotArea(width, height);
  const { min, max } = linearGraphRange();
  ctx.clearRect(0, 0, width, height);
  drawGraphCaption(ctx, "Tap / shake → lOn", "#22d3ee", area.left, area.top + 2);
  drawYAxisScale(ctx, area, min, max, { unit: "m/s²" });
  drawGrid(ctx, area, 4);
  drawZeroLine(ctx, area, min, max);
  drawSeries(ctx, state.history.lx, "#ef4444", min, max, area);
  drawSeries(ctx, state.history.ly, "#22c55e", min, max, area);
  drawSeries(ctx, state.history.lz, "#3b82f6", min, max, area);
  drawGraphAxisLegend(ctx, area, [
    { text: "lX tip", color: "#ef4444" },
    { text: "lY left", color: "#22c55e" },
    { text: "lZ up", color: "#3b82f6" },
  ]);
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
  drawGraphCaption(ctx, "Twist bow → gOn (gyroMag)", "#fb923c", area.left, area.top + 2);
  drawGraphCaption(ctx, "Tap / shake → lOn (linMag)", "#22d3ee", area.left, area.top + 14);
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
const PREVIEW_BASE_BG = new THREE.Color(0x0d141d);
const PREVIEW_RELEASE_TAU = 0.1;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
renderer.setClearColor(PREVIEW_BASE_BG.getHex(), 1);
renderer.sortObjects = true;
threeContainer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = PREVIEW_BASE_BG.clone();

const camera = new THREE.PerspectiveCamera(
  45,
  threeContainer.clientWidth / threeContainer.clientHeight,
  0.1,
  100,
);
// Chip frame: +X tip, +Y left, +Z sky — camera +180° around Z from prior view
camera.up.set(0, 0, 1);
const INITIAL_CAMERA_POSITION = new THREE.Vector3(-5.6, -5.4, 4.8);
camera.position.copy(INITIAL_CAMERA_POSITION);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 1.4));

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(3, -2, 6);
scene.add(directionalLight);

const GRID_COLOR_CENTER = new THREE.Color(0x35507a);
const GRID_COLOR_LINE = new THREE.Color(0x203145);
const GRID_GLOW_COLOR = new THREE.Color(0xffffff);
const _gridCenterLit = new THREE.Color();
const _gridLineLit = new THREE.Color();

const GRID_SIZE = 12;
const GRID_DIVISIONS = 24;
const gridHelper = new THREE.GridHelper(
  GRID_SIZE,
  GRID_DIVISIONS,
  GRID_COLOR_CENTER.getHex(),
  GRID_COLOR_LINE.getHex(),
);
gridHelper.rotation.x = Math.PI / 2;
gridHelper.userData.gridDivisions = GRID_DIVISIONS;
gridHelper.userData.gridCenter = GRID_DIVISIONS / 2;
scene.add(gridHelper);

const sensorGroup = new THREE.Group();
scene.add(sensorGroup);

const CHIP_AXIS_LENGTH = 1.65;
const CHIP_HALF = { x: 0.28, y: 0.18, z: 0.12 };
const METER_LIN_SCALE = 1.35;
const LIN_BAR_WIDTH = 0.2;
const ARC_BASE_RADIUS = 1.0;
const ARC_OMEGA_RADIUS = 0.84;
const ARC_ALPHA_SWEEP = 0.38;
const ARC_OMEGA_THICK = 0.032;
const ARC_RADIUS_SMOOTH_TAU = 0.14;
const ARC_SWEEP_SMOOTH_TAU = 0.22;
const LIN_FLASH_DECAY_MS = 1150;
const GYRO_FLASH_DECAY_MS = 1150;
const LIN_SPOKE_COUNT = 24;
const GYRO_POLAR_RAYS = 36;
const BOW_PINK = 0xf472b6;
const BOW_LENGTH = 2.35;

function createChipAxisLines(length) {
  const group = new THREE.Group();
  const axes = [
    { dir: [1, 0, 0], color: 0xef4444 },
    { dir: [0, 1, 0], color: 0x22c55e },
    { dir: [0, 0, 1], color: 0x3b82f6 },
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

sensorGroup.add(createChipAxisLines(CHIP_AXIS_LENGTH));

function createBowArrow() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: BOW_PINK,
    depthTest: true,
    depthWrite: false,
  });
  const headLength = 0.36;
  const shaftLength = BOW_LENGTH - headLength;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, shaftLength, 14),
    material,
  );
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = shaftLength / 2;

  const head = new THREE.Mesh(new THREE.ConeGeometry(0.15, headLength, 18), material);
  head.rotation.z = -Math.PI / 2;
  head.position.x = BOW_LENGTH - headLength / 2;

  group.add(shaft);
  group.add(head);
  group.renderOrder = 5;
  return group;
}

sensorGroup.add(createBowArrow());

const METER_LABEL_SCALE_MULT = 3;
const AXIS_LABEL_CANVAS_REF = 128;

function createAxisLabel(text, color, position, scale = 0.62) {
  const font = "bold 76px Inter, system-ui, sans-serif";
  const pad = 16;
  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");
  mctx.font = font;
  const textWidth = mctx.measureText(text).width;
  const width = Math.max(AXIS_LABEL_CANVAS_REF, Math.ceil(textWidth) + pad * 2);
  const height = AXIS_LABEL_CANVAS_REF;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(scale * (width / AXIS_LABEL_CANVAS_REF), scale, 1);
  sprite.renderOrder = 25;
  return sprite;
}

function createMeterLabel(text, color = "#e2e8f0", scale = 0.26) {
  const size = 320;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(8,12,22,0.78)";
  const pad = 10;
  const textPad = 14;
  ctx.font = "600 52px Inter, system-ui, sans-serif";
  const tw = ctx.measureText(text).width;
  const boxW = tw + textPad * 2;
  const boxH = 58;
  const boxX = (size - boxW) / 2;
  const boxY = (size - boxH) / 2;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  const displayScale = scale * METER_LABEL_SCALE_MULT;
  sprite.scale.set(displayScale, displayScale * (boxH / boxW), 1);
  sprite.renderOrder = 30;
  return sprite;
}

const axisLabelDistance = CHIP_AXIS_LENGTH + 0.18;
const xLabelDistance = BOW_LENGTH + 0.42;
sensorGroup.add(createAxisLabel("X tip", "#ef4444", new THREE.Vector3(xLabelDistance, 0, 0.34), 0.36));
sensorGroup.add(
  createAxisLabel("Y left", "#22c55e", new THREE.Vector3(0, axisLabelDistance + 0.06, 0.22), 0.33),
);
sensorGroup.add(
  createAxisLabel("Z up", "#3b82f6", new THREE.Vector3(0, 0, axisLabelDistance + 0.1), 0.33),
);

const chipMaterial = new THREE.MeshBasicMaterial({
  color: 0x2563eb,
  transparent: true,
  opacity: 0.42,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const chipMesh = new THREE.Mesh(
  new THREE.BoxGeometry(CHIP_HALF.x * 2, CHIP_HALF.y * 2, CHIP_HALF.z * 2),
  chipMaterial,
);
chipMesh.renderOrder = 2;
sensorGroup.add(chipMesh);

const chipEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(chipMesh.geometry),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
);
chipEdges.renderOrder = 3;
sensorGroup.add(chipEdges);

function arcPointOnPlane(plane, angle, radius, offset) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (plane === "pitch") {
    return new THREE.Vector3(offset.x + c * radius, offset.y, offset.z + s * radius);
  }
  if (plane === "roll") {
    return new THREE.Vector3(offset.x, offset.y + c * radius, offset.z + s * radius);
  }
  return new THREE.Vector3(offset.x + c * radius, offset.y + s * radius, offset.z);
}

function disposeArcMeter(arcMeter) {
  if (arcMeter.tube) {
    arcMeter.tube.geometry.dispose();
    arcMeter.tube.material.dispose();
    arcMeter.group.remove(arcMeter.tube);
    arcMeter.tube = null;
  }
  if (arcMeter.head) {
    arcMeter.head.geometry.dispose();
    arcMeter.head.material.dispose();
    arcMeter.group.remove(arcMeter.head);
    arcMeter.head = null;
  }
}

function updateArcArrowMeter(arcMeter, plane, offset, sweepRad, radius, tubeRadius, opacity) {
  const minSweep = 0.04;
  if (Math.abs(sweepRad) < minSweep) {
    arcMeter.group.visible = false;
    disposeArcMeter(arcMeter);
    return;
  }
  arcMeter.group.visible = true;
  const steps = 28;
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push(arcPointOnPlane(plane, sweepRad * t, radius, offset));
  }
  const signature = points
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`)
    .join("|");
  if (signature === arcMeter.signature && arcMeter.tube) {
    arcMeter.tube.material.opacity = opacity;
    return;
  }
  arcMeter.signature = signature;
  disposeArcMeter(arcMeter);
  const curve = new THREE.CatmullRomCurve3(points);
  const tubeGeom = new THREE.TubeGeometry(curve, steps, tubeRadius, 7, false);
  arcMeter.tube = new THREE.Mesh(
    tubeGeom,
    new THREE.MeshBasicMaterial({
      color: arcMeter.color,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  );
  arcMeter.tube.renderOrder = 8;
  arcMeter.group.add(arcMeter.tube);

  const end = points[points.length - 1];
  const prev = points[points.length - 2];
  const tangent = end.clone().sub(prev).normalize();
  const headLen = tubeRadius * 4.2;
  arcMeter.head = new THREE.Mesh(
    new THREE.ConeGeometry(tubeRadius * 2.4, headLen, 10),
    new THREE.MeshBasicMaterial({
      color: arcMeter.color,
      transparent: true,
      opacity: Math.min(1, opacity + 0.12),
      depthWrite: false,
    }),
  );
  arcMeter.head.position.copy(end).add(tangent.clone().multiplyScalar(headLen * 0.42));
  arcMeter.head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  arcMeter.head.renderOrder = 9;
  arcMeter.group.add(arcMeter.head);
}

function fibonacciSphereDirections(count) {
  const dirs = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * i) / Math.max(1, count - 1);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = phi * i;
    dirs.push(
      new THREE.Vector3(Math.cos(theta) * r, Math.sin(theta) * r, y).normalize(),
    );
  }
  return dirs;
}

function polarPlaneDirections(count) {
  const dirs = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    dirs.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
  }
  return dirs;
}

function flashEnvelope(flashAge, decayMs = LIN_FLASH_DECAY_MS) {
  if (flashAge < 0 || flashAge >= decayMs) {
    return 0;
  }
  const u = flashAge / decayMs;
  const punch = Math.exp(-((flashAge - 35) ** 2) / 4200);
  const tail = Math.exp(-u * 2.4) * (1 - u * 0.15);
  return clamp(punch * 0.95 + tail * 0.82, 0, 1);
}

const _spokeY = new THREE.Vector3(0, 1, 0);
const _barZ = new THREE.Vector3(0, 0, 1);
const _spokeDir = new THREE.Vector3();

function createLinAxisBar(color) {
  const geometry = new THREE.BoxGeometry(LIN_BAR_WIDTH, LIN_BAR_WIDTH, 1);
  geometry.translate(0, 0, 0.5);
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }),
  );
}

const LIN_AXIS_X = new THREE.Vector3(1, 0, 0);
const LIN_AXIS_Y = new THREE.Vector3(0, 1, 0);
const LIN_AXIS_Z = new THREE.Vector3(0, 0, 1);
const _linAxis = new THREE.Vector3();

function updateLinAxisBar(mesh, axisUnit, value, scale, flashEnv) {
  const rawLen = Math.abs(value) * scale;
  const len = rawLen > 0.008 ? Math.max(rawLen, 0.22) * (1 + flashEnv * 0.65) : 0;
  mesh.visible = len > 0.01;
  if (!mesh.visible) {
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    return 0;
  }
  const sign = Math.sign(value || 1);
  _linAxis.copy(axisUnit).multiplyScalar(sign);
  mesh.scale.set(1, 1, len);
  mesh.position.set(0, 0, 0);
  mesh.quaternion.setFromUnitVectors(_barZ, _linAxis);
  mesh.material.opacity = clamp(0.72 + rawLen * 0.35 + flashEnv * 0.28, 0.72, 1);
  return len;
}

function createSpokeMeter(color, directions) {
  const group = new THREE.Group();
  const spokes = directions.map((dir) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 1, 6),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    mesh.renderOrder = 7;
    group.add(mesh);
    return { dir: dir.clone(), mesh };
  });
  return { group, spokes };
}

function updateSpoke(mesh, dir, length, radius, opacity) {
  const visible = length > 0.012 && opacity > 0.03;
  mesh.visible = visible;
  if (!visible) {
    return;
  }
  mesh.scale.set(radius / 0.028, length, radius / 0.028);
  _spokeDir.copy(dir);
  mesh.position.copy(_spokeDir.multiplyScalar(length * 0.5));
  mesh.quaternion.setFromUnitVectors(_spokeY, dir);
  mesh.material.opacity = opacity;
}

function updateLinSpokeMeter(meter, lx, ly, lz, linMag, flashEnv) {
  if (flashEnv < 0.06) {
    for (const spoke of meter.spokes) {
      spoke.mesh.visible = false;
    }
    return new THREE.Vector3();
  }
  const accel = new THREE.Vector3(lx, ly, lz);
  let maxLen = 0;
  let maxTip = new THREE.Vector3();
  for (const spoke of meter.spokes) {
    const proj = accel.dot(spoke.dir);
    const baseLen =
      Math.abs(proj) * METER_LIN_SCALE * 0.85 + linMag * 0.12 + flashEnv * 0.55;
    const len = baseLen * (1 + flashEnv * 2.4);
    const opacity = clamp(flashEnv * 0.95, 0, 1);
    const radius = 0.04 + flashEnv * 0.055;
    updateSpoke(spoke.mesh, spoke.dir, len, radius, opacity);
    if (len > maxLen) {
      maxLen = len;
      maxTip.copy(spoke.dir).multiplyScalar(len);
    }
  }
  return maxTip;
}

function updateGyroPolarMeter(meter, yaw, gyroMag, flashEnv) {
  const sign = Math.sign(yaw) || 1;
  const sector = Math.abs(yaw) % (Math.PI * 2);
  const baseLen = 0.12 + gyroMag * 0.42;
  let labelPos = new THREE.Vector3(0.35, 0, 0.12);
  for (const spoke of meter.spokes) {
    let rayAngle = Math.atan2(spoke.dir.y, spoke.dir.x);
    if (sign < 0) {
      rayAngle = -rayAngle;
    }
    rayAngle = ((rayAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const inSector = sector < 0.02 || rayAngle <= sector;
    const len = (baseLen + (inSector ? 0.22 : 0)) * (1 + flashEnv * 2.3);
    const opacity = clamp(
      (inSector ? 0.42 : 0.1) + gyroMag * 0.28 + flashEnv * 0.9,
      0,
      1,
    );
    const radius = 0.02 + flashEnv * 0.042 + (inSector ? 0.012 : 0);
    updateSpoke(spoke.mesh, spoke.dir, len, radius, opacity);
    if (inSector && len >= labelPos.length()) {
      labelPos.copy(spoke.dir).multiplyScalar(len);
    }
  }
  return labelPos;
}

function createArcMeter(color) {
  return {
    group: new THREE.Group(),
    color,
    tube: null,
    head: null,
    signature: "",
  };
}

const meters = {
  pitchArc: createArcMeter(0xef4444),
  rollArc: createArcMeter(0x22c55e),
  yawArc: createArcMeter(0x60a5fa),
  linSpokes: createSpokeMeter(0x22d3ee, fibonacciSphereDirections(LIN_SPOKE_COUNT)),
  linBarX: createLinAxisBar(0xef4444),
  linBarY: createLinAxisBar(0x22c55e),
  linBarZ: createLinAxisBar(0x3b82f6),
  gyroPolar: createSpokeMeter(0xfb923c, polarPlaneDirections(GYRO_POLAR_RAYS)),
};

meters.linBarX.position.set(0, 0, 0);
meters.linBarY.position.set(0, 0, 0);
meters.linBarZ.position.set(0, 0, 0);

const meterLabels = {
  pt: createMeterLabel("Pt ω", "#ef4444", 0.24),
  rl: createMeterLabel("Rl ω", "#22c55e", 0.24),
  yw: createMeterLabel("Yw ω", "#60a5fa", 0.24),
  gyro: createMeterLabel("gOn", "#fb923c", 0.22),
  lon: createMeterLabel("lOn", "#22d3ee", 0.24),
  lx: createMeterLabel("lX", "#ef4444", 0.22),
  ly: createMeterLabel("lY", "#22c55e", 0.22),
  lz: createMeterLabel("lZ", "#3b82f6", 0.22),
};

const ARC_OFFSETS = {
  pitch: new THREE.Vector3(0, CHIP_HALF.y + 0.28, 0),
  roll: new THREE.Vector3(CHIP_HALF.x + 0.28, 0, 0),
  yaw: new THREE.Vector3(0, 0, 0.1),
};

for (const key of [
  "pitchArc",
  "rollArc",
  "yawArc",
  "linSpokes",
  "linBarX",
  "linBarY",
  "linBarZ",
  "gyroPolar",
]) {
  sensorGroup.add(meters[key].group ?? meters[key]);
}
for (const label of Object.values(meterLabels)) {
  sensorGroup.add(label);
}

const _barTipLocal = new THREE.Vector3(0, 0, 1);

function placeLabelAtBarTip(sprite, mesh, offset = new THREE.Vector3(0, 0, 0.14)) {
  _barTipLocal.set(0, 0, mesh.scale.z + 0.04);
  _spokeDir.copy(_barTipLocal);
  mesh.localToWorld(_spokeDir);
  placeMeterLabel(sprite, _spokeDir, offset);
}

const _meterLabelPos = new THREE.Vector3();

function placeMeterLabel(sprite, worldPos, offset) {
  _meterLabelPos.copy(worldPos);
  if (offset) {
    _meterLabelPos.add(offset);
  }
  sprite.position.copy(_meterLabelPos);
}

const THERMAL_COLOR_STOPS = [
  { t: 0.0, r: 0.0, g: 0.0, b: 0.0 },
  { t: 0.14, r: 0.29, g: 0.03, b: 0.03 },
  { t: 0.28, r: 0.9, g: 0.08, b: 0.05 },
  { t: 0.48, r: 1.0, g: 0.45, b: 0.0 },
  { t: 0.68, r: 1.0, g: 0.92, b: 0.12 },
  { t: 0.84, r: 1.0, g: 1.0, b: 1.0 },
  { t: 1.0, r: 0.82, g: 0.93, b: 1.0 },
];

function thermalColor(normalized) {
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

const piezoColor = thermalColor;
const _previewBgColor = new THREE.Color();

function updatePreviewEnvelope(current, target, frameDt) {
  if (target >= current) {
    return target;
  }
  return smoothArcScalar(current, target, frameDt, PREVIEW_RELEASE_TAU);
}

function updateGridGlow(glow) {
  const g = clamp(glow, 0, 1);
  const colorAttr = gridHelper.geometry.attributes.color;
  if (!colorAttr) {
    return;
  }
  const divisions = gridHelper.userData.gridDivisions ?? GRID_DIVISIONS;
  const centerIdx = gridHelper.userData.gridCenter ?? divisions / 2;
  _gridCenterLit.copy(GRID_COLOR_CENTER).lerp(GRID_GLOW_COLOR, g);
  _gridLineLit.copy(GRID_COLOR_LINE).lerp(GRID_GLOW_COLOR, g * 0.94);

  let vertex = 0;
  for (let i = 0; i <= divisions; i += 1) {
    const c = i === centerIdx ? _gridCenterLit : _gridLineLit;
    for (let v = 0; v < 4; v += 1) {
      colorAttr.setXYZ(vertex, c.r, c.g, c.b);
      vertex += 1;
    }
  }
  colorAttr.needsUpdate = true;
}

function updateThermalBackground(thermalNorm) {
  const t = clamp(thermalNorm, 0, 1);
  const hot = thermalColor(t);
  _previewBgColor.copy(PREVIEW_BASE_BG).lerp(hot, clamp(t * 1.06, 0, 1));
  scene.background.copy(_previewBgColor);
  renderer.setClearColor(_previewBgColor.getHex(), 1);
}

function computeMicGridGlowTarget(sample, frameDt) {
  const raw = Math.max(0, sample.micEnv ?? 0);
  const prevPeak = state.preview.micPeakTrack ?? MIC_GRID_REFERENCE * 0.15;
  const peak =
    raw >= prevPeak
      ? raw
      : prevPeak + (raw - prevPeak) * (1 - Math.exp(-frameDt / MIC_GRID_PEAK_DECAY_TAU));
  state.preview.micPeakTrack = Math.max(peak, MIC_GRID_FLOOR * 2);

  const span = Math.max(
    MIC_GRID_REFERENCE * 0.35,
    state.preview.micPeakTrack - MIC_GRID_FLOOR,
  );
  const above = Math.max(0, raw - MIC_GRID_FLOOR);
  return clamp(Math.pow(above / span, MIC_GRID_GAMMA), 0, 1);
}

function computePiezoThermalTarget(piezoScaled) {
  return clamp(piezoScaled / PIEZO_THERMAL_REFERENCE, 0, 1);
}

function rotArcDynamics(prevAngle, angle, prevRate, frameDt) {
  const rate = frameDt > 0 ? (angle - prevAngle) / frameDt : 0;
  const accel = frameDt > 0 ? (rate - prevRate) / frameDt : 0;
  return { rate, accel };
}

function smoothArcScalar(prev, target, frameDt, tau) {
  if (!Number.isFinite(prev)) {
    return target;
  }
  const blend = 1 - Math.exp(-frameDt / Math.max(tau, 1e-4));
  return prev + (target - prev) * blend;
}

function smoothArcVisuals(key, raw, frameDt) {
  if (!state.motion.arcSmooth) {
    state.motion.arcSmooth = {};
  }
  const slot = state.motion.arcSmooth[key] ?? {
    radius: raw.radius,
    sweep: raw.sweep,
  };
  slot.radius = smoothArcScalar(slot.radius, raw.radius, frameDt, ARC_RADIUS_SMOOTH_TAU);
  slot.sweep = smoothArcScalar(slot.sweep, raw.sweep, frameDt, ARC_SWEEP_SMOOTH_TAU);
  state.motion.arcSmooth[key] = slot;
  return {
    sweep: slot.sweep,
    radius: slot.radius,
    tube: raw.tube,
    opacity: raw.opacity,
  };
}

function arcVisuals(omega, alpha) {
  const radius = ARC_BASE_RADIUS + Math.abs(omega) * ARC_OMEGA_RADIUS;
  const sweep = Math.sign(alpha || omega || 1) * Math.abs(alpha) * ARC_ALPHA_SWEEP;
  const tube = 0.022 + Math.abs(omega) * ARC_OMEGA_THICK;
  const opacity = clamp(0.28 + Math.abs(omega) * 0.48 + Math.abs(alpha) * 0.22, 0.22, 1);
  return { sweep, radius, tube, opacity };
}

function updateThreeObject(sample) {
  const frameDt = frameDeltaSeconds();
  integrateYaw(sample, frameDt);

  const m4l =
    state.lastM4l ??
    processM4lMotion(sample, state.params, state.motion, { integrateYaw: false });
  const p = state.params;
  const live = {
    pitchOut: applyThresholdRatio(m4l.pitch, p.rotX.threshold, p.rotX.ratio),
    rollOut: applyThresholdRatio(m4l.roll, p.rotZ.threshold, p.rotZ.ratio),
    lxOut: applyThresholdRatio(m4l.lx, p.linX.threshold, p.linX.ratio),
    lyOut: applyThresholdRatio(m4l.ly, p.linY.threshold, p.linY.ratio),
    lzOut: applyThresholdRatio(m4l.lz, p.linZ.threshold, p.linZ.ratio),
  };

  if (m4l.gyroOnset) {
    state.motion.gyroFlashStart = performance.now();
  }
  if (m4l.linOnset) {
    state.motion.linFlashStart = performance.now();
  }

  const pitchDyn = rotArcDynamics(
    state.motion.lastPitch ?? m4l.pitch,
    m4l.pitch,
    state.motion.lastPitchRate ?? 0,
    frameDt,
  );
  state.motion.lastPitch = m4l.pitch;
  state.motion.lastPitchRate = pitchDyn.rate;

  const rollDyn = rotArcDynamics(
    state.motion.lastRoll ?? m4l.roll,
    m4l.roll,
    state.motion.lastRollRate ?? 0,
    frameDt,
  );
  state.motion.lastRoll = m4l.roll;
  state.motion.lastRollRate = rollDyn.rate;

  const pitchVis = smoothArcVisuals("pitch", arcVisuals(pitchDyn.rate, pitchDyn.accel), frameDt);
  updateArcArrowMeter(
    meters.pitchArc,
    "pitch",
    ARC_OFFSETS.pitch,
    pitchVis.sweep,
    pitchVis.radius,
    pitchVis.tube,
    pitchVis.opacity,
  );
  const pitchLabelPos = arcPointOnPlane(
    "pitch",
    pitchVis.sweep * 0.52,
    pitchVis.radius,
    ARC_OFFSETS.pitch,
  );
  placeMeterLabel(meterLabels.pt, pitchLabelPos, new THREE.Vector3(0, 0.14, 0));

  const rollVis = smoothArcVisuals("roll", arcVisuals(rollDyn.rate, rollDyn.accel), frameDt);
  updateArcArrowMeter(
    meters.rollArc,
    "roll",
    ARC_OFFSETS.roll,
    rollVis.sweep,
    rollVis.radius,
    rollVis.tube,
    rollVis.opacity,
  );
  const rollLabelPos = arcPointOnPlane("roll", rollVis.sweep * 0.52, rollVis.radius, ARC_OFFSETS.roll);
  placeMeterLabel(meterLabels.rl, rollLabelPos, new THREE.Vector3(0.14, 0, 0));

  const yaw = state.motion.yaw;
  const yawOmega = computeYawRate(sample);
  const yawAlpha =
    frameDt > 0 ? (yawOmega - (state.motion.lastYawOmega ?? yawOmega)) / frameDt : 0;
  state.motion.lastYawOmega = yawOmega;
  const yawVis = smoothArcVisuals("yaw", arcVisuals(yawOmega, yawAlpha), frameDt);
  updateArcArrowMeter(
    meters.yawArc,
    "yaw",
    ARC_OFFSETS.yaw,
    yawVis.sweep,
    yawVis.radius,
    yawVis.tube,
    yawVis.opacity,
  );
  const yawLabelPos = arcPointOnPlane("yaw", yawVis.sweep * 0.52, yawVis.radius, ARC_OFFSETS.yaw);
  placeMeterLabel(meterLabels.yw, yawLabelPos, new THREE.Vector3(0, 0, 0.2));

  const now = performance.now();
  const linFlashEnv = flashEnvelope(now - (state.motion.linFlashStart || 0), LIN_FLASH_DECAY_MS);
  updateLinSpokeMeter(
    meters.linSpokes,
    live.lxOut,
    live.lyOut,
    live.lzOut,
    m4l.linMag,
    linFlashEnv,
  );

  updateLinAxisBar(meters.linBarX, LIN_AXIS_X, live.lxOut, METER_LIN_SCALE, linFlashEnv);
  placeLabelAtBarTip(meterLabels.lx, meters.linBarX, new THREE.Vector3(0, 0, 0.12));

  updateLinAxisBar(meters.linBarY, LIN_AXIS_Y, live.lyOut, METER_LIN_SCALE, linFlashEnv);
  placeLabelAtBarTip(meterLabels.ly, meters.linBarY, new THREE.Vector3(0, 0, 0.12));

  const lzLen = updateLinAxisBar(meters.linBarZ, LIN_AXIS_Z, live.lzOut, METER_LIN_SCALE, linFlashEnv);
  placeLabelAtBarTip(meterLabels.lz, meters.linBarZ, new THREE.Vector3(0, 0, 0.12));

  meterLabels.lon.visible = linFlashEnv > 0.05 || m4l.linMag > p.linOnset.threshold * 0.35;
  if (meterLabels.lon.visible) {
    const lonPos = new THREE.Vector3(0, 0, Math.max(lzLen, 0.35) + linFlashEnv * 0.4);
    placeMeterLabel(meterLabels.lon, lonPos, new THREE.Vector3(0, 0, 0.14));
  }

  const gyroFlashEnv = flashEnvelope(now - (state.motion.gyroFlashStart || 0), GYRO_FLASH_DECAY_MS);
  const gyroTip = updateGyroPolarMeter(meters.gyroPolar, yaw, m4l.gyroMag, gyroFlashEnv);
  meterLabels.gyro.visible = gyroFlashEnv > 0.05 || m4l.gyroMag > p.gyroOnset.threshold * 0.4;
  if (meterLabels.gyro.visible) {
    placeMeterLabel(meterLabels.gyro, gyroTip, new THREE.Vector3(0, 0, 0.14));
  }

  updateLiveHud(m4l, live);

  const piezoScaled = applyThresholdRatioUnsigned(
    sample.piezoEnv,
    p.piezo.threshold,
    p.piezo.ratio,
  );
  const piezoNormalized = clamp(piezoScaled / PIEZO_REFERENCE_MAX, 0, 1);
  chipMaterial.color.copy(piezoColor(piezoNormalized));

  const gridGlowTarget = computeMicGridGlowTarget(sample, frameDt);
  const thermalBgTarget = computePiezoThermalTarget(piezoScaled);
  state.preview.gridGlow = updatePreviewEnvelope(state.preview.gridGlow, gridGlowTarget, frameDt);
  state.preview.thermalBg = updatePreviewEnvelope(state.preview.thermalBg, thermalBgTarget, frameDt);
  updateGridGlow(state.preview.gridGlow);
  updateThermalBackground(state.preview.thermalBg);
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

function formatDisplayValue(id, value) {
  if (id === "hue" || id === "hueRot") {
    return `${Math.round(value)}°`;
  }
  return `${Math.round(value * 100)}%`;
}

function applyDisplayFilter() {
  const d = state.display;
  const hueDeg = ((d.hue + d.hueRot) % 360 + 360) % 360;
  document.body.style.filter = [
    `hue-rotate(${hueDeg}deg)`,
    `saturate(${d.saturation * 100}%)`,
    `brightness(${d.brightness * 100}%)`,
    `contrast(${d.contrast * 100}%)`,
  ].join(" ");
}

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

  const displayGroupEl = document.createElement("div");
  displayGroupEl.className = "param-group param-group-display";
  displayGroupEl.style.setProperty("--group-color", DISPLAY_PARAM_COLORS.hue);

  const displayTitle = document.createElement("span");
  displayTitle.className = "param-group-label";
  displayTitle.textContent = "Color";
  displayGroupEl.appendChild(displayTitle);

  const displayDials = document.createElement("div");
  displayDials.className = "param-group-dials";

  const displayDialRefs = [];

  for (const id of DISPLAY_PARAM_IDS) {
    const spec = DISPLAY_PARAM_SPEC[id];
    const color = DISPLAY_PARAM_COLORS[id];

    const dial = document.createElement("label");
    dial.className = "param-dial";
    dial.style.setProperty("--dial-color", color);
    dial.title = `${spec.short} ${spec.label}`;

    const keyLabel = document.createElement("span");
    keyLabel.className = "param-dial-key";
    keyLabel.textContent = spec.short;

    const ring = document.createElement("div");
    ring.className = "param-dial-ring";

    const pointer = document.createElement("div");
    pointer.className = "param-dial-pointer";

    const input = document.createElement("input");
    input.type = "range";
    input.className = "param-dial-input";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(state.display[id]);
    input.dataset.displayId = id;

    const readout = document.createElement("output");
    readout.className = "param-dial-value";

    ring.appendChild(pointer);
    dial.appendChild(input);
    dial.appendChild(ring);
    dial.appendChild(keyLabel);
    dial.appendChild(readout);
    displayDials.appendChild(dial);

    const syncDisplayDial = () => {
      const value = Number.parseFloat(input.value);
      pointer.style.setProperty("--dial-angle", `${dialAngleDeg(value, spec.min, spec.max)}deg`);
      readout.textContent = formatDisplayValue(id, value);
    };

    input.addEventListener("input", () => {
      const value = Number.parseFloat(input.value);
      state.display[id] = value;
      syncDisplayDial();
      saveDisplayParams(state.display);
      applyDisplayFilter();
    });

    displayDialRefs.push({ id, input, pointer, readout, syncDisplayDial });
    syncDisplayDial();
  }

  displayGroupEl.appendChild(displayDials);
  root.appendChild(displayGroupEl);

  document.querySelector("#paramResetButton")?.addEventListener("click", () => {
    state.params = createDefaultParams();
    state.display = createDefaultDisplayParams();
    saveParams(state.params);
    saveDisplayParams(state.display);
    for (const ref of dialRefs) {
      ref.input.value = String(state.params[ref.id][ref.key]);
      syncDial(ref.id, ref.key, ref.input, ref.pointer, ref.readout);
    }
    for (const ref of displayDialRefs) {
      ref.input.value = String(state.display[ref.id]);
      ref.syncDisplayDial();
    }
    applyDisplayFilter();
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
  applyDisplayFilter();
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
