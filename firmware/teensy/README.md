# Teensy 4.1 firmware (Human Instrument)

## Cursor / PlatformIO（Arduino IDE 不要）

各スケッチは **小さな PlatformIO プロジェクト**（`platformio.ini` + `src/main.cpp`）です。  
リポジトリ直下から `--project-dir` でディレクトリを指定して実行します。

初回ビルド時、PlatformIO が **SparkFun ICM-20948** ライブラリを自動取得します（`lib_deps`）。

### 1. COM ポート

```powershell
pio run --project-dir firmware/teensy/sensor_visualizer -t upload --upload-port COM8
```

### 2. Visualizer 用ファーム（ICM-20948 + USB Audio + Serial）

```powershell
cd test_Teensy-4.1-Sense
pio run --project-dir firmware/teensy/sensor_visualizer -t upload
```

- **USB Audio**: piezo L / mic R @ 44.1kHz → Live（ASIO4ALL）
- **Serial**: `DATA` **100Hz**（22 列、MPU6050 チップ生座標 `chip_frame.h`）
- 手順: [`docs/USB_AUDIO_SETUP.md`](../../docs/USB_AUDIO_SETUP.md)
- 弓軸: [`docs/BOW_AXIS_MOUNT.md`](../../docs/BOW_AXIS_MOUNT.md)

### 3. セッション一括起動（hub + visualizer）

```powershell
powershell -File scripts\start_session.ps1
```

→ `serial_hub.py`（XIAO リポ）+ `http://localhost:4173/?bridge=1`

### 4. ADC のみ（ピエゾ + マイク）

```powershell
pio run --project-dir firmware/teensy/piezo_mic_adc_test -t upload
pio device monitor --project-dir firmware/teensy/piezo_mic_adc_test
```

### ソースの場所

| プロジェクト | ソース |
|--------------|--------|
| `firmware/teensy/sensor_visualizer/` | `src/main.cpp`, `chip_frame.h` |
| `firmware/teensy/piezo_mic_adc_test/` | `src/main.cpp` |

配線: [`docs/hardware/BREADBOARD_TEENSY_V0.md`](../../docs/hardware/BREADBOARD_TEENSY_V0.md)
