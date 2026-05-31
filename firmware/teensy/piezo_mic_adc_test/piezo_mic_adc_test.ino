/**
 * Teensy 4.1 — first wiring test: piezo on A0, MAX4466 on A1.
 *
 * Wiring: docs/hardware/BREADBOARD_TEENSY_V0.md
 * - Piezo (100k series, 1M parallel) -> pin 14 / A0
 * - MAX4466 OUT -> pin 15 / A1
 * - MPU6050 optional (not used in this sketch)
 *
 * Tools: Board "Teensy 4.1", USB Type "Serial"
 * Serial Monitor: 115200 baud
 */

constexpr uint8_t kPiezoPin = A0;  // Teensy pin 14
constexpr uint8_t kMicPin = A1;    // Teensy pin 15 — MAX4466 OUT

constexpr uint32_t kSerialBaud = 115200;
constexpr uint32_t kPrintIntervalMs = 50;

// Quiet ADC band for "idle" hint (12-bit, adjust if needed)
constexpr int kIdleBand = 80;

int gPiezoMin = 4095;
int gPiezoMax = 0;
int gMicMin = 4095;
int gMicMax = 0;

uint32_t gLastPrintMs = 0;

void setup() {
  Serial.begin(kSerialBaud);
  while (!Serial && millis() < 3000) {
  }

  analogReadResolution(12);

  Serial.println();
  Serial.println("=== Human Instrument — Teensy piezo + mic ADC test ===");
  Serial.println("Board: Teensy 4.1");
  Serial.println("Pins:  A0 (14) = piezo,  A1 (15) = MAX4466 OUT");
  Serial.println("Baud:  115200");
  Serial.println();
  Serial.println("Tap piezo / speak into mic — values should move.");
  Serial.println("If mic stuck high (~4095), turn MAX4466 gain DOWN.");
  Serial.println("If mic barely moves, turn gain UP (check direction on your board).");
  Serial.println();
  Serial.println("ms,piezo,mic,piezo_pp,mic_pp");
}

void loop() {
  const int piezo = analogRead(kPiezoPin);
  const int mic = analogRead(kMicPin);

  gPiezoMin = min(gPiezoMin, piezo);
  gPiezoMax = max(gPiezoMax, piezo);
  gMicMin = min(gMicMin, mic);
  gMicMax = max(gMicMax, mic);

  const uint32_t now = millis();
  if (now - gLastPrintMs < kPrintIntervalMs) {
    return;
  }
  gLastPrintMs = now;

  const int piezoPp = gPiezoMax - gPiezoMin;
  const int micPp = gMicMax - gMicMin;

  Serial.printf("%lu,%d,%d,%d,%d\n", now, piezo, mic, piezoPp, micPp);

  // Human-readable hints every ~1 s
  static uint32_t lastHintMs = 0;
  if (now - lastHintMs >= 1000) {
    lastHintMs = now;
    if (mic > 4000) {
      Serial.println("# hint: mic near max — reduce MAX4466 gain");
    } else if (micPp < kIdleBand) {
      Serial.println("# hint: mic quiet — increase gain or check wiring (OUT->A1, 3.3V)");
    }
    if (piezoPp < kIdleBand) {
      Serial.println("# hint: piezo quiet — tap harder or check A0 wiring");
    }
  }

  gPiezoMin = 4095;
  gPiezoMax = 0;
  gMicMin = 4095;
  gMicMax = 0;
}
