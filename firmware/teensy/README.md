# Teensy 4.1 firmware (Human Instrument)

## Cursor / PlatformIO（XIAO と同じ — Arduino IDE 不要）

各スケッチは **小さな PlatformIO プロジェクト**（`platformio.ini` + `src/main.cpp`）です。  
リポジトリ直下から `-d` でディレクトリを指定して実行します。

### 1. COM ポート（初回だけ）

`platformio_local.ini.example` をリポジトリ直下にコピー → `platformio_local.ini` を編集するか、毎回:

```powershell
pio run --project-dir firmware/teensy/sensor_visualizer -t upload --upload-port COM7
```

### 2. Visualizer 用ファーム（MPU + ピエゾ + マイク）

```powershell
cd "test_Teensy-4.1-Sense"
pio run --project-dir firmware/teensy/sensor_visualizer -t upload
pio device monitor --project-dir firmware/teensy/sensor_visualizer
```

`DATA,...` 行が出れば OK。**monitor 中はブラウザ visualizer が COM を使えない**ので、visualizer の前に `Ctrl+C`。

### 3. ADC のみ（ピエゾ + マイク）

```powershell
pio run --project-dir firmware/teensy/piezo_mic_adc_test -t upload
pio device monitor --project-dir firmware/teensy/piezo_mic_adc_test
```

### ソースの場所

| プロジェクト | ソース |
|--------------|--------|
| `firmware/teensy/sensor_visualizer/` | `src/main.cpp` |
| `firmware/teensy/piezo_mic_adc_test/` | `src/main.cpp` |

`firmware/teensy/*/*.ino` は旧 Arduino IDE 用（編集は **`src/main.cpp`** を正本に）。

### Visualizer

1. `pio device monitor` を止める  
2. `cd visualizer` → `py -m http.server 4173`  
3. http://localhost:4173 → **115200 (Teensy)** → **Connect Serial** → COM7  

配線: [`docs/hardware/BREADBOARD_TEENSY_V0.md`](../../docs/hardware/BREADBOARD_TEENSY_V0.md)
