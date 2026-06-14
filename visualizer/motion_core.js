/**
 * Shared M4L motion math (browser visualizer + Max v8 hi_motion_core.js mirror).
 */
export const GRAVITY_MS2 = 9.81;
export const STILL_GYRO_RAD = 0.1;
export const GRAVITY_LP_ALPHA = 0.07;
export const LINEAR_SMOOTH_ALPHA = 0.58;
export const ROTATION_ATTENUATION_START = 0.04;
export const ROTATION_ATTENUATION_RANGE = 0.22;

export function createMotionState() {
  return {
    yaw: 0,
    gravityLp: { x: 0, y: 0, z: GRAVITY_MS2 },
    gravityLpReady: false,
    smoothLinear: { lx: 0, ly: 0, lz: 0 },
    lastSampleMs: 0,
    onset: {
      gyro: { armed: true },
      lin: { armed: true },
    },
  };
}

/**
 * Chip-frame tilt from gravity (ax,ay,az = MPU6050 raw telemetry).
 * Mount intent: +X bow tip, +Y bow left, +Z sky — see chip_frame.h.
 */
export function accelTilt(sample) {
  const horiz = Math.hypot(sample.ay, sample.az) || 1;
  return {
    pitch: Math.atan2(-sample.ax, horiz),
    roll: Math.atan2(sample.ay, sample.az || 1),
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

/**
 * Acrylic-tube mount (measured): chip axes ≠ bow labels on silkscreen.
 * Subtract gravity in chip frame first, then map to bow frame for viz/M4L.
 *
 *   bow +X tip  =  chip lx   (ax/gx sign corrected in Teensy firmware)
 *   bow +Y left =  chip lz
 *   bow +Z up   =  chip ly
 */
export function mapBowFrameLinear(chipLinear) {
  return {
    lx: chipLinear.lx,
    ly: chipLinear.lz,
    lz: chipLinear.ly,
  };
}

export function linearAcceleration(sample, motion) {
  const g = estimateGravityVector(sample, motion);
  const spinScale = linearResponseScale(sample);
  const rawChip = {
    lx: (sample.ax - g.x) * spinScale,
    ly: (sample.ay - g.y) * spinScale,
    lz: (sample.az - g.z) * spinScale,
  };
  const raw = mapBowFrameLinear(rawChip);
  const smooth = motion.smoothLinear;
  smooth.lx += LINEAR_SMOOTH_ALPHA * (raw.lx - smooth.lx);
  smooth.ly += LINEAR_SMOOTH_ALPHA * (raw.ly - smooth.ly);
  smooth.lz += LINEAR_SMOOTH_ALPHA * (raw.lz - smooth.lz);
  return { ...smooth };
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
  let dt = 0.05;
  if (motion.lastSampleMs > 0 && ms > motion.lastSampleMs) {
    dt = (ms - motion.lastSampleMs) / 1000;
    dt = clamp(dt, 0.001, 0.2);
  }
  if (ms > 0) {
    motion.lastSampleMs = ms;
  }
  return dt;
}

export function processM4lMotion(sample, params, motion, options = {}) {
  const integrateYawFlag = options.integrateYaw !== false;
  if (integrateYawFlag) {
    const dt = options.dt ?? packetDeltaSeconds(sample, motion);
    integrateYaw(sample, motion, params, dt);
  }

  const { pitch, roll } = accelTilt(sample);
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
  };
}
