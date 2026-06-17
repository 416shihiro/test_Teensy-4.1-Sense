/**
 * Shared M4L motion math (browser visualizer + Max hi_motion_core.js mirror).
 *
 * Modes:
 *   direct — gyro ω in bow frame + fixed g₀ linear (default)
 *   tilt   — accel gravity pitch/roll + LP gravity linear (legacy)
 *
 * Revert reference: motion_core_tilt_legacy.js
 */
export const GRAVITY_MS2 = 9.81;
export const STILL_GYRO_RAD = 0.1;
export const GRAVITY_LP_ALPHA = 0.07;
export const LINEAR_SMOOTH_ALPHA = 0.58;
export const ROTATION_ATTENUATION_START = 0.04;
export const ROTATION_ATTENUATION_RANGE = 0.22;
export const MOTION_MODE_DIRECT = "direct";
export const MOTION_MODE_TILT = "tilt";
export const DEFAULT_MOTION_MODE = MOTION_MODE_DIRECT;
export const GRAVITY_CALIB_FRAMES = 8;
export const LIN_ONSET_BASELINE_ALPHA = 0.05;
/** Per-axis bow linear zero when still (on top of g₀). */
export const LIN_ZERO_TRACK_ALPHA = 0.04;
export const LIN_ZERO_TRACK_LP = 0.18;
export const LIN_ZERO_STABLE_DELTA = 0.14;

export function resolveMotionMode(options) {
  const mode = options?.mode;
  if (mode === MOTION_MODE_TILT || mode === MOTION_MODE_DIRECT) {
    return mode;
  }
  return DEFAULT_MOTION_MODE;
}

export function createMotionState() {
  return {
    yaw: 0,
    gravityLp: { x: 0, y: 0, z: GRAVITY_MS2 },
    gravityLpReady: false,
    gravityRef: null,
    calibStreak: 0,
    calibAccum: null,
    smoothLinear: { lx: 0, ly: 0, lz: 0 },
    linMagBaseline: null,
    prevInstantLinMag: null,
    linBowOffset: { lx: 0, ly: 0, lz: 0 },
    linBowTrack: { lx: 0, ly: 0, lz: 0 },
    linBowPrev: { lx: 0, ly: 0, lz: 0 },
    lastSampleMs: 0,
    onset: {
      gyro: { armed: true },
      lin: { armed: true },
    },
  };
}

/**
 * Bow-frame angular rates from chip gyro (tip=-chip Y, left=-chip X, up=+chip Z).
 */
export function mapBowFrameGyro(sample) {
  return {
    pitch: -sample.gx,
    roll: -sample.gy,
    yawRate: sample.gz,
  };
}

/**
 * Bow pitch/roll from gravity — tilt mode only.
 */
export function accelTilt(sample, yawRad) {
  const yaw = yawRad || 0;
  const ax = sample.ax;
  const ay = sample.ay;
  const az = sample.az || GRAVITY_MS2;
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  const axB = c * ax - s * ay;
  const ayB = s * ax + c * ay;
  const bx = -ayB;
  const by = -axB;
  const bz = az;
  const pitchHoriz = Math.hypot(by, bz) || 1;
  const rollHoriz = Math.hypot(bx, bz) || 1;
  return {
    pitch: Math.atan2(bx, pitchHoriz),
    roll: Math.atan2(by, rollHoriz),
  };
}

export function computeYawRate(sample) {
  const gravityMag = Math.hypot(sample.ax, sample.ay, sample.az) || GRAVITY_MS2;
  const ux = sample.ax / gravityMag;
  const uy = sample.ay / gravityMag;
  const uz = sample.az / gravityMag;
  return sample.gx * ux + sample.gy * uy + sample.gz * uz;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function scaledGravityFromAccel(sample) {
  const accelMag = sample.accelMag ?? Math.hypot(sample.ax, sample.ay, sample.az);
  const scale = GRAVITY_MS2 / (accelMag || GRAVITY_MS2);
  return {
    x: sample.ax * scale,
    y: sample.ay * scale,
    z: sample.az * scale,
  };
}

function estimateGravityVector(sample, motion) {
  const g = motion.gravityLp;
  const gyroMag = sample.gyroMag ?? Math.hypot(sample.gx, sample.gy, sample.gz);
  const accelMag = sample.accelMag ?? Math.hypot(sample.ax, sample.ay, sample.az);
  const gravDelta = Math.abs(accelMag - GRAVITY_MS2);
  const nearStill = gravDelta < 3.0 && gyroMag < STILL_GYRO_RAD && accelMag > 1;

  if (nearStill) {
    const instant = scaledGravityFromAccel(sample);
    g.x = instant.x;
    g.y = instant.y;
    g.z = instant.z;
    motion.gravityLpReady = true;
    return instant;
  }

  if (!motion.gravityLpReady) {
    const instant = scaledGravityFromAccel(sample);
    g.x = instant.x;
    g.y = instant.y;
    g.z = instant.z;
    motion.gravityLpReady = true;
    return instant;
  }

  if (gravDelta < 4.5) {
    const alpha = GRAVITY_LP_ALPHA * 0.18;
    const instant = scaledGravityFromAccel(sample);
    g.x += alpha * (instant.x - g.x);
    g.y += alpha * (instant.y - g.y);
    g.z += alpha * (instant.z - g.z);
  }

  return { x: g.x, y: g.y, z: g.z };
}

function linearResponseScale(sample) {
  const gyroMag = sample.gyroMag ?? Math.hypot(sample.gx, sample.gy, sample.gz);
  return clamp(
    1 - (gyroMag - ROTATION_ATTENUATION_START) / ROTATION_ATTENUATION_RANGE,
    0.12,
    1,
  );
}

function maybeCalibrateGravityRef(sample, motion) {
  if (motion.gravityRef) {
    return;
  }
  const gyroMag = sample.gyroMag ?? Math.hypot(sample.gx, sample.gy, sample.gz);
  const accelMag = sample.accelMag ?? Math.hypot(sample.ax, sample.ay, sample.az);
  if (gyroMag > STILL_GYRO_RAD || Math.abs(accelMag - GRAVITY_MS2) > 3.5 || accelMag < 1) {
    motion.calibStreak = 0;
    motion.calibAccum = null;
    return;
  }
  motion.calibStreak = (motion.calibStreak || 0) + 1;
  if (!motion.calibAccum) {
    motion.calibAccum = { x: 0, y: 0, z: 0, n: 0 };
  }
  motion.calibAccum.x += sample.ax;
  motion.calibAccum.y += sample.ay;
  motion.calibAccum.z += sample.az;
  motion.calibAccum.n += 1;
  if (motion.calibStreak >= GRAVITY_CALIB_FRAMES) {
    const n = motion.calibAccum.n;
    motion.gravityRef = {
      x: motion.calibAccum.x / n,
      y: motion.calibAccum.y / n,
      z: motion.calibAccum.z / n,
    };
  }
}

/**
 * Chip Δa → bow linear (tip=-chip Y, left=-chip X). See chip_frame.h.
 */
export function mapBowFrameLinear(chipLinear) {
  return {
    lx: -chipLinear.ly,
    ly: -chipLinear.lx,
    lz: chipLinear.lz,
  };
}

function smoothBowLinear(raw, motion) {
  const smooth = motion.smoothLinear;
  smooth.lx += LINEAR_SMOOTH_ALPHA * (raw.lx - smooth.lx);
  smooth.ly += LINEAR_SMOOTH_ALPHA * (raw.ly - smooth.ly);
  smooth.lz += LINEAR_SMOOTH_ALPHA * (raw.lz - smooth.lz);
  return { lx: smooth.lx, ly: smooth.ly, lz: smooth.lz };
}

/** Tilt mode: LP gravity estimate + spin attenuation. */
export function linearAcceleration(sample, motion) {
  const g = estimateGravityVector(sample, motion);
  const spinScale = linearResponseScale(sample);
  const rawChip = {
    lx: (sample.ax - g.x) * spinScale,
    ly: (sample.ay - g.y) * spinScale,
    lz: (sample.az - g.z) * spinScale,
  };
  return smoothBowLinear(mapBowFrameLinear(rawChip), motion);
}

/**
 * When gyro is low and each bow axis is steady, pull offset toward reading → output → 0.
 */
function applyAdaptiveLinZero(bowLinear, motion, gyroMag) {
  if ((gyroMag ?? 0) > STILL_GYRO_RAD) {
    return bowLinear;
  }
  const o = motion.linBowOffset;
  const t = motion.linBowTrack;
  const prev = motion.linBowPrev;
  const out = { lx: bowLinear.lx, ly: bowLinear.ly, lz: bowLinear.lz };
  for (const axis of ["lx", "ly", "lz"]) {
    const v = bowLinear[axis];
    const jerk = Math.abs(v - prev[axis]);
    prev[axis] = v;
    t[axis] += LIN_ZERO_TRACK_LP * (v - t[axis]);
    if (jerk < LIN_ZERO_STABLE_DELTA) {
      o[axis] += LIN_ZERO_TRACK_ALPHA * (t[axis] - o[axis]);
    }
    out[axis] = v - o[axis];
  }
  return out;
}

/** Direct mode: g₀ subtract + per-axis adaptive zero when still. */
export function linearAccelerationDirect(sample, motion) {
  maybeCalibrateGravityRef(sample, motion);
  const g = motion.gravityRef || { x: 0, y: 0, z: GRAVITY_MS2 };
  const gyroMag = sample.gyroMag ?? Math.hypot(sample.gx, sample.gy, sample.gz);
  const rawChip = {
    lx: sample.ax - g.x,
    ly: sample.ay - g.y,
    lz: sample.az - g.z,
  };
  const rawBow = mapBowFrameLinear(rawChip);
  const zeroedBow = applyAdaptiveLinZero(rawBow, motion, gyroMag);
  const smoothed = smoothBowLinear(zeroedBow, motion);
  return { ...smoothed, rawBow: zeroedBow };
}

/** Tap/shake magnitude for lOn — high-pass + jerk (direct mode; ignores tilt offset). */
export function directLinOnsetMagnitude(rawBow, motion, gyroMag) {
  const instantMag = Math.hypot(rawBow.lx, rawBow.ly, rawBow.lz);
  if (motion.linMagBaseline == null) {
    motion.linMagBaseline = instantMag;
  }
  if ((gyroMag ?? 0) < STILL_GYRO_RAD) {
    motion.linMagBaseline +=
      LIN_ONSET_BASELINE_ALPHA * (instantMag - motion.linMagBaseline);
  }
  const highPass = Math.max(0, instantMag - motion.linMagBaseline);
  const prev = motion.prevInstantLinMag ?? instantMag;
  const jerk = Math.abs(instantMag - prev);
  motion.prevInstantLinMag = instantMag;
  return Math.max(highPass, jerk);
}

export function integrateYaw(sample, motion, params, dt) {
  if ((sample.magMag ?? 0) > 1 && Number.isFinite(sample.headingDeg)) {
    motion.yaw = (sample.headingDeg * Math.PI) / 180;
    return;
  }
  const yawRate = computeYawRate(sample);
  const rotY = params.rotY ?? { threshold: 0.03, ratio: 1 };
  if (Math.abs(yawRate) <= rotY.threshold) {
    return;
  }
  const gatedRate =
    Math.sign(yawRate) * (Math.abs(yawRate) - rotY.threshold) * rotY.ratio;
  motion.yaw += gatedRate * dt;
}

export function detectMagnitudeOnset(value, armedState, threshold, rearmRatio) {
  const rearmLevel = threshold * rearmRatio;
  let onset = 0;
  if (!armedState.armed) {
    if (value <= rearmLevel) {
      armedState.armed = true;
    }
  } else if (value > threshold) {
    armedState.armed = false;
    onset = 1;
  }
  return onset;
}

export function packetDeltaSeconds(sample, motion) {
  const ms = sample.ms || 0;
  let dt = 0.01;
  if (motion.lastSampleMs > 0 && ms > motion.lastSampleMs) {
    dt = (ms - motion.lastSampleMs) / 1000;
    dt = clamp(dt, 0.001, 0.2);
  }
  if (ms > 0) {
    motion.lastSampleMs = ms;
  }
  return dt;
}

function bowFrameGyroMag(gyro) {
  return Math.hypot(gyro.pitch, gyro.roll, gyro.yawRate);
}

function processM4lMotionTilt(sample, params, motion, options) {
  const integrateYawFlag = options.integrateYaw !== false;
  if (integrateYawFlag) {
    const dt = options.dt ?? packetDeltaSeconds(sample, motion);
    integrateYaw(sample, motion, params, dt);
  }

  const { pitch, roll } = accelTilt(sample, motion.yaw);
  const linear = linearAcceleration(sample, motion);
  const gyroMag = sample.gyroMag ?? Math.hypot(sample.gx, sample.gy, sample.gz);
  const linMag = Math.hypot(linear.lx, linear.ly, linear.lz);
  const yawRate = computeYawRate(sample);

  const gyroOnset = detectMagnitudeOnset(
    gyroMag,
    motion.onset.gyro,
    params.gyroOnset.threshold,
    params.gyroOnset.ratio,
  );
  const linOnset = detectMagnitudeOnset(
    linMag,
    motion.onset.lin,
    params.linOnset.threshold,
    params.linOnset.ratio,
  );

  return {
    pitch,
    roll,
    yaw: motion.yaw,
    yawRate,
    lx: linear.lx,
    ly: linear.ly,
    lz: linear.lz,
    gyroMag,
    linMag,
    gyroOnset,
    linOnset,
    motionMode: MOTION_MODE_TILT,
  };
}

function processM4lMotionDirect(sample, params, motion) {
  const gyro = mapBowFrameGyro(sample);
  const linear = linearAccelerationDirect(sample, motion);
  const gyroMag = bowFrameGyroMag(gyro);
  const linMag = Math.hypot(linear.lx, linear.ly, linear.lz);
  const linOnsetMag = directLinOnsetMagnitude(linear.rawBow, motion, gyroMag);

  const gyroOnset = detectMagnitudeOnset(
    gyroMag,
    motion.onset.gyro,
    params.gyroOnset.threshold,
    params.gyroOnset.ratio,
  );
  const linOnset = detectMagnitudeOnset(
    linOnsetMag,
    motion.onset.lin,
    params.linOnset.threshold,
    params.linOnset.ratio,
  );

  return {
    pitch: gyro.pitch,
    roll: gyro.roll,
    yaw: gyro.yawRate,
    yawRate: gyro.yawRate,
    lx: linear.lx,
    ly: linear.ly,
    lz: linear.lz,
    gyroMag,
    linMag,
    linOnsetMag,
    gyroOnset,
    linOnset,
    motionMode: MOTION_MODE_DIRECT,
  };
}

export function processM4lMotion(sample, params, motion, options = {}) {
  const mode = resolveMotionMode(options);
  if (mode === MOTION_MODE_TILT) {
    return processM4lMotionTilt(sample, params, motion, options);
  }
  return processM4lMotionDirect(sample, params, motion);
}
