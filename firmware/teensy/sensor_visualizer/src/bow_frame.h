#pragma once

/**
 * ICM-20948 chip frame → Bow frame (Human Instrument).
 *
 * Mount (user, 2026-06-17):
 * - Chip package top (+Z_icm) points toward the bow tip.
 * - Looking from frog toward tip: silkscreen / marking at front-left.
 *
 * Empirical calibration (2026-06-17b):
 * - Horizontal rest + heading: prior Zb=-Xs mapping kept gravity on bow +Z.
 * - Pitch (tip up/down, ω about bow Y) couples to sensor Z, not Y.
 * - Roll (spin about stick, ω about bow X) couples to sensor Y, not Z.
 *
 * Bow frame (right-handed):
 * - +X: toward bow tip
 * - +Y: left when viewing frog → tip
 * - +Z: up (sky)
 *
 * Rotation (sensor s → bow b):
 *   Xb = Ys   (roll about tip)
 *   Yb = Zs   (pitch)
 *   Zb = -Xs  (up / gravity when level)
 */

struct BowVec3 {
  float x;
  float y;
  float z;
};

inline BowVec3 sensorToBow(float sx, float sy, float sz) {
  return {sy, sz, -sx};
}

inline float bowHeadingDegrees(float mx, float my, float mz, float ax, float ay, float az) {
  const float roll = atan2f(ay, az);
  const float pitch = atan2f(-ax, sqrtf((ay * ay) + (az * az)));
  const float sp = sinf(pitch);
  const float cp = cosf(pitch);
  const float sr = sinf(roll);
  const float cr = cosf(roll);

  const float mxh = (mx * cp) + (mz * sp);
  const float myh = (mx * sr * sp) + (my * cr) - (mz * sr * cp);
  float heading = atan2f(myh, mxh) * 180.0f / PI;
  if (heading < 0.0f) {
    heading += 360.0f;
  }
  return heading;
}
