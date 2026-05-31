const MAGIC = [0x48, 0x49, 0x4a, 0x46]; // HIJF
const HEADER_SIZE = 10;
const MAX_FRAME_BYTES = 8192;

export function createSerialFrameParser({ onLine, onFrame }) {
  let buffer = new Uint8Array(0);
  const textDecoder = new TextDecoder();

  function append(chunk) {
    if (!chunk?.length) {
      return;
    }
    const next = new Uint8Array(buffer.length + chunk.length);
    next.set(buffer);
    next.set(chunk, buffer.length);
    buffer = next;
    drain();
  }

  function findMagic() {
    for (let i = 0; i <= buffer.length - MAGIC.length; i += 1) {
      if (
        buffer[i] === MAGIC[0] &&
        buffer[i + 1] === MAGIC[1] &&
        buffer[i + 2] === MAGIC[2] &&
        buffer[i + 3] === MAGIC[3]
      ) {
        return i;
      }
    }
    return -1;
  }

  function findNewline(maxIndex) {
    const limit = maxIndex < 0 ? buffer.length : maxIndex;
    for (let i = 0; i < limit; i += 1) {
      if (buffer[i] === 0x0a) {
        return i;
      }
    }
    return -1;
  }

  function drain() {
    while (buffer.length > 0) {
      const magicIndex = findMagic();
      const newlineIndex = findNewline(magicIndex);

      if (magicIndex === 0 && buffer.length >= HEADER_SIZE) {
        const view = new DataView(
          buffer.buffer,
          buffer.byteOffset,
          buffer.byteLength,
        );
        const frameLen = view.getUint16(4, true);
        const timestampMs = view.getUint32(6, true);
        const total = HEADER_SIZE + frameLen;

        if (frameLen === 0 || frameLen > MAX_FRAME_BYTES) {
          buffer = buffer.slice(1);
          continue;
        }
        if (buffer.length < total) {
          return;
        }

        const jpeg = buffer.slice(HEADER_SIZE, total);
        buffer = buffer.slice(total);
        onFrame?.(jpeg, timestampMs);
        continue;
      }

      if (newlineIndex >= 0 && (magicIndex < 0 || newlineIndex < magicIndex)) {
        const lineBytes = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = textDecoder.decode(lineBytes).trim();
        if (line) {
          onLine?.(line);
        }
        continue;
      }

      if (magicIndex > 0) {
        const textBytes = buffer.slice(0, magicIndex);
        buffer = buffer.slice(magicIndex);
        const text = textDecoder.decode(textBytes);
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) {
            onLine?.(trimmed);
          }
        }
        continue;
      }

      return;
    }
  }

  function reset() {
    buffer = new Uint8Array(0);
  }

  return { append, reset };
}

/** Draw JPEG bytes onto canvas rotated 180°. */
async function drawJpegRotated180(canvas, jpegBytes) {
  const blob = new Blob([jpegBytes], { type: "image/jpeg" });
  const bitmap = await createImageBitmap(blob);
  const ctx = canvas.getContext("2d");
  const w = bitmap.width;
  const h = bitmap.height;

  canvas.width = w;
  canvas.height = h;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.translate(w, h);
  ctx.rotate(Math.PI);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
}

/**
 * @param {{ onStatus?: (text: string, tone?: string) => void }} [options]
 */
export function initCameraPanel(options = {}) {
  const stream = document.querySelector("#cameraStream");
  const status = document.querySelector("#cameraStatus");
  const meta = document.querySelector("#cameraMeta");

  if (!stream || !(stream instanceof HTMLCanvasElement)) {
    return null;
  }

  let frameCount = 0;
  let fpsWindowStart = performance.now();
  let frameSerial = 0;

  function setStatus(text, tone = "normal") {
    if (status) {
      status.textContent = text;
      status.dataset.tone = tone;
    }
    options.onStatus?.(text, tone);
  }

  function setMeta(text) {
    if (meta) {
      meta.textContent = text;
    }
  }

  async function showFrame(jpegBytes, timestampMs) {
    const ticket = ++frameSerial;
    try {
      await drawJpegRotated180(stream, jpegBytes);
      if (ticket !== frameSerial) {
        return;
      }

      frameCount += 1;
      const elapsed = performance.now() - fpsWindowStart;
      if (elapsed >= 1000) {
        const fps = (frameCount * 1000) / elapsed;
        setMeta(`serial QQVGA · ${fps.toFixed(1)} fps · 180° · t=${timestampMs} ms`);
        frameCount = 0;
        fpsWindowStart = performance.now();
      }

      setStatus("live", "ok");
    } catch {
      if (ticket === frameSerial) {
        setStatus("frame error", "error");
      }
    }
  }

  function stop() {
    frameSerial += 1;
    const ctx = stream.getContext("2d");
    ctx.clearRect(0, 0, stream.width, stream.height);
    setStatus("stopped");
    setMeta("");
    frameCount = 0;
    fpsWindowStart = performance.now();
  }

  function handleInfoLine(line) {
    if (!line.startsWith("CAMINFO,")) {
      return;
    }
    const parts = line.split(",");
    const ready = parts[1] === "1";
    setMeta(
      ready
        ? `serial ${parts[2] ?? "?"}x${parts[3] ?? "?"} · waiting frames`
        : "camera init failed",
    );
    setStatus(ready ? "ready" : "error", ready ? "ok" : "error");
  }

  setStatus("off");
  setMeta("USB serial · connect to preview");

  return {
    showFrame,
    stop,
    handleInfoLine,
  };
}
