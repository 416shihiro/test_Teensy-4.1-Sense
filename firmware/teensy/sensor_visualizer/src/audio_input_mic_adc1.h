#pragma once

#include <AudioStream.h>
#include "utility/dspinst.h"

// Teensy 4.1: AudioInputAnalog uses ADC2 (one pin). This reads a second pin on ADC1
// for USB Audio right channel. Experimental; good enough for contact mic excitation.
class AudioInputMicAdc1 : public AudioStream {
 public:
  explicit AudioInputMicAdc1(uint8_t pin) : AudioStream(0, nullptr), pin_(pin) {}

  void update(void) override {
    audio_block_t *block = allocate();
    if (!block) {
      return;
    }

    for (int i = 0; i < AUDIO_BLOCK_SAMPLES; i++) {
      const uint16_t raw = static_cast<uint16_t>(analogRead(pin_));
      int32_t tmp = static_cast<int32_t>(raw) << 14;
      int32_t acc = hpf_y1_ - hpf_x1_ + tmp;
      hpf_y1_ = FRACMUL_SHL(acc, kHpfDcBlock, 1);
      hpf_x1_ = tmp;
      block->data[i] = signed_saturate_rshift(hpf_y1_, 16, 14);
    }

    transmit(block, 0);
    release(block);
  }

 private:
  static constexpr int32_t kHpfDcBlock = (1048300 << 10);
  uint8_t pin_;
  int32_t hpf_y1_ = 0;
  int32_t hpf_x1_ = 0;
};
