function encodePcm16Wav(samples: Float32Array, sampleRate: number): number[] {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return Array.from(new Uint8Array(buffer));
}

export async function mediaBlobToWavBytes(blob: Blob): Promise<number[]> {
  const audioContextWindow = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const audioContextConstructor = audioContextWindow.AudioContext ?? audioContextWindow.webkitAudioContext;
  if (!audioContextConstructor) throw new Error("WebView không hỗ trợ giải mã audio để tạo WAV");
  const audioContext = new audioContextConstructor();
  try {
    const source = await audioContext.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(source.length);
    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      const samples = source.getChannelData(channel);
      for (let index = 0; index < source.length; index += 1) mono[index] += samples[index] / source.numberOfChannels;
    }
    const targetSampleRate = 24000;
    const targetLength = Math.max(1, Math.round(mono.length * targetSampleRate / source.sampleRate));
    const resampled = new Float32Array(targetLength);
    const ratio = source.sampleRate / targetSampleRate;
    for (let index = 0; index < targetLength; index += 1) {
      const position = index * ratio;
      const left = Math.floor(position);
      const right = Math.min(left + 1, mono.length - 1);
      const fraction = position - left;
      resampled[index] = mono[left] * (1 - fraction) + mono[right] * fraction;
    }
    return encodePcm16Wav(resampled, targetSampleRate);
  } finally {
    await audioContext.close();
  }
}
