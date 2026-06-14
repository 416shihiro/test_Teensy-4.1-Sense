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

export function accelTilt(sample) {
  const up = sample.az || 0.0001;
  return {
    pitch: Math.atan2(sample.ay, Math.hypot(sample.az, sample.ax) || 1),
    roll: Math.atan2(sample.ax, up),
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

function updateGravityLowPass(sample, motion) {
  const g = motion.gravityLp;
  if (!motion.gravityLpReady) {
    g.x = sample.ax;
    g.y = sample.ay;
    g.z = sample.az;
    motion.gravityLpReady = true;
    return;
  }
  const gyroMag = sample.gyroMag ?? Math.hypot(sample.gx, sample.gy, sample.gz);
  const accelMag = sample.accelMag ?? Math.hypot(sample.ax, sample.ay, sample.az);
  const nearStill =
    Math.abs(accelMag - GRAVITY_MS2) < 2.5 && gyroMag < STILL_GYRO_RAD;
  if (!nearStill) {
    return;
  }
  g.x += GRAVITY_LP_ALPHA * (sample.ax - g.x);
  g.y += GRAVITY_LP_ALPHA * (sample.ay - g.y);
  g.z += GRAVITY_LP_ALPHA * (sample.az - g.z);
}

function linearResponseScale(sample) {
  const gyroMag = sample.gyroMag ?? Math.hypot(sample.gx, sample.gy, sample.gz);
  return clamp(
    1 - (gyroMag - ROTATION_ATTENUATION_START) / ROTATION_ATTENUATION_RANGE,
    0.12,
    1,
  );
}

export function linearAcceleration(sample, motion) {
  updateGravityLowPass(sample, motion);
  const g = motion.gravityLp;
  const spinScale = linearResponseScale(sample);
  const raw = {
    lx: (sample.ax - g.x) * spinScale,
    ly: (sample.ay - g.y) * spinScale,
    lz: (sample.az - g.z) * spinScale,
  };
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
