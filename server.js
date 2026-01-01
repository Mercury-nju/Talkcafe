const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = 3000;

// 豆包实时语音大模型配置
const DOUBAO_CONFIG = {
    appId: '1450778737',
    // Access Token
    accessToken: '-VZPHI8r98NK5fsD5GwjgIEQX0wIMgAT',
    // WebSocket 连接地址
    wsUrl: 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
    // 固定值
    appKey: 'PlgvMymc7f3tQnJ6',
    resourceId: 'volc.speech.dialog'
};

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json'
};

// 通义千问 API 配置
const QWEN_API_KEY = "sk-9bf19547ddbd4be1a87a7a43cf251097";

// 用 AI 生成跟读回答
async function generateAISuggestion(aiText) {
    try {
        console.log('Calling Qwen API for:', aiText);
        const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${QWEN_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'qwen-turbo',
                input: {
                    messages: [
                        {
                            role: 'system',
                            content: '你是英语口语练习助手。用户会给你一句英语对话，你需要生成一个自然、具体的英语回答。回答要简单易读，适合英语初学者朗读。只输出英语回答内容，不要任何中文解释。'
                        },
                        {
                            role: 'user',
                            content: `对方说："${aiText}"，请给出一个自然的英语回答（一到两句话）：`
                        }
                    ]
                },
                parameters: { temperature: 0.8, result_format: 'message' }
            })
        });
        
        const data = await response.json();
        console.log('Qwen API response:', JSON.stringify(data));
        
        // 尝试不同的响应路径
        let suggestion = data?.output?.choices?.[0]?.message?.content 
            || data?.output?.text 
            || data?.choices?.[0]?.message?.content
            || '';
        
        // 如果 API 失败，用智能备用
        if (!suggestion) {
            suggestion = generateSmartFallback(aiText);
        }
        
        console.log('AI generated suggestion:', suggestion);
        return suggestion.trim();
    } catch (error) {
        console.error('Failed to generate suggestion:', error);
        return generateSmartFallback(aiText);
    }
}

// 智能备用回答生成
function generateSmartFallback(aiText) {
    if (!aiText) return "That sounds interesting!";
    const text = aiText.toLowerCase();
    
    // 根据问题类型生成具体回答
    if (text.includes('how are you') || text.includes("what's up") || text.includes('how is it going')) {
        return "I'm doing great, thanks for asking! How about you?";
    }
    if (text.includes('your name')) {
        return "My name is Alex. It's nice to meet you!";
    }
    if (text.includes('where') && text.includes('from')) {
        return "I'm from Beijing, China. It's a beautiful city!";
    }
    if (text.includes('your day') || text.includes('today')) {
        return "My day has been pretty good! I've been busy with work.";
    }
    if (text.includes('hobby') || text.includes('free time') || text.includes('fun')) {
        return "I love reading books and playing video games in my free time.";
    }
    if (text.includes('weather')) {
        return "The weather is lovely today! Perfect for a walk outside.";
    }
    if (text.includes('food') || text.includes('eat') || text.includes('hungry')) {
        return "I'd love some pizza! It's my favorite food.";
    }
    if (text.includes('movie') || text.includes('watch')) {
        return "I really enjoy watching action movies and comedies!";
    }
    if (text.includes('music') || text.includes('song')) {
        return "I love pop music! Taylor Swift is my favorite singer.";
    }
    if (text.includes('work') || text.includes('job')) {
        return "I work as a software engineer. It's challenging but fun!";
    }
    if (text.includes('weekend') || text.includes('plan')) {
        return "I'm planning to hang out with friends this weekend.";
    }
    if (text.includes('travel') || text.includes('visit')) {
        return "I'd love to visit Japan someday! The culture is amazing.";
    }
    if (text.includes('learn') || text.includes('english') || text.includes('study')) {
        return "I practice English every day by watching movies and talking to people.";
    }
    if (text.includes('favorite')) {
        return "That's a tough question! I have so many favorites.";
    }
    if (text.includes('do you like') || text.includes('do you enjoy')) {
        return "Yes, I really enjoy it! It makes me happy.";
    }
    if (text.includes('?')) {
        return "That's a great question! Let me think about it.";
    }
    
    return "That sounds really interesting! Tell me more about it.";
}

// ============ 豆包二进制协议编解码 ============

// 事件ID定义
const EVENT = {
    // 客户端事件
    START_CONNECTION: 1,
    FINISH_CONNECTION: 2,
    START_SESSION: 100,
    FINISH_SESSION: 102,
    TASK_REQUEST: 200,      // 上传音频
    SAY_HELLO: 300,
    CHAT_TTS_TEXT: 500,
    CHAT_TEXT_QUERY: 501,
    
    // 服务端事件
    CONNECTION_STARTED: 50,
    CONNECTION_FAILED: 51,
    CONNECTION_FINISHED: 52,
    SESSION_STARTED: 150,
    SESSION_FINISHED: 152,
    SESSION_FAILED: 153,
    TTS_SENTENCE_START: 350,
    TTS_SENTENCE_END: 351,
    TTS_RESPONSE: 352,      // 音频数据
    TTS_ENDED: 359,
    ASR_INFO: 450,          // 检测到用户说话
    ASR_RESPONSE: 451,      // 语音识别结果
    ASR_ENDED: 459,         // 用户说话结束
    CHAT_RESPONSE: 550,     // AI回复文本
    CHAT_ENDED: 559
};

// 构建二进制协议头
function buildHeader(messageType, messageFlags, serialization, compression) {
    const header = Buffer.alloc(4);
    header[0] = 0x11;  // Protocol Version 1, Header Size 1
    header[1] = ((messageType & 0x0F) << 4) | (messageFlags & 0x0F);
    header[2] = ((serialization & 0x0F) << 4) | (compression & 0x0F);
    header[3] = 0x00;  // Reserved
    return header;
}

// 构建客户端事件消息
function buildClientEvent(eventId, sessionId, payload) {
    // Message Type = 0b0001 (Full-client request)
    // Message Flags = 0b0100 (携带事件ID)
    // Serialization = 0b0001 (JSON)
    const header = buildHeader(0x01, 0x04, 0x01, 0x00);
    
    // Event ID (4 bytes, big-endian)
    const eventIdBuf = Buffer.alloc(4);
    eventIdBuf.writeUInt32BE(eventId, 0);
    
    // Session ID (如果有)
    let sessionIdBuf = Buffer.alloc(0);
    if (sessionId && eventId >= 100) {
        const sessionIdBytes = Buffer.from(sessionId, 'utf8');
        const sessionIdSizeBuf = Buffer.alloc(4);
        sessionIdSizeBuf.writeUInt32BE(sessionIdBytes.length, 0);
        sessionIdBuf = Buffer.concat([sessionIdSizeBuf, sessionIdBytes]);
    }
    
    // Payload
    const payloadBytes = Buffer.from(JSON.stringify(payload || {}), 'utf8');
    const payloadSizeBuf = Buffer.alloc(4);
    payloadSizeBuf.writeUInt32BE(payloadBytes.length, 0);
    
    return Buffer.concat([header, eventIdBuf, sessionIdBuf, payloadSizeBuf, payloadBytes]);
}

// 构建音频数据消息
function buildAudioMessage(sessionId, audioData) {
    // Message Type = 0b0010 (Audio-only request)
    // Message Flags = 0b0100 (携带事件ID)
    const header = buildHeader(0x02, 0x04, 0x00, 0x00);
    
    // Event ID = 200 (TaskRequest)
    const eventIdBuf = Buffer.alloc(4);
    eventIdBuf.writeUInt32BE(EVENT.TASK_REQUEST, 0);
    
    // Session ID
    const sessionIdBytes = Buffer.from(sessionId, 'utf8');
    const sessionIdSizeBuf = Buffer.alloc(4);
    sessionIdSizeBuf.writeUInt32BE(sessionIdBytes.length, 0);
    
    // Audio payload
    const payloadSizeBuf = Buffer.alloc(4);
    payloadSizeBuf.writeUInt32BE(audioData.length, 0);
    
    return Buffer.concat([header, eventIdBuf, sessionIdSizeBuf, sessionIdBytes, payloadSizeBuf, audioData]);
}

// 解析服务端响应
function parseServerResponse(buffer) {
    if (buffer.length < 4) return null;
    
    const messageType = (buffer[1] >> 4) & 0x0F;
    const messageFlags = buffer[1] & 0x0F;
    const serialization = (buffer[2] >> 4) & 0x0F;
    
    let offset = 4;
    let eventId = 0;
    let sessionId = '';
    let payload = null;
    
    // 解析 Event ID (如果 flags 包含 0b0100)
    if (messageFlags & 0x04) {
        eventId = buffer.readUInt32BE(offset);
        offset += 4;
    }
    
    // Session 级别事件需要解析 session id
    if (eventId >= 100 && eventId < 600) {
        if (offset + 4 <= buffer.length) {
            const sessionIdSize = buffer.readUInt32BE(offset);
            offset += 4;
            if (sessionIdSize > 0 && offset + sessionIdSize <= buffer.length) {
                sessionId = buffer.slice(offset, offset + sessionIdSize).toString('utf8');
                offset += sessionIdSize;
            }
        }
    }
    
    // 解析 Payload
    if (offset + 4 <= buffer.length) {
        const payloadSize = buffer.readUInt32BE(offset);
        offset += 4;
        
        if (payloadSize > 0 && offset + payloadSize <= buffer.length) {
            const payloadData = buffer.slice(offset, offset + payloadSize);
            
            // 音频数据 (messageType = 0b1011)
            if (messageType === 0x0B) {
                payload = { type: 'audio', data: payloadData };
            }
            // JSON 数据
            else if (serialization === 0x01) {
                try {
                    payload = JSON.parse(payloadData.toString('utf8'));
                } catch (e) {
                    payload = { raw: payloadData.toString('utf8') };
                }
            } else {
                payload = { raw: payloadData };
            }
        }
    }
    
    return { messageType, eventId, sessionId, payload };
}

// ============ HTTP 服务器 ============

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // 静态文件服务
    let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    filePath = path.join(__dirname, filePath);

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// ============ WebSocket 服务器 ============

const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (clientWs) => {
    console.log('Client connected');
    
    let doubaoWs = null;
    let sessionId = crypto.randomUUID();
    let isSessionActive = false;
    let currentAiResponse = '';  // 累积 AI 回复

    // 连接豆包实时语音服务
    function connectDoubao() {
        doubaoWs = new WebSocket(DOUBAO_CONFIG.wsUrl, {
            headers: {
                'X-Api-App-ID': DOUBAO_CONFIG.appId,
                'X-Api-Access-Key': DOUBAO_CONFIG.accessToken,
                'X-Api-Resource-Id': DOUBAO_CONFIG.resourceId,
                'X-Api-App-Key': DOUBAO_CONFIG.appKey,
                'X-Api-Connect-Id': crypto.randomUUID()
            }
        });

        doubaoWs.on('open', () => {
            console.log('Connected to Doubao Realtime API');
            
            // 发送 StartConnection 事件
            const startConnMsg = buildClientEvent(EVENT.START_CONNECTION, null, {});
            doubaoWs.send(startConnMsg);
        });

        doubaoWs.on('message', async (data) => {
            const response = parseServerResponse(data);
            if (!response) return;
            
            console.log('Doubao event:', response.eventId, getEventName(response.eventId));
            
            switch (response.eventId) {
                case EVENT.CONNECTION_STARTED:
                    console.log('Connection established, starting session...');
                    startSession();
                    break;
                    
                case EVENT.SESSION_STARTED:
                    isSessionActive = true;
                    console.log('Session started:', response.payload);
                    clientWs.send(JSON.stringify({
                        type: 'session_started',
                        sessionId: sessionId,
                        dialogId: response.payload?.dialog_id
                    }));
                    break;
                    
                case EVENT.ASR_INFO:
                    // 检测到用户开始说话
                    currentAiResponse = '';  // 清空上次的 AI 回复
                    clientWs.send(JSON.stringify({
                        type: 'user_speaking',
                        questionId: response.payload?.question_id
                    }));
                    break;
                    
                case EVENT.ASR_RESPONSE:
                    // 语音识别结果
                    if (response.payload?.results) {
                        const result = response.payload.results[0];
                        clientWs.send(JSON.stringify({
                            type: 'asr_result',
                            text: result.text,
                            isInterim: result.is_interim
                        }));
                    }
                    break;
                    
                case EVENT.ASR_ENDED:
                    // 用户说话结束
                    clientWs.send(JSON.stringify({ type: 'user_speech_ended' }));
                    break;
                    
                case EVENT.TTS_SENTENCE_START:
                    // AI 开始说话 - 这里包含要说的文本
                    console.log('TTS Start payload:', response.payload);
                    currentAiResponse = '';  // 清空，准备接收新的回复
                    const aiText = response.payload?.text || '';
                    clientWs.send(JSON.stringify({
                        type: 'ai_speaking_start',
                        text: aiText,
                        ttsType: response.payload?.tts_type
                    }));
                    break;
                    
                case EVENT.TTS_RESPONSE:
                    // 音频数据
                    if (response.payload?.type === 'audio') {
                        clientWs.send(JSON.stringify({
                            type: 'audio',
                            data: response.payload.data.toString('base64')
                        }));
                    }
                    break;
                    
                case EVENT.TTS_SENTENCE_END:
                case EVENT.TTS_ENDED:
                    clientWs.send(JSON.stringify({ type: 'ai_speaking_end' }));
                    break;
                    
                case EVENT.CHAT_RESPONSE:
                    // AI 回复文本（字幕）- 累积完整回复
                    const content = response.payload?.content || '';
                    currentAiResponse += content;
                    console.log('Chat response payload:', response.payload);
                    clientWs.send(JSON.stringify({
                        type: 'ai_text',
                        text: content,
                        questionId: response.payload?.question_id,
                        replyId: response.payload?.reply_id
                    }));
                    break;
                    
                case EVENT.CHAT_ENDED:
                    // AI 回复结束，检查是否有【】
                    let finalResponse = currentAiResponse;
                    console.log('CHAT_ENDED, currentAiResponse:', currentAiResponse);
                    
                    if (!finalResponse.includes('【') || !finalResponse.includes('】')) {
                        // AI 没给跟读内容，用另一个 AI 生成
                        const suggestion = await generateAISuggestion(finalResponse);
                        if (suggestion) {
                            finalResponse = finalResponse + '【' + suggestion + '】';
                        }
                    }
                    clientWs.send(JSON.stringify({ 
                        type: 'ai_response_ended',
                        fullText: finalResponse
                    }));
                    break;
                    
                case EVENT.SESSION_FAILED:
                case EVENT.CONNECTION_FAILED:
                    console.error('Doubao error:', response.payload);
                    clientWs.send(JSON.stringify({
                        type: 'error',
                        message: response.payload?.error || 'Connection failed'
                    }));
                    break;
            }
        });

        doubaoWs.on('error', (err) => {
            console.error('Doubao WebSocket error:', err.message);
            clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
        });

        doubaoWs.on('close', (code, reason) => {
            console.log('Doubao connection closed:', code, reason.toString());
            isSessionActive = false;
        });
    }

    // 启动会话
    function startSession() {
        const sessionPayload = {
            dialog: {
                bot_name: "英语教练",
                system_role: `你是英语口语练习伙伴，帮助用户练习英语对话。

【最重要的规则】每次回复必须用这个格式：
你说的话【用户要跟读的完整回答】

比如：
- Hello! How are you today?【I'm doing great, thank you! And you?】
- That's nice! What do you like to do for fun?【I like watching movies and reading books.】
- Oh cool! What kind of movies do you like?【I really enjoy action movies and comedies.】

规则：
1. 【】里是用户要跟读的完整句子
2. 【】里的内容必须是对你问题的自然回答
3. 根据用户说的话灵活聊天，话题不限
4. 每条消息结尾必须有【】，这是最重要的！
5. 开场时用有趣的方式打招呼，不要每次都一样`,
                speaking_style: "友好、耐心、鼓励",
                extra: {
                    model: "O"
                }
            },
            tts: {
                speaker: "zh_female_vv_jupiter_bigtts",
                audio_config: {
                    channel: 1,
                    format: "pcm_s16le",
                    sample_rate: 24000
                }
            },
            asr: {
                audio_info: {
                    format: "pcm",
                    sample_rate: 16000,
                    channel: 1
                }
            }
        };
        
        const msg = buildClientEvent(EVENT.START_SESSION, sessionId, sessionPayload);
        doubaoWs.send(msg);
    }

    // 获取事件名称（调试用）
    function getEventName(eventId) {
        const names = {
            1: 'StartConnection', 2: 'FinishConnection',
            50: 'ConnectionStarted', 51: 'ConnectionFailed', 52: 'ConnectionFinished',
            100: 'StartSession', 102: 'FinishSession',
            150: 'SessionStarted', 152: 'SessionFinished', 153: 'SessionFailed',
            200: 'TaskRequest', 300: 'SayHello',
            350: 'TTSSentenceStart', 351: 'TTSSentenceEnd', 352: 'TTSResponse', 359: 'TTSEnded',
            450: 'ASRInfo', 451: 'ASRResponse', 459: 'ASREnded',
            500: 'ChatTTSText', 501: 'ChatTextQuery',
            550: 'ChatResponse', 559: 'ChatEnded'
        };
        return names[eventId] || `Unknown(${eventId})`;
    }

    // 处理客户端消息
    clientWs.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            switch (data.type) {
                case 'start':
                    console.log('Starting Doubao connection...');
                    connectDoubao();
                    break;

                case 'audio':
                    // 转发音频数据到豆包
                    if (doubaoWs && doubaoWs.readyState === WebSocket.OPEN && isSessionActive) {
                        const audioBuffer = Buffer.from(data.data, 'base64');
                        const audioMsg = buildAudioMessage(sessionId, audioBuffer);
                        doubaoWs.send(audioMsg);
                    }
                    break;

                case 'text_query':
                    // 文本输入
                    if (doubaoWs && doubaoWs.readyState === WebSocket.OPEN && isSessionActive) {
                        const textMsg = buildClientEvent(EVENT.CHAT_TEXT_QUERY, sessionId, {
                            content: data.text
                        });
                        doubaoWs.send(textMsg);
                    }
                    break;

                case 'say_hello':
                    // 打招呼
                    if (doubaoWs && doubaoWs.readyState === WebSocket.OPEN && isSessionActive) {
                        const helloMsg = buildClientEvent(EVENT.SAY_HELLO, sessionId, {
                            content: data.text || "Hello!"
                        });
                        doubaoWs.send(helloMsg);
                    }
                    break;

                case 'stop':
                    if (doubaoWs && doubaoWs.readyState === WebSocket.OPEN) {
                        // 发送 FinishSession
                        const finishSessionMsg = buildClientEvent(EVENT.FINISH_SESSION, sessionId, {});
                        doubaoWs.send(finishSessionMsg);
                        
                        // 发送 FinishConnection
                        setTimeout(() => {
                            const finishConnMsg = buildClientEvent(EVENT.FINISH_CONNECTION, null, {});
                            doubaoWs.send(finishConnMsg);
                            doubaoWs.close();
                        }, 100);
                    }
                    isSessionActive = false;
                    break;
            }
        } catch (e) {
            console.error('Message parse error:', e.message);
        }
    });

    clientWs.on('close', () => {
        console.log('Client disconnected');
        if (doubaoWs && doubaoWs.readyState === WebSocket.OPEN) {
            doubaoWs.close();
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n🚀 TalkCafe Server running at http://localhost:${PORT}`);
    console.log('   豆包实时语音大模型已配置');
    console.log('   AppID:', DOUBAO_CONFIG.appId);
    console.log('\n   Open http://localhost:' + PORT + ' in your browser\n');
});
