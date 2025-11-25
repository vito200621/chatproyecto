import IceChatClient from './ice/iceClient.js';

const appState = {
    clientId: null,
    currentChat: null,
    groups: [],
    messages: []
};

// ==================== Configuración ====================
const PROXY_URL = 'http://localhost:3000';
const WS_URL = 'ws://localhost:3000';
let iceClient = null;
let currentIceUser = null;
let ws = null;

function initWebSocket() {
    try {
        ws = new WebSocket(WS_URL);
        ws.addEventListener('open', () => {
            console.log('[WS] conectado al proxy');
            if (appState.clientId) {
                ws.send(JSON.stringify({ type: 'register', clientId: appState.clientId }));
            }
        });
        ws.addEventListener('message', (ev) => {
            try {
                const data = JSON.parse(ev.data);
                handleWSMessage(data);
            } catch (err) {
                console.error('[WS] mensaje inválido:', err);
            }
        });
        ws.addEventListener('close', () => { console.log('[WS] desconectado'); });
    } catch (err) {
        console.error('No se pudo inicializar WebSocket:', err);
    }
}

function handleWSMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'registered') {
        console.log('[WS] registrado con id', msg.clientId);
        return;
    }
    if (msg.type === 'voicenote-sent') {
        showSystemMessage(`Nota de voz enviada a ${msg.toType} ${msg.target}`);
        return;
    }
    if (msg.type === 'signal') {
        // Señalización (SDP/ICE) entre navegadores - reenviar a manejador si existe
        if (msg.signalType === 'offer' || msg.signalType === 'answer' || msg.signalType === 'candidate') {
            // manejar según implementación de WebRTC/RTC
            console.log('[WS] señal recibida', msg);
        }
    }
}

// helpers
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// ==================== Inicialización ====================

document.addEventListener('DOMContentLoaded', async () => {
    // Primero inicializar Ice
    await initializeIceClient();

    // Si Ice funciona, usar Ice. Si no, usar HTTP legacy
    if (iceClient && iceClient.connected) {
        await initializeWithIce();
    } else {
        await initializeWithHttp();
    }
});

async function initializeIceClient() {
    try {
        iceClient = new IceChatClient();

        const connected = await iceClient.initialize();
        if (connected) {
            console.log("Cliente Ice inicializado correctamente");
            return true;
        }
    } catch (error) {
        console.error("Error inicializando Ice client:", error);
    }
    return false;
}

async function initializeWithIce() {
    try {
        // Login con Ice
        const username = `Usuario_${Math.floor(Math.random() * 1000)}`;
        currentIceUser = await iceClient.login(username);

        // Configurar callbacks
        iceClient.setOnMessageCallback((msg) => {
            processIceMessage(msg);
        });

        iceClient.setOnVoiceNoteCallback((from, filename, data) => {
            processIceVoiceNote(from, filename, data);
        });

        // Actualizar UI
        document.getElementById('currentUserId').textContent = currentIceUser.id;
        appState.clientId = currentIceUser.id;

        // Inicializar websocket para funcionalidades en tiempo real (voicenotes, señalización)
        initWebSocket();

        // Mostrar que estamos usando Ice
        showSystemMessage("Conectado via Ice RPC - Mensajería en tiempo real activada");

        // Cargar datos
        await loadGroupsWithIce();
        setupEventListeners();
        loadLocalData();

    } catch (error) {
        console.error("Error inicializando con Ice:", error);
        await initializeWithHttp();
    }
}

async function initializeWithHttp() {
    // Tu código HTTP legacy actual...
    const clientId = sessionStorage.getItem('clientId');
    if (!clientId) {
        window.location.href = 'index.html';
        return;
    }

    appState.clientId = parseInt(clientId);
    document.getElementById('currentUserId').textContent = clientId;

    // Inicializar websocket también en modo HTTP
    initWebSocket();

    //setupEventListeners();
    //loadLocalData();
    //startPolling();
    //loadOnlineClients();

    // showSystemMessage("Usando conexión HTTP - Polling activado");
}

// ==================== Funciones Ice ====================
async function loadGroupsWithIce() {
    try {
        const groups = await iceClient.listGroups();
        // Convertir grupos Ice a formato local
        appState.groups = groups.map(group => group.name);
        saveLocalData();
        renderGroups();
    } catch (error) {
        console.error("Error cargando grupos con Ice:", error);
    }
}

function processIceMessage(msg) {
    // Convertir mensaje Ice a formato de la UI
    const messageData = {
        type: msg.sender === currentIceUser.id ? 'sent' : 'received',
        from: msg.sender,
        content: msg.content,
        timestamp: new Date(msg.timestamp).toLocaleTimeString('es-ES', {
            hour: '2-digit', minute: '2-digit'
        })
    };

    addMessageToUI(messageData);
}

function processIceVoiceNote(from, filename, data) {
    const voiceData = {
        type: from === currentIceUser.id ? 'sent' : 'received',
        from: from,
        filename: filename,
        timestamp: new Date().toLocaleTimeString('es-ES', {
            hour: '2-digit', minute: '2-digit'
        })
    };

    addVoiceNoteToUI(voiceData);

    // Opcional: reproducir automáticamente
    playVoiceNote(data);
}

// Reproductor simple para notas de voz recibidas (acepta base64 o ArrayBuffer/Uint8Array)
function playVoiceNote(data) {
    try {
        let blob;
        if (!data) return;
        if (typeof data === 'string') {
            // base64 string
            const binary = atob(data);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
            blob = new Blob([bytes.buffer], { type: 'audio/webm' });
        } else if (data instanceof ArrayBuffer) {
            blob = new Blob([data], { type: 'audio/webm' });
        } else if (data instanceof Uint8Array) {
            blob = new Blob([data.buffer], { type: 'audio/webm' });
        } else {
            console.warn('Formato de audio desconocido para reproducción');
            return;
        }
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play().catch(err => console.error('Error al reproducir audio:', err));
    } catch (err) {
        console.error('playVoiceNote error:', err);
    }
}

// Grabar y enviar nota de voz desde el navegador usando MediaRecorder y WebSocket
async function recordAndSendVoiceNote(toType, target) {
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
        alert('Tu navegador no soporta grabación de audio (MediaRecorder)');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const chunks = [];

        recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

        recorder.onstop = async () => {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();
            const base64 = arrayBufferToBase64(arrayBuffer);
            const filename = 'voice_' + Date.now() + '.webm';

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'voicenote', toType, target, filename, base64, clientId: appState.clientId }));
                showSystemMessage('Nota de voz enviada (web)');
            } else {
                alert('No conectado al servidor WebSocket');
            }

            // detener tracks
            stream.getTracks().forEach(t => t.stop());
        };

        recorder.start();
        showSystemMessage('Grabando... presiona OK para detener.');
        await new Promise((resolve) => {
            // Pedimos confirmación al usuario para detener la grabación
            if (confirm('Presiona OK para detener la grabación')) {
                recorder.stop();
                resolve();
            } else {
                recorder.stop();
                resolve();
            }
        });

    } catch (err) {
        console.error('Error al grabar nota de voz:', err);
        alert('Error al grabar: ' + err.message);
    }
}

// ==================== Modificar Handlers para Usar Ice ====================
async function handleSendMessage(e) {
    e.preventDefault();

    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();

    if (!message || !appState.currentChat) {
        return;
    }

    const { type, id } = appState.currentChat;

    try {
        if (iceClient && iceClient.connected) {
            // Usar Ice
            if (type === 'user') {
                await iceClient.sendPrivateMessage(id.toString(), message);
            } else {
                await iceClient.sendGroupMessage(id, message);
            }

            // Agregar mensaje a UI inmediatamente (no esperar callback)
            addMessageToUI({
                type: 'sent',
                from: currentIceUser.id,
                content: message,
                timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
            });

        } else {
            // Fallback a HTTP legacy
            // ... tu código HTTP actual
        }

        // Limpiar input
        messageInput.value = '';

    } catch (error) {
        console.error('Error enviando mensaje:', error);
        alert('Error al enviar el mensaje: ' + error.message);
    }
}

// Actualizar handleCreateGroup, handleJoinGroup, etc. de manera similar...