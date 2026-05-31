# test_Teensy 4.1 Sense

**Human Instrument** — Teensy 4.1 有線試作（ピエゾ + MAX4466 + MPU6050）。

XIAO 版とは別リポジトリです（共通のブラウザ visualizer プロトコル `DATA,...`）。

| 項目 | リンク |
|------|--------|
| XIAO ESP32-S3 | [416shihiro/test_XIAO-ESP32-S3-Sense](https://github.com/416shihiro/test_XIAO-ESP32-S3-Sense) |
| 配線・写真 | [`docs/hardware/BREADBOARD_TEENSY_V0.md`](docs/hardware/BREADBOARD_TEENSY_V0.md) |
| ファーム | [`firmware/teensy/README.md`](firmware/teensy/README.md) |

## Quick start

```powershell
pio run --project-dir firmware/teensy/sensor_visualizer -t upload --upload-port COM7
cd visualizer
py -m http.server 4173
```

→ http://localhost:4173 · **Baud 115200** · **Connect Serial**

## Layout

```text
firmware/teensy/
  sensor_visualizer/   # MPU + piezo + mic → visualizer
  piezo_mic_adc_test/  # A0/A1 CSV only
visualizer/            # Web Serial + Three.js（XIAO 版と同系）
docs/hardware/         # ブレッドボード正本 + 写真
```
