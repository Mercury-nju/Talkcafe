// Doubao Protocol Constants
const MSG_TYPE_FULL_CLIENT_REQUEST = 1;
const MSG_TYPE_AUDIO_ONLY_REQUEST = 2;
const MSG_TYPE_FULL_SERVER_RESPONSE = 11;
const MSG_TYPE_AUDIO_ONLY_RESPONSE = 12;
const MSG_TYPE_ERROR_RESPONSE = 13;
const MSG_TYPE_SERVER_ACK = 15;

const SERIALIZATION_JSON = 1;
const SERIALIZATION_AUDIO = 2;

class DoubaoProtocol {
    static encode(msgType, serializationType, payload) {
        // Header is 4 bytes: 
        // Byte 0: Protocol Version (0x01)
        // Byte 1: Header Size (0x01) (Wait, actual implementation varies, using simplified assumption or standard?)
        // Let's use standard v1: 
        // First 4 bytes:
        // 0-3: Protocol version (4 bits) | Header Size (4 bits)
        // 4-7: Message Type (4 bits) | Message Type Specific Flags (4 bits)
        // 8-11: Serialization Method (4 bits) | Compression (4 bits)
        // 12-15: Reserved

        // Actually, simple standard:
        // Byte 0: Protocol Version (0b0001____) | Header Size (____0001) -> 0x11
        // Byte 1: Message Type 
        // Byte 2: Message Type Specific Flags
        // Byte 3: Serialization Method (high 4) | Compression (low 4)

        const header = new Uint8Array(4);
        header[0] = 0x11; // Ver 1, Header Size 1 word (4 bytes)? No.

        // Let's stick to the simplest known working packer or ByteDance spec if known.
        // Assuming simple 4-byte header for now based on common reverse engineering:
        // [Ver(4)+HSize(4)] [MsgType(4)+Flags(4)] [Serial(4)+Comp(4)] [Reserved(8)]

        // Actually, let's look at Python SDKs or similar.
        // For simplicity, let's use:
        // V=1, HeaderSize=1
        header[0] = 0x11;
        header[1] = (msgType << 4) & 0xF0;
        header[2] = (serializationType << 4) & 0xF0;
        header[3] = 0x00; // Reserved

        // Paylaod processing
        let payloadBytes;
        if (serializationType === SERIALIZATION_JSON) {
            payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
        } else if (serializationType === SERIALIZATION_AUDIO) {
            payloadBytes = payload; // Assuming Int16Array or Uint8Array
        }

        // GZIP if needed (skipped)

        // Construct detailed Packet:
        // [Header (4)] [Payload Size (4, Big Endian)] [Payload]
        // But most WebSockets just send [Header][Payload] if streaming?
        // Let's assume [Header 4 bytes] + [Payload] for this specific endpoint variant.
        // Wait, standard ByteDance protocol often uses varints. 
        // Let's use the simplest: 
        // 0-3: Header
        // 4-7: extension size (0)
        // 8-11: payload size
        // 12-15: payload size (if 8 bytes?)

        // Simplified V1:
        const fullBuffer = new Uint8Array(4 + 4 + payloadBytes.byteLength);
        fullBuffer.set(header, 0);

        // Payload Size (4 bytes Big Endian)
        const view = new DataView(fullBuffer.buffer);
        view.setUint32(4, payloadBytes.byteLength, false); // Big Endian

        fullBuffer.set(new Uint8Array(payloadBytes.buffer || payloadBytes), 8);

        return fullBuffer;
    }

    static decode(buffer) {
        const view = new DataView(buffer);
        const version = view.getUint8(0) >> 4;
        const headerSize = view.getUint8(0) & 0x0F;
        const messageType = view.getUint8(1) >> 4;
        const messageFlags = view.getUint8(1) & 0x0F;
        const serializationMethod = view.getUint8(2) >> 4;
        const compression = view.getUint8(2) & 0x0F;

        // Payload Size at byte 4
        const payloadSize = view.getUint32(4, false);

        const payload = buffer.slice(8, 8 + payloadSize);

        return {
            header: { version, headerSize, messageType, messageFlags, serializationMethod, compression },
            payload,
            payloadType: serializationMethod
        };
    }
}
