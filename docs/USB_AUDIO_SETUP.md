# Teensy USB Audio — Live 接続手順

## 1本のUSBで2つ出る（複合デバイス）

```
Teensy USBケーブル 1本
  ├─ オーディオ入力（44.1kHz, 2ch）  → Ableton Live
  └─ COMポート（115200, DATA 20Hz）  → serial_hub.py → M4L + visualizer
```

**「hub」は Teensy の中ではない。** PC 上の `serial_hub.py` が Serial の正本。
Teensy の仕事は **リアルタイム ADC + IMU + USB 出力**。

---

## ファーム書き込み

```powershell
cd test_Teensy-4.1-Sense
pio run --project-dir firmware/teensy/sensor_visualizer -t upload
```

初回は USB タイプが変わるので、Windows がドライバを再認識する（10〜30秒）。

---

## Windows で確認

1. **サウンド設定** → 入力に `Teensy` / `Audio` が出る
2. **デバイスマネージャ** → `ポート (COM)` に Teensy Serial（例 COM7）
3. 入力レベルメータが piezo/mic に反応するか

チャンネル割当（ファーム固定）:

| USB ch | ピン | センサー |
|--------|------|----------|
| L (0) | A0 | piezo |
| R (1) | A1 | mic (MAX4466) |

---

## Ableton Live 設定

1. **Preferences → Audio**
   - Input Device = **Teensy**（名称は環境による）
   - Sample Rate = **44100**
2. **オーディオトラック**（例 Track4「Rope 09 auto」）
   - Audio From = Teensy **1/2**（ステレオ）
   - Monitor = **In**
3. 既存 M4L `HI_Rope09_Analyzer` の `plugin~` にそのまま入る
   - `plugin~` outlet0 (L) = piezo
   - `plugin~` outlet1 (R) = mic

---

## Serial テレメトリ（20Hz）

音声とは別経路。M4L の Macro / pluck 用。

```powershell
# XIAO repo（または scripts のある場所）
python scripts\serial_to_udp.py --port COM7 --baud 115200 --udp-port 7400
```

（のちに `serial_hub.py` + visualizer Bridge に拡張）

M4L 側は変更なし:

```
object box: udpreceive 7400
```

---

## 今日〜明後日の進め方

| 日 | やること |
|----|----------|
| 今日 | ファーム書き込み → Live で Teensy 入力が鳴るか確認 |
| 明日 | `plugin~` → piezo/mic チェーン接続、20Hz UDP 併用、レベル調整 |
| 明後日 | Corpus / fluid 音色決め（シンセ本番） |

---

## よくある問題

**COM番号が変わった**  
USB タイプ変更後は COM7 → 別番号になり得る。デバイスマネージャで確認。

**音が出ない**  
- Live の Input Device が Teensy か
- トラック Monitor = In か
- piezo に 100kΩ で GND 負荷があるか

**Serial が取れない**  
- `serial_to_udp.py` と visualizer Web Serial は **同時不可**（COM 独占）
- ライブ前に Python ブリッジだけ起動

**piezoHit の感度が変わった**  
Audio 経路のピーク検出に切り替えたため、`kPiezoHitThreshold` の再調整が必要な場合あり。

---

## Teensy の処理能力が活きる理由

- **Audio ライブラリ**: DMA で 44.1kHz サンプリング（CPU を占有しない）
- **IMU + エンベロープ + Serial**: 別スレッド的に並行、20Hz なら余裕
- **1チップで** センサー融合 → 低遅延 USB 音声 → テレメトリ、まで完結

PC の Python hub は「配線分岐」だけ。重い処理は Teensy と Live/M4L 側。
