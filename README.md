# test_Teensy 4.1 Sense

**Human Instrument** — Teensy 4.1 有線試作（ピエゾ + MAX4466 + ICM-20948）。

XIAO 版とは別リポジトリです（共通のブラウザ visualizer プロトコル `DATA,...`）。

| 項目 | リンク |
|------|--------|
| XIAO ESP32-S3（hub / schema / Live バックアップ） | [416shihiro/test_XIAO-ESP32-S3-Sense](https://github.com/416shihiro/test_XIAO-ESP32-S3-Sense) |
| 配線・写真 | [`docs/hardware/BREADBOARD_TEENSY_V0.md`](docs/hardware/BREADBOARD_TEENSY_V0.md) |
| USB Audio 手順 | [`docs/USB_AUDIO_SETUP.md`](docs/USB_AUDIO_SETUP.md) |
| 弓軸キャリブ | [`docs/BOW_AXIS_MOUNT.md`](docs/BOW_AXIS_MOUNT.md) |
| ファーム | [`firmware/teensy/README.md`](firmware/teensy/README.md) |

## Quick start（セッション一括）

```powershell
powershell -File scripts\start_session.ps1
```

→ hub（COM8 → UDP 7400 + SSE）+ visualizer `http://localhost:4173/?bridge=1` + ブラウザ自動起動

## 個別起動

```powershell
# ファーム書き込み
pio run --project-dir firmware/teensy/sensor_visualizer -t upload --upload-port COM8

# visualizer のみ
cd visualizer
py -m http.server 4173
```

→ http://localhost:4173 · **Bridge モード**（`?bridge=1`）推奨 · Baud 115200

## アーキテクチャ（2026-06-17）

| 経路 | 内容 |
|------|------|
| **USB Audio** | piezo L / mic R @ 44.1kHz → ASIO4ALL → Ableton Live |
| **USB Serial** | `DATA` **100Hz**（22 列、弓座標 ax…headingDeg）→ PC `serial_hub.py` |
| **hub 出力** | UDP 7400（M4L `udpreceive`）+ SSE :8765（visualizer Bridge） |

hub は **XIAO リポ**の `scripts/serial_hub.py`。COM は hub か Web Serial のどちらか一方のみ。

## Layout

```text
firmware/teensy/
  sensor_visualizer/   # ICM-20948 + USB Audio + Serial DATA
  piezo_mic_adc_test/  # A0/A1 CSV only
visualizer/            # Three.js + Bridge/Web Serial（ver.20260617a）
scripts/
  start_session.ps1    # hub + viz 一括起動
docs/
  BOW_AXIS_MOUNT.md    # 弓軸キャリブ正本
  USB_AUDIO_SETUP.md
  hardware/
```

## Visualizer UI（2026-06-17a）

- 左: 大きめ 3D Preview（X tip · Y left · Z up）
- 右: 縦5段 — Piezo / Mic / Accel / Rotation / Mag
- Connect Bridge（ピンク）= `serial_hub` SSE 購読（Live セッション時はこちら）
