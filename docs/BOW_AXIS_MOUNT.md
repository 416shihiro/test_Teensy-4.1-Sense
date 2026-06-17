# MPU6050 chip axis mount

## Physical mount (acrylic tube on bow)

Telemetry `DATA` ax…gz / gx…gz: MPU6050 chip axes after `mapChipAccelX` / `mapChipGyroX` in firmware.

**Measured 2026-06 (user verify):** silkscreen bow labels vs chip axes:

| Bow label | Chip axis |
|-----------|-----------|
| **+X tip** (pink arrow) | **-Y** chip |
| **+Y left** | **-X** chip |
| **+Z up** | **+Z** chip |

Documented in `firmware/teensy/sensor_visualizer/src/chip_frame.h`.

## Linear accel (viz + M4L)

After gravity subtract in chip frame (`motion_core.js` / `hi_motion_core.js`):

| Bow | Formula |
|-----|---------|
| Lin tip (red) | `lx = -ay` |
| Lin left (green) | `ly = -ax` |
| Lin up (blue) | `lz = az` |

## Pitch / Roll

Bow-frame gravity: `bx=-ay`, `by=-ax`, `bz=az` after rotating chip `(ax,ay)` by **integrated gyro yaw** (`motion.yaw`).

```
pitch = atan2(bx, hypot(by, bz))   // nod tip
roll  = atan2(by, hypot(bx, bz))   // lean sideways
```

| Param | Meaning |
|-------|---------|
| **Pitch** (rotX) | Nod tip up/down |
| **Roll** (rotZ) | Lean sideways |
| **Yaw** (rotY) | Twist (gyro on gravity) |

## 3D preview

- Fixed chip axes at origin: red=X, green=Y, blue=Z (MPU6050 chip).
- Pink arrow = bow **tip** direction (along chip **-Y**).
- Linear bars use **bow** labels (tip/left/up) after `mapBowFrameLinear`.

## Verify

1. Level: **az ≈ +9.8**, ax/ay ≈ 0.
2. **Tip+** (弓先方向) → **赤 Lin tip** のみ +.
3. **左+** → **緑 Lin left** のみ +.
4. **Pitch**（先を上下）→ **Pitch** リングのみ（Roll が主に動かない）.
5. **Roll**（横に傾ける）→ **Roll** リングのみ.

符号が逆なら `chip_frame.h` の `kChipFlipAx` または map の符号を1軸だけ反転。

## Graph colors

- Red = Lin tip
- Green = Lin left
- Blue = Lin up
