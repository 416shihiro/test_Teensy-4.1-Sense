/**
 * Teensy 4.1 — MPU6050 + piezo + MAX4466 for browser visualizer.
 * Upload: pio -d firmware/teensy/sensor_visualizer run -t upload
 */

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

constexpr uint8_t kPiezoPin = A0;
constexpr uint8_t kMicPin = A1;

constexpr uint32_t kSerialBaud = 115200;
constexpr uint32_t kMpuIntervalMs = 20;
constexpr uint32_t kPrintIntervalMs = 50;

constexpr float kPiezoAlpha = 0.10f;
constexpr float kPiezoPeakDecay = 0.96f;
constexpr float kPiezoHitThreshold = 280.0f;
constexpr float kMicAlpha = 0.12f;
constexpr int kAdcCenter = 2048;

Adafruit_MPU6050 gMpu;
bool gMpuReady = false;

float gAx = 0.0f;
float gAy = 0.0f;
float gAz = 0.0f;
float gGx = 0.0f;
float gGy = 0.0f;
float gGz = 0.0f;
float gAccelMag = 0.0f;
float gGyroMag = 0.0f;

uint16_t gPiezoRaw = 0;
float gPiezoCentered = 0.0f;
float gPiezoEnv = 0.0f;
float gPiezoPeak = 0.0f;
bool gPiezoHit = false;

uint16_t gMicRaw = 0;
float gMicEnv = 0.0f;

uint32_t gLastMpuMs = 0;
uint32_t gLastPrintMs = 0;

float magnitude3(float x, float y, float z) {
  return sqrtf((x * x) + (y * y) + (z * z));
}

void initMpu() {
  gMpuReady = gMpu.begin();
  if (!gMpuReady) {
    Serial.println("MPU6050 init: FAILED (check 3.3V, SDA=18, SCL=19, AD0->GND)");
    return;
  }

  gMpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  gMpu.setGyroRange(MPU6050_RANGE_500_DEG);
  gMpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  Serial.println("MPU6050 init: OK");
}

void sampleMpu() {
  if (!gMpuReady) {
    return;
  }

  sensors_event_t accel;
  sensors_event_t gyro;
  sensors_event_t temp;
  gMpu.getEvent(&accel, &gyro, &temp);

  gAx = accel.acceleration.x;
  gAy = accel.acceleration.y;
  gAz = accel.acceleration.z;
  gGx = gyro.gyro.x;
  gGy = gyro.gyro.y;
  gGz = gyro.gyro.z;
  gAccelMag = magnitude3(gAx, gAy, gAz);
  gGyroMag = magnitude3(gGx, gGy, gGz);
}

void samplePiezo() {
  gPiezoRaw = static_cast<uint16_t>(analogRead(kPiezoPin));
  gPiezoCentered = fabsf(static_cast<float>(gPiezoRaw) - static_cast<float>(kAdcCenter));
  gPiezoEnv = ((1.0f - kPiezoAlpha) * gPiezoEnv) + (kPiezoAlpha * gPiezoCentered);
  gPiezoPeak = max(gPiezoPeak * kPiezoPeakDecay, gPiezoCentered);
  gPiezoHit = gPiezoEnv >= kPiezoHitThreshold;
}

void sampleMic() {
  gMicRaw = static_cast<uint16_t>(analogRead(kMicPin));
  const float centered = fabsf(static_cast<float>(gMicRaw) - static_cast<float>(kAdcCenter));
  gMicEnv = ((1.0f - kMicAlpha) * gMicEnv) + (kMicAlpha * centered);
}

void printHeader() {
  Serial.println();
  Serial.println("=== Human Instrument — Teensy sensor visualizer ===");
  Serial.println(
      "DATA,ms,piezoRaw,...,micRaw,micEnv @ 115200 — use visualizer Connect Serial");
}

void printData() {
  Serial.printf(
      "DATA,%lu,%u,%.1f,%.1f,%.1f,%u,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%u,%.1f\n",
      millis(), gPiezoRaw, gPiezoCentered, gPiezoEnv, gPiezoPeak, gPiezoHit ? 1 : 0,
      gAx, gAy, gAz, gGx, gGy, gGz, gAccelMag, gGyroMag, gMicRaw, gMicEnv);
}

void setup() {
  Serial.begin(kSerialBaud);
  while (!Serial && millis() < 3000) {
  }
  delay(400);

  analogReadResolution(12);

  Wire.begin();
  Wire.setClock(400000);

  initMpu();
  printHeader();
}

void loop() {
  const uint32_t now = millis();

  samplePiezo();
  sampleMic();

  if (now - gLastMpuMs >= kMpuIntervalMs) {
    gLastMpuMs = now;
    sampleMpu();
  }

  if (now - gLastPrintMs >= kPrintIntervalMs) {
    gLastPrintMs = now;
    printData();
  }
}
