#pragma once

/**
 * MPU6050 chip frame — Human Instrument telemetry.
 *
 * Serial DATA ax…gz / gx…gz are MPU6050 axes after mount correction below.
 * Viz, M4L, and motion math all use this same frame.
 *
 * Mount intent (acrylic tube on bow):
 *   +X = bow tip
 *   +Y = bow left (player's left hand side)
 *   +Z = sky / up
 *
 * Silicon → telemetry (sampleImu in main.cpp):
 *   ax, gx negated (CHIP_FLIP_X) — bow tip sign matches acrylic mount
 *
 * Derived angles (motion_core.js / hi_motion_core.js), +X tip convention:
 *   Pitch — nod tip up/down (ω about +Y): atan2(-ax, hypot(ay, az))
 *   Roll  — lean sideways (ω about +X):   atan2(ay, az)
 *   Yaw   — twist (ω about +Z): gyro projected on gravity + integration
 *
 * Linear bow-frame remap (motion_core.js mapBowFrameLinear, after gravity subtract):
 *   bow +X tip  =  chip lx
 *   bow +Y left =  chip lz
 *   bow +Z up   =  chip ly
 */

constexpr float kChipFlipAx = -1.0f;
constexpr float kChipFlipGx = -1.0f;

inline float mapChipAccelX(float raw) {
  return raw * kChipFlipAx;
}

inline float mapChipGyroX(float raw) {
  return raw * kChipFlipGx;
}
