/**
 * Teensy 4.1 — piezo A0 + MAX4466 A1 CSV test.
 * Upload: pio -d firmware/teensy/piezo_mic_adc_test run -t upload
 */

#include <Arduino.h>

constexpr uint8_t kPiezoPin = A0;
constexpr uint8_t kMicPin = A1;

constexpr uint32_t kSerialBaud = 115200;
constexpr uint32_t kPrintIntervalMs = 50;

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

  Serial.println("=== Teensy piezo + mic ADC test ===");
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

  Serial.printf("%lu,%d,%d,%d,%d\n", now, piezo, mic, gPiezoMax - gPiezoMin, gMicMax - gMicMin);

  gPiezoMin = 4095;
  gPiezoMax = 0;
  gMicMin = 4095;
  gMicMax = 0;
}
