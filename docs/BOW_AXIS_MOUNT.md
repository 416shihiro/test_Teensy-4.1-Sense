# MPU6050 chip axis mount

## Physical mount (acrylic tube on bow)

- Telemetry `DATA` ax…gz / gx…gz are **raw MPU6050 chip axes** (no firmware remapping).
- Mount intent: **+X = bow tip**, **+Y = bow left**, **+Z = sky / up** (match by eye in the acrylic tube).

## Chip frame (serial + M4L + viz)

| Axis | Intent |
|------|--------|
| **+X** | Bow tip (pink arrow in 3D preview) |
| **+Y** | Bow left (player's left-hand side) |
| **+Z** | Sky / up |

Documented in `firmware/teensy/sensor_visualizer/src/chip_frame.h`.

## Derived angles (motion_core.js / hi_motion_core.js)

Assumes +X tip convention:

| Param | Meaning | ω axis |
|-------|---------|--------|
| **Pitch** (rotX) | Nod tip up/down | +Y |
| **Roll** (rotZ) | Lean sideways | +X |
| **Yaw** (rotY) | Twist (integrated) | +Z |

```
pitch = atan2(-ax, hypot(ay, az))
roll  = atan2(ay, az)
```

## 3D preview (browser viz)

- Sensor **fixed** at origin; axes = chip X/Y/Z (red/green/blue).
- Pink arrow fixed on **+X**.
- Bars / rings show **values sent to Live** (after threshold), not gravity tilt.

## Verify

1. Bow level: note which ax/ay/az ≈ ±9.81 — confirms chip orientation.
2. Nod tip: **Pt** bar (red) moves; tune rotX threshold until it feels right.
3. If one axis sign is wrong: flip that axis in `chip_frame.h` (firmware) and keep viz/M4L in sync.

## Graph colors

- Red = X
- Green = Y
- Blue = Z
