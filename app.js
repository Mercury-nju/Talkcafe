/**
 * SpeakFlow - 豆包实时语音大模型版
 * 实时语音对话 + 字幕显示
 */

class EnglishSpeakingApp {
    constructor() {
        // DOM Elements
        this.video = document.getElementById('webcam');
        this.startBtn = document.getElementById('start-btn');
        this.cameraBtn = document.getElementById('camera-btn');
        this.micBtn = document.getElementById('mic-btn');
        this.ttsToggleBtn = document.getElementById('tts-toggle-btn');
        this.statusText = document.getElementById('status-text');
        this.statusDot = document.querySelector('.status-dot');
        this.scenePills = document.querySelectorAll('.scene-pill');
        this.visualizer = document.getElementById('visualizer');
        this.chatStream = document.getElementById('chat-stream');
        this.activeAiText = document.getElementById('active-ai-text');
        this.activeUserText = document.getElementById('active-user-text');

        // Landing Page
        this.landingOverlay = document.getElementById('landing-overlay');
        this.enterBtn = document.getElementById('enter-btn');

        // State
        this.currentScene = 'daily';
        this.isActive = false;
        this.isCameraOn = true;
        this.isMicOn = true;
        this.isTtsEnabled = true;

        // WebSocket
        this.ws = null;
        
        // Audio Context for playback
        this.audioContext = null;
        this.audioNextStartTime = 0;
        
        // Audio Recording
        this.stream = null;
        this.audioWorklet = null;
        this.mediaStreamSource = null;
        this.recordingContext = null;

        // 当前 AI 回复文本（用于累积显示）
        this.currentAiText = '';
        
        // 文字显示控制
        this.clearTextTimeout = null;
        this.lastAiText = '';  // 保存上一次 AI 说的话
        
        // 跟读相关
        this.currentShadowText = '';
        this.shadowWords = [];
        this.matchedIndices = new Set();

        this.initEventListeners();
        
        if (!this.landingOverlay || this.landingOverlay.classList.contains('hidden')) {
            this.initCamera();
        }
    }

    initEventListeners() {
        if (this.enterBtn) this.enterBtn.addEventListener('click', () => this.enterStudio());
        if (this.startBtn) this.startBtn.addEventListener('click', () => this.toggleSession());
        if (this.cameraBtn) this.cameraBtn.addEventListener('click', () => this.toggleCamera());
        if (this.micBtn) this.micBtn.addEventListener('click', () => this.toggleMic());
        if (this.ttsToggleBtn) this.ttsToggleBtn.addEventListener('click', () => this.toggleTTS());

        this.scenePills.forEach(pill => {
            pill.addEventListener('click', (e) => {
                const scene = e.target.dataset.value;
                this.updateSceneState(scene);
            });
        });
    }

    async enterStudio() {
        this.landingOverlay.classList.add('hidden');
        document.querySelector('.bottom-dock-container').classList.add('active');
        await this.initCamera();
        this.statusText.textContent = 'Standby';
    }

    initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    connectWebSocket() {
        const wsUrl = `ws://${window.location.host}/ws`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.statusText.textContent = 'Connecting to AI...';
            this.ws.send(JSON.stringify({ type: 'start' }));
        };

        this.ws.onmessage = (event) => {
            this.handleServerMessage(event.data);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.statusText.textContent = 'Connection Error';
        };

        this.ws.onclose = () => {
            console.log('WebSocket closed');
            this.stopAudioCapture();
            if (this.isActive) {
                this.statusText.textContent = 'Disconnected';
            }
        };
    }

    handleServerMessage(data) {
        try {
            const message = JSON.parse(data);
            console.log('Server:', message.type);

            switch (message.type) {
                case 'session_started':
                    this.statusText.textContent = 'Connected';
                    if (this.statusDot) this.statusDot.classList.add('active');
                    this.startAudioCapture();
                    // 让 AI 自己打招呼，不写死内容
                    setTimeout(() => {
                        this.ws.send(JSON.stringify({ 
                            type: 'say_hello', 
                            text: "Start a conversation" 
                        }));
                    }, 500);
                    break;

                case 'user_speaking':
                    this.statusText.textContent = 'Listening...';
                    this.setVisualizer(true);
                    // 不清空跟读提示，让用户能看到
                    break;

                case 'asr_result':
                    // 用户说话的实时识别结果，不覆盖跟读提示
                    // 可以考虑显示在别的地方，暂时只记录
                    if (!message.isInterim) {
                        this.appendHistoryBubble('user', message.text);
                    }
                    break;

                case 'user_speech_ended':
                    this.statusText.textContent = 'AI Thinking...';
                    this.setVisualizer(false);
                    break;

                case 'ai_speaking_start':
                    this.statusText.textContent = 'AI Speaking';
                    this.lastAiText = this.currentAiText;
                    this.currentAiText = message.text || '';
                    if (this.clearTextTimeout) {
                        clearTimeout(this.clearTextTimeout);
                        this.clearTextTimeout = null;
                    }
                    if (this.activeAiText) {
                        // 过滤掉【】内容再显示
                        const displayText = this.currentAiText.replace(/【.*?】/g, '').trim();
                        this.activeAiText.textContent = displayText;
                    }
                    // 不清空用户跟读区域
                    break;

                case 'audio':
                    if (this.isTtsEnabled) {
                        this.playAudioChunk(message.data);
                    }
                    break;

                case 'ai_text':
                    this.currentAiText += message.text || '';
                    // 实时显示时过滤掉【】内容
                    if (this.activeAiText) {
                        const displayText = this.currentAiText.replace(/【.*?】/g, '').trim();
                        this.activeAiText.textContent = displayText;
                    }
                    break;

                case 'ai_speaking_end':
                    // 不在这里设置，等 ai_response_ended 统一处理
                    break;

                case 'ai_response_ended':
                    // 使用服务器返回的完整文本（包含自动生成的【】）
                    const fullText = message.fullText || this.currentAiText;
                    console.log('ai_response_ended, fullText:', fullText);
                    
                    if (fullText) {
                        this.appendHistoryBubble('ai', fullText);
                    }
                    const { aiPart, suggestion: parsedSuggestion } = this.parseAiText(fullText);
                    console.log('parsed:', { aiPart, parsedSuggestion });
                    
                    // 显示 AI 说的话（去掉【】部分）
                    if (this.activeAiText) {
                        this.activeAiText.textContent = aiPart || fullText;
                    }
                    
                    // 显示跟读内容
                    if (this.activeUserText && parsedSuggestion) {
                        if (this.clearTextTimeout) {
                            clearTimeout(this.clearTextTimeout);
                            this.clearTextTimeout = null;
                        }
                        this.activeUserText.textContent = parsedSuggestion;
                        this.activeUserText.style.opacity = '0.6';
                    }
                    this.statusText.textContent = 'Your Turn - Read it!';
                    this.setVisualizer(true);
                    break;

                case 'error':
                    console.error('Server error:', message.message);
                    this.statusText.textContent = 'Error: ' + message.message;
                    break;
            }
        } catch (e) {
            console.error('Message parse error:', e);
        }
    }

    playAudioChunk(base64Data) {
        if (!this.audioContext) {
            this.initAudioContext();
        }

        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768.0;
        }

        const buffer = this.audioContext.createBuffer(1, float32.length, 24000);
        buffer.getChannelData(0).set(float32);

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);

        const now = this.audioContext.currentTime;
        const startTime = Math.max(now, this.audioNextStartTime);
        source.start(startTime);
        this.audioNextStartTime = startTime + buffer.duration;
    }

    async startAudioCapture() {
        if (!this.stream) {
            await this.initCamera();
        }

        try {
            this.recordingContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            await this.recordingContext.audioWorklet.addModule('audio-processor.js');
            
            this.mediaStreamSource = this.recordingContext.createMediaStreamSource(this.stream);
            this.audioWorklet = new AudioWorkletNode(this.recordingContext, 'audio-processor');
            
            this.audioWorklet.port.onmessage = (event) => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isMicOn) {
                    const audioData = event.data;
                    const base64 = this.arrayBufferToBase64(audioData.buffer);
                    this.ws.send(JSON.stringify({
                        type: 'audio',
                        data: base64
                    }));
                }
            };
            
            this.mediaStreamSource.connect(this.audioWorklet);
            console.log('Audio capture started with AudioWorklet');
        } catch (e) {
            console.error('AudioWorklet failed, using ScriptProcessor fallback:', e);
            this.startAudioCaptureWithScriptProcessor();
        }
    }

    startAudioCaptureWithScriptProcessor() {
        this.recordingContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        this.mediaStreamSource = this.recordingContext.createMediaStreamSource(this.stream);
        
        const bufferSize = 4096;
        this.scriptProcessor = this.recordingContext.createScriptProcessor(bufferSize, 1, 1);
        
        this.scriptProcessor.onaudioprocess = (e) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isMicOn) {
                const inputData = e.inputBuffer.getChannelData(0);
                const int16Data = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    const sample = Math.max(-1, Math.min(1, inputData[i]));
                    int16Data[i] = Math.floor(sample * 32767);
                }
                const uint8 = new Uint8Array(int16Data.buffer);
                const base64 = this.arrayBufferToBase64(uint8);
                this.ws.send(JSON.stringify({
                    type: 'audio',
                    data: base64
                }));
            }
        };
        
        this.mediaStreamSource.connect(this.scriptProcessor);
        this.scriptProcessor.connect(this.recordingContext.destination);
        console.log('Audio capture started with ScriptProcessor');
    }

    stopAudioCapture() {
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
            this.scriptProcessor = null;
        }
        if (this.audioWorklet) {
            this.audioWorklet.disconnect();
            this.audioWorklet = null;
        }
        if (this.mediaStreamSource) {
            this.mediaStreamSource.disconnect();
            this.mediaStreamSource = null;
        }
        if (this.recordingContext) {
            this.recordingContext.close();
            this.recordingContext = null;
        }
    }

    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    async toggleSession() {
        if (!this.isActive) {
            this.isActive = true;
            this.updateStartButtonState(true);
            
            this.initAudioContext();
            this.connectWebSocket();
            
            this.chatStream.innerHTML = '';
            this.currentAiText = '';
            
            if (this.activeAiText) this.activeAiText.textContent = 'Connecting...';
            if (this.activeUserText) this.activeUserText.textContent = '';
        } else {
            this.isActive = false;
            this.updateStartButtonState(false);
            if (this.statusDot) this.statusDot.classList.remove('active');
            this.statusText.textContent = 'Stopped';
            this.setVisualizer(false);
            
            this.stopAudioCapture();
            
            if (this.ws) {
                this.ws.send(JSON.stringify({ type: 'stop' }));
                this.ws.close();
                this.ws = null;
            }
        }
    }

    appendHistoryBubble(type, text) {
        if (!text) return;
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${type}-bubble`;
        bubble.innerHTML = `<div class="bubble-content">${text}</div>`;
        this.chatStream.appendChild(bubble);
        this.chatStream.scrollTop = this.chatStream.scrollHeight;
    }

    parseAiText(text) {
        const match = text.match(/【(.+?)】/);
        if (match) {
            const suggestion = match[1];
            const aiPart = text.replace(/【.+?】/, '').trim();
            return { aiPart, suggestion };
        }
        const match2 = text.match(/\[(.+?)\]/);
        if (match2) {
            const suggestion = match2[1];
            const aiPart = text.replace(/\[.+?\]/, '').trim();
            return { aiPart, suggestion };
        }
        return { aiPart: text, suggestion: '' };
    }

    generateSuggestion(aiText) {
        if (!aiText) return '';
        const text = aiText.toLowerCase();
        
        if (text.includes('how are you') || text.includes("how's it going")) {
            return "I'm doing great, thank you! How about you?";
        }
        if (text.includes('hello') || text.includes('hi there') || text.includes('hey')) {
            return "Hello! Nice to meet you!";
        }
        if (text.includes('good morning')) {
            return "Good morning! It's a beautiful day!";
        }
        if (text.includes('your name')) {
            return "My name is... Nice to meet you!";
        }
        if (text.includes('where are you from')) {
            return "I'm from China. It's a beautiful country!";
        }
        if (text.includes('hobby') || text.includes('free time')) {
            return "I enjoy reading books and watching movies.";
        }
        if (text.includes('weather')) {
            return "It's quite nice today! I love sunny days.";
        }
        if (text.includes('?')) {
            return "That sounds interesting!";
        }
        return "That's interesting! Tell me more!";
    }

    toggleTTS() {
        this.isTtsEnabled = !this.isTtsEnabled;
        if (this.ttsToggleBtn) {
            this.ttsToggleBtn.classList.toggle('active', this.isTtsEnabled);
            this.ttsToggleBtn.style.opacity = this.isTtsEnabled ? '1' : '0.5';
        }
    }

    setVisualizer(active) {
        if (this.visualizer) {
            if (active) this.visualizer.classList.add('active');
            else this.visualizer.classList.remove('active');
        }
    }

    updateStartButtonState(isRunning) {
        if (isRunning) {
            this.startBtn.classList.add('running');
            this.startBtn.textContent = 'Stop';
        } else {
            this.startBtn.classList.remove('running');
            this.startBtn.textContent = 'Start';
        }
    }

    async initCamera() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            this.video.srcObject = this.stream;
            this.video.muted = true;
            console.log('Camera & Mic ready');
        } catch (e) {
            console.error('Camera/Mic Access Error:', e);
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        sampleRate: 16000,
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true
                    }
                });
                this.isCameraOn = false;
                if (this.cameraBtn) this.cameraBtn.classList.remove('active');
                console.log('Audio only mode');
            } catch (e2) {
                console.error("Audio Access Failed:", e2);
                alert("无法访问麦克风！请检查权限设置。");
            }
        }
    }

    toggleCamera() {
        this.isCameraOn = !this.isCameraOn;
        if (this.stream) {
            const videoTracks = this.stream.getVideoTracks();
            if (videoTracks.length > 0) videoTracks[0].enabled = this.isCameraOn;
        }
        if (this.cameraBtn) {
            this.cameraBtn.classList.toggle('active', this.isCameraOn);
            this.cameraBtn.style.opacity = this.isCameraOn ? '1' : '0.5';
        }
    }

    toggleMic() {
        this.isMicOn = !this.isMicOn;
        if (this.micBtn) {
            this.micBtn.classList.toggle('active', this.isMicOn);
            this.micBtn.style.opacity = this.isMicOn ? '1' : '0.5';
        }
    }

    updateSceneState(scene) {
        this.currentScene = scene;
        this.scenePills.forEach(p => p.classList.remove('active'));
        const activePill = document.querySelector(`.scene-pill[data-value="${scene}"]`);
        if (activePill) activePill.classList.add('active');
    }
}

window.addEventListener('DOMContentLoaded', () => new EnglishSpeakingApp());
