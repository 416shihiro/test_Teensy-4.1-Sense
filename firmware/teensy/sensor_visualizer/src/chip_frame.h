#pragma once

/**
 * MPU6050 chip frame — Human Instrument telemetry.
 *
 * Serial DATA ax…gz / gx…gz are **raw sensor axes** (Adafruit_MPU6050, no remapping).
 * Viz, M4L, and motion math all use this same frame.
 *
 * Mount intent (acrylic tube on bow):
 *   +X = bow tip
 *   +Y = bow left (player's left hand side)
 *   +Z = sky / up
 *
 * Derived angles (motion_core.js / hi_motion_core.js), +X tip convention:
 *   Pitch — nod tip up/down (ω about +Y): atan2(-ax, hypot(ay, az))
 *   Roll  — lean sideways (ω about +X):   atan2(ay, az)
 *   Yaw   — twist (ω about +Z): gyro projected on gravity + integration
 *
 * If one axis sign is wrong after mount check, flip that axis in firmware here
 * (or add optional CHIP_AXIS_FLIP_* defines) — keep viz/M4L in sync.
 */
