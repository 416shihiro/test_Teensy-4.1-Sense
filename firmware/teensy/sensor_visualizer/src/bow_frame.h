#pragma once

/**
 * Sensor chip frame → Bow frame (Human Instrument).
 *
 * Calibrated on ICM-20948 mount (2026-06-17b). Reused for MPU6050 when the
 * breakout is mounted the same way on the bow (chip axes aligned to bow tip/left/up).
 *
 * Mount intent:
 * - Package top (+Z_sensor) toward bow tip
 * - Frog→tip view: marking at front-left
 *
 * Bow frame: +X tip, +Y left, +Z up
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
