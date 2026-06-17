# Motion processing modes

## direct (default · ver.20260620a)

**Pitch / Roll / Yaw = bow-frame angular velocity (rad/s)** from MPU6050 gyro, minimal processing.

| Output | Source |
|--------|--------|
| Pitch | `-gx` (nod about bow left) |
| Roll | `-gy` (lean about bow tip) |
| Yaw / yawRate | `gz` (twist about bow up) |
| lX / lY / lZ | `(a - g₀)` → bow frame → **静止時は軸ごと自動ゼロ** → EMA |
| gOn | `hypot(pitchω, rollω, yawω)` threshold |
| lOn | `hypot(lx, ly, lz)` threshold |

- `g₀`: captured while still for ~8 frames at connect (then frozen). **Plus:** while |ω| low, each axis that holds steady drifts to 0 (any bow orientation).
- Pt/Rl/Yw params: **rad/s** (threshold default 0.03).

## tilt (legacy)

Accel gravity `atan2` pitch/roll + gyro yaw integration + LP gravity linear.  
Kept for A/B and revert.

## Revert to tilt

**Viz:** top bar **Motion → Tilt legacy**  
**M4L:** in `hi_motion_core.js` set `MOTION_PROCESS_MODE = "tilt"` and Reload `js hi_bow_router.js`

## Backup files

| File | Purpose |
|------|---------|
| `visualizer/motion_core_tilt_legacy.js` | Frozen tilt-only pipeline (reference) |
| `motion_core.js` mode `tilt` | Live tilt path in same file |
