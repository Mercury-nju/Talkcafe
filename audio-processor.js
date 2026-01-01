/**
 * AudioWorklet Processor
 * 将音频数据转换为 PCM 16-bit 格式并发送
 * 豆包要求：PCM、单声道、16000Hz、int16、小端序
 */

class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 640; // 20ms @ 16000Hz = 320 samples = 640 bytes
        this.buffer = new Int16Array(320);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const inputData = input[0];
        
        for (let i = 0; i < inputData.length; i++) {
            // Float32 [-1, 1] 转 Int16 [-32768, 32767]
            const sample = Math.max(-1, Math.min(1, inputData[i]));
            this.buffer[this.bufferIndex++] = Math.floor(sample * 32767);
            
            // 缓冲区满了就发送
            if (this.bufferIndex >= 320) {
                // 转换为 Uint8Array (小端序)
                const uint8 = new Uint8Array(this.buffer.buffer.slice(0));
                this.port.postMessage(uint8);
                this.bufferIndex = 0;
            }
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioProcessor);
