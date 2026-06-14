/**
 * Teensy 4.1 — MPU6050 + USB Audio stereo (piezo L / mic R) + Serial telemetry.
 *
 * T4.1: AudioInputAnalog (ADC2, A0) + AudioInputMicAdc1 (ADC1, A1).
 * Mag/heading columns stay in DATA (zeros) for M4L/visualizer compatibility.
 */

#include <Arduino.h>
#include <Audio.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include "audio_input_mic_adc1.h"
#include "chip_frame.h"

constexpr uint8_t kPiezoPin = A0;
constexpr uint8_t kMicPin = A1;

constexpr uint32_t kSerialBaud = 115200;
constexpr uint32_t kImuIntervalMs = 10;
constexpr uint32_t kPrintIntervalMs = 50;

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

Adafruit_MPU6050 gMpu;
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
uint32_t gLastImuWarnMs = 0;

float magnitude3(float x, float y, float z) {
  return sqrtf((x * x) + (y * y) + (z * z));
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

bool beginMpuAt(uint8_t address) {
  if (!gMpu.begin(address, &Wire)) {
    Serial.printf("MPU6050 begin 0x%02X: FAILED\n", address);
    return false;
  }
  Serial.printf("MPU6050 begin 0x%02X: OK\n", address);
  return true;
}

void initImu() {
  scanI2c();
  gImuReady = beginMpuAt(0x68);
  if (!gImuReady) {
    gImuReady = beginMpuAt(0x69);
  }
  if (!gImuReady) {
    Serial.println("MPU6050 init: FAILED (check 3.3V, GND, SDA=18, SCL=19, AD0)");
    return;
  }

  gMpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  gMpu.setGyroRange(MPU6050_RANGE_500_DEG);
  gMpu.setFilterBandwidth(MPU6050_BAND_44_HZ);
  Serial.println("MPU6050 ranges: accel +/-4g, gyro +/-500dps, LPF 44Hz");
}

void sampleImu() {
  if (!gImuReady) {
    return;
  }

  sensors_event_t accel;
  sensors_event_t gyro;
  sensors_event_t temp;
  gMpu.getEvent(&accel, &gyro, &temp);

  const float rawAx = accel.acceleration.x;
  const float rawAy = accel.acceleration.y;
  const float rawAz = accel.acceleration.z;
  const float rawGx = gyro.gyro.x;
  const float rawGy = gyro.gyro.y;
  const float rawGz = gyro.gyro.z;

  gAx = mapChipAccelX(rawAx);
  gAy = rawAy;
  gAz = rawAz;
  gGx = mapChipGyroX(rawGx);
  gGy = rawGy;
  gGz = rawGz;

  gMx = 0.0f;
  gMy = 0.0f;
  gMz = 0.0f;
  gAccelMag = magnitude3(gAx, gAy, gAz);
  gGyroMag = magnitude3(gGx, gGy, gGz);
  gMagMag = 0.0f;
  gHeadingDeg = 0.0f;
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
  Serial.println("IMU: MPU6050 (6-axis) | SDA=18 SCL=19 | mag/heading=0");
  Serial.println("USB L=piezo(A0/ADC2) R=mic(A1/ADC1) @ 44.1kHz");
  Serial.println("Chip frame: MPU6050 raw ax..gz (+X~bow tip, see chip_frame.h)");
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
    if (!gImuReady && now - gLastImuWarnMs >= 5000) {
      gLastImuWarnMs = now;
      Serial.println("WARN,IMU,MPU6050 not ready (check 3.3V SDA=18 SCL=19 AD0->GND)");
    }
    printData();
  }
}
