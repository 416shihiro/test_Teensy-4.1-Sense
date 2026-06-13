/**
 * Teensy 4.1 — ICM-20948 + USB Audio stereo (piezo L / mic R) + Serial telemetry.
 *
 * T4.1: AudioInputAnalogStereo is a stub. Use AudioInputAnalog (ADC2, A0) + AudioInputMicAdc1 (ADC1, A1).
 */

#include <Arduino.h>
#include <Audio.h>
#include <Wire.h>
#include <SPI.h>
#include "ICM_20948.h"
#include "audio_input_mic_adc1.h"
#include "bow_frame.h"

constexpr uint8_t kPiezoPin = A0;
constexpr uint8_t kMicPin = A1;

constexpr uint32_t kSerialBaud = 115200;
constexpr uint32_t kImuIntervalMs = 10;
constexpr uint32_t kPrintIntervalMs = 50;
constexpr float kMgToMetersPerSecondSquared = 0.00980665f;
constexpr float kDegToRad = 0.01745329252f;

constexpr float kPiezoAlpha = 0.10f;
constexpr float kPiezoPeakDecay = 0.96f;
constexpr float kPiezoHitThreshold = 280.0f;
constexpr float kMicAlpha = 0.12f;
constexpr int kAdcCenter = 2048;
constexpr float kAudioToCenteredScale = 2048.0f;

AudioInputAnalog piezoInput(kPiezoPin);
AudioInputMicAdc1 micInput(kMicPin);
AudioAnalyzePeak piezoPeakAnalyzer;
AudioAnalyzePeak micPeakAnalyzer;
AudioOutputUSB usbOutput;

AudioConnection patchPiezoToUsbLeft(piezoInput, 0, usbOutput, 0);
AudioConnection patchMicToUsbRight(micInput, 0, usbOutput, 1);
AudioConnection patchPiezoToAnalyzer(piezoInput, 0, piezoPeakAnalyzer, 0);
AudioConnection patchMicToAnalyzer(micInput, 0, micPeakAnalyzer, 0);

ICM_20948_I2C gImu;
bool gImuReady = false;

float gAx = 0.0f;
float gAy = 0.0f;
float gAz = 0.0f;
float gGx = 0.0f;
float gGy = 0.0f;
float gGz = 0.0f;
float gMx = 0.0f;
float gMy = 0.0f;
float gMz = 0.0f;
float gAccelMag = 0.0f;
float gGyroMag = 0.0f;
float gMagMag = 0.0f;
float gHeadingDeg = 0.0f;

uint16_t gPiezoRaw = 0;
float gPiezoCentered = 0.0f;
float gPiezoEnv = 0.0f;
float gPiezoPeak = 0.0f;
bool gPiezoHit = false;

uint16_t gMicRaw = 0;
float gMicEnv = 0.0f;

uint32_t gLastImuMs = 0;
uint32_t gLastPrintMs = 0;

float magnitude3(float x, float y, float z) {
  return sqrtf((x * x) + (y * y) + (z * z));
}

void applyBowFrame(float sx, float sy, float sz, float& bx, float& by, float& bz) {
  const BowVec3 bow = sensorToBow(sx, sy, sz);
  bx = bow.x;
  by = bow.y;
  bz = bow.z;
}

void scanI2c() {
  Serial.print("I2C scan:");
  bool foundAny = false;
  for (uint8_t address = 1; address < 127; ++address) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.printf(" 0x%02X", address);
      foundAny = true;
    }
  }
  if (!foundAny) {
    Serial.print(" none");
  }
  Serial.println();
}

bool beginIcmWithAd0(uint8_t ad0) {
  gImu.begin(Wire, ad0);
  Serial.printf("ICM-20948 begin AD0=%u: %s\n", ad0, gImu.statusString());
  return gImu.status == ICM_20948_Stat_Ok;
}

void initImu() {
  scanI2c();
  gImuReady = beginIcmWithAd0(0);
  if (!gImuReady) {
    gImuReady = beginIcmWithAd0(1);
  }
  if (!gImuReady) {
    Serial.println("ICM-20948 init: FAILED (check 3.3V, GND, SDA=18, SCL=19, address 0x68/0x69)");
    return;
  }
  Serial.println("ICM-20948 init: OK");
}

void sampleImu() {
  if (!gImuReady || !gImu.dataReady()) {
    return;
  }

  gImu.getAGMT();
  const float rawAx = gImu.accX() * kMgToMetersPerSecondSquared;
  const float rawAy = gImu.accY() * kMgToMetersPerSecondSquared;
  const float rawAz = gImu.accZ() * kMgToMetersPerSecondSquared;
  const float rawGx = gImu.gyrX() * kDegToRad;
  const float rawGy = gImu.gyrY() * kDegToRad;
  const float rawGz = gImu.gyrZ() * kDegToRad;
  const float rawMx = gImu.magX();
  const float rawMy = gImu.magY();
  const float rawMz = gImu.magZ();

  applyBowFrame(rawAx, rawAy, rawAz, gAx, gAy, gAz);
  applyBowFrame(rawGx, rawGy, rawGz, gGx, gGy, gGz);
  applyBowFrame(rawMx, rawMy, rawMz, gMx, gMy, gMz);

  gAccelMag = magnitude3(gAx, gAy, gAz);
  gGyroMag = magnitude3(gGx, gGy, gGz);
  gMagMag = magnitude3(gMx, gMy, gMz);
  gHeadingDeg = bowHeadingDegrees(gMx, gMy, gMz, gAx, gAy, gAz);
}

void updatePiezoTelemetry() {
  float piezoPp = 0.0f;
  if (piezoPeakAnalyzer.available()) {
    piezoPp = max(0.0f, piezoPeakAnalyzer.readPeakToPeak()) * kAudioToCenteredScale;
  }

  gPiezoCentered = piezoPp;
  gPiezoEnv = ((1.0f - kPiezoAlpha) * gPiezoEnv) + (kPiezoAlpha * gPiezoCentered);
  gPiezoPeak = max(gPiezoPeak * kPiezoPeakDecay, gPiezoCentered);
  gPiezoHit = gPiezoEnv >= kPiezoHitThreshold;
  gPiezoRaw = static_cast<uint16_t>(min(4095.0f, gPiezoCentered + static_cast<float>(kAdcCenter)));
}

void updateMicTelemetry() {
  float micPp = 0.0f;
  if (micPeakAnalyzer.available()) {
    micPp = max(0.0f, micPeakAnalyzer.readPeakToPeak()) * kAudioToCenteredScale;
  }

  gMicEnv = ((1.0f - kMicAlpha) * gMicEnv) + (kMicAlpha * micPp);
  gMicRaw = static_cast<uint16_t>(min(4095.0f, micPp + static_cast<float>(kAdcCenter)));
}

void printHeader() {
  Serial.println();
  Serial.println("=== Human Instrument — Teensy stereo USB Audio ===");
  Serial.println("USB L=piezo(A0/ADC2) R=mic(A1/ADC1) @ 44.1kHz");
  Serial.println("Bow frame: +X=tip +Y=left +Z=up | map Ys->Xb Zs->Yb -Xs->Zb");
  Serial.println(
      "DATA,ms,piezoRaw,piezoCentered,piezoEnv,piezoPeak,piezoHit,ax,ay,az,gx,gy,gz,accelMag,gyroMag,micRaw,micEnv,mx,my,mz,magMag,headingDeg");
}

void printData() {
  Serial.printf(
      "DATA,%lu,%u,%.1f,%.1f,%.1f,%u,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%u,%.1f,%.3f,%.3f,%.3f,%.3f,%.1f\n",
      millis(), gPiezoRaw, gPiezoCentered, gPiezoEnv, gPiezoPeak, gPiezoHit ? 1 : 0,
      gAx, gAy, gAz, gGx, gGy, gGz, gAccelMag, gGyroMag, gMicRaw, gMicEnv,
      gMx, gMy, gMz, gMagMag, gHeadingDeg);
}

void setup() {
  Serial.begin(kSerialBaud);
  while (!Serial && millis() < 3000) {
  }
  delay(400);

  AudioMemory(20);
  analogReadResolution(12);

  Wire.begin();
  Wire.setClock(400000);

  initImu();
  printHeader();
}

void loop() {
  const uint32_t now = millis();

  updatePiezoTelemetry();
  updateMicTelemetry();

  if (now - gLastImuMs >= kImuIntervalMs) {
    gLastImuMs = now;
    sampleImu();
  }

  if (now - gLastPrintMs >= kPrintIntervalMs) {
    gLastPrintMs = now;
    printData();
  }
}
