# Bow axis mount (ICM-20948)

## Physical mount

- Chip package **top (+Z_icm)** points toward the **bow tip**.
- Looking **frog → tip**: silkscreen / marking at **front-left**.

## Bow frame (telemetry `DATA` ax…gz, mx…headingDeg)

| Axis | Direction |
|------|-----------|
| **+X** | Bow tip (roll / spin about stick) |
| **+Y** | Left (frog→tip view); pitch (tip up/down) |
| **+Z** | Up (sky); gravity when level |

## Sensor → bow rotation (calibrated 2026-06-17b)

Pitch and roll couple to ICM Y/Z, not the naive Z/Y tip alignment:

```
Xb = Ys   // roll ω about tip
Yb = Zs   // pitch ω
Zb = -Xs  // up; horizontal rest → az ≈ +9.81
```

Implemented in `firmware/teensy/sensor_visualizer/src/bow_frame.h`.

`headingDeg` uses tilt-compensated magnetometer in bow frame (unchanged).

## Verify

1. Bow horizontal: **az ≈ +9.81**, ax/ay small; **headingDeg** stable.
2. **Tip up/down (pitch)**: Rotation **Y** (green), Accel Y/Z move.
3. **Spin about stick (roll)**: Rotation **X** (red).
4. Heading still OK when rotating bow in horizontal plane.

If one axis sign is inverted only, flip that row in `bow_frame.h`.

## Graph colors

- Red = X (tip / roll)
- Green = Y (left / pitch)
- Blue = Z (up)
