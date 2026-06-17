#pragma once

/**
 * MPU6050 chip frame — Human Instrument telemetry.
 *
 * Serial DATA ax…gz / gx…gz are MPU6050 axes after mount correction below.
 * Viz, M4L, and motion math all use this same frame.
 *
 * Measured mount (acrylic tube, MPU6050, 2026-06) — bow labels vs chip telemetry:
 *   bow +X tip  = chip -Y   (motion: lx_bow = -ay)
 *   bow +Y left = chip -X   (motion: ly_bow = -ax)
 *   bow +Z up   = chip +Z   (motion: lz_bow = az)
 *
 * Silicon → telemetry (sampleImu in main.cpp):
 *   ax, gx negated (CHIP_FLIP_X)
 *
 * Tilt (motion_core.js accelTilt) — bow-frame gravity (bx=-ay, by=-ax, bz=az):
 *   pitch = nod tip (ω about bow left)  → atan2(bx, hypot(by, bz))
 *   roll  = lean sideways (ω about tip)   → atan2(by, hypot(bx, bz))
 *   tilt: rotate (ax,ay) by -motion.yaw (gyro-integrated) before pitch/roll
 */

constexpr float kChipFlipAx = -1.0f;
constexpr float kChipFlipGx = -1.0f;

inline float mapChipAccelX(float raw) {
  return raw * kChipFlipAx;
}

inline float mapChipGyroX(float raw) {
  return raw * kChipFlipGx;
}
