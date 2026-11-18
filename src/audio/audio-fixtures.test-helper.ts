import type { AudioClip } from "./contracts.js";

export function wavFixture(seconds = 1, amplitude = 0.1): AudioClip {
  const count = Math.floor(seconds * 16000);
  const bytes = Buffer.alloc(44 + count * 2);

  bytes.write("RIFF", 0);

  bytes.writeUInt32LE(bytes.length - 8, 4);

  bytes.write("WAVEfmt ", 8);

  bytes.writeUInt32LE(16, 16);

  bytes.writeUInt16LE(1, 20);

  bytes.writeUInt16LE(1, 22);

  bytes.writeUInt32LE(16000, 24);

  bytes.writeUInt32LE(32000, 28);

  bytes.writeUInt16LE(2, 32);

  bytes.writeUInt16LE(16, 34);

  bytes.write("data", 36);

  bytes.writeUInt32LE(count * 2, 40);

  for (let index = 0; index < count; index++) {
    bytes.writeInt16LE(
      Math.round(Math.sin(index / 10) * amplitude * 32767),
      44 + index * 2,
    );
  }

  return { bytes, mediaType: "audio/wav" };
}
