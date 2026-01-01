const WebSocket = require('ws');
const http = require('http');

// Configuration
const LOCAL_PORT = 8888;
const DOUBAO_WS_URL = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";

// Credentials
const APP_ID = "69505bd3cfbc2e01780dac99";
const ACCESS_TOKEN = "85cb2da4bdc24c059efeab096b88d86b";
const RESOURCE_ID = "volc.speech.dialog"; // Fixed value

// Create WebSocket Server
const wss = new WebSocket.Server({ port: LOCAL_PORT });

console.log(`\n=== Doubao Relay Server Running on ws://localhost:${LOCAL_PORT} ===`);
console.log(`Target: ${DOUBAO_WS_URL}`);
console.log(`AppID: ${APP_ID}`);
console.log("Waiting for browser connection...\n");

wss.on('connection', (clientWs) => {
    console.log("[Client] Connected to Relay");

    // Connect to Doubao upstream
    const upstreamUrl = DOUBAO_WS_URL;
    const options = {
        headers: {
            "X-Api-App-ID": APP_ID,
            "X-Api-Access-Key": ACCESS_TOKEN,
            "X-Api-Resource-Id": RESOURCE_ID,
            "X-Api-App-Key": "PlgvMymc7f3tQnJ6" // Fixed value from docs? Or optional? Docs said fixed.
        }
    };

    const upstreamWs = new WebSocket(upstreamUrl, options);

    // Buffer messages until upstream is ready
    const messageQueue = [];

    upstreamWs.on('open', () => {
        console.log("[Upstream] Connected to Doubao");
        // Flush queue
        while (messageQueue.length > 0) {
            upstreamWs.send(messageQueue.shift());
        }
    });

    upstreamWs.on('error', (e) => {
        console.error("[Upstream] Error:", e.message);
        clientWs.close();
    });

    upstreamWs.on('close', () => {
        console.log("[Upstream] Closed");
        clientWs.close();
    });

    upstreamWs.on('message', (data) => {
        // Forward from Doubao -> Client
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data);
        }
    });

    // Handle Client Messages
    clientWs.on('message', (data) => {
        if (upstreamWs.readyState === WebSocket.OPEN) {
            upstreamWs.send(data);
        } else {
            messageQueue.push(data);
        }
    });

    clientWs.on('close', () => {
        console.log("[Client] Disconnected");
        upstreamWs.close();
    });

    clientWs.on('error', (e) => {
        console.error("[Client] Error:", e.message);
        upstreamWs.close();
    });
});
