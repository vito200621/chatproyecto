/**
 * Chat Application con soporte para:
 * - Mensajes de texto (privados y grupos)
 * - Notas de voz grabadas
 * - Llamadas de voz en tiempo real (via WebSocket)
 * - ZeroC ICE para RPC (si disponible)
 */

// ==================== Estado Global ====================
const appState = {
    clientId: null,
    username: null,
    currentChat: null, // { type: 'user' | 'group', id: number | name: string }
    messages: [],
    groups: [],
    contacts: [],
    onlineClients: [],
    activeCalls: new Map()
};

// ==================== Configuración ====================
// Detectar URL del proxy automáticamente (funciona en localhost y red local)
const PROXY_URL = `http://${window.location.hostname}:3000`;
const WS_URL = `ws://${window.location.hostname}:3000`;

console.log('[App] Conectando a:', PROXY_URL);

// Instancias globales
let iceProxy = null;        // Conexión WebSocket / ICE
let audioManager = null;    // Gestor de audio
let callInProgress = null;  // { callKey, remoteId, startTime }

// ==================== Inicialización ====================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[App] Iniciando aplicación');

    // Obtener clientId de sesión
    let clientId = sessionStorage.getItem('clientId');
    if (!clientId) {
        // Conectarse al proxy para obtener clientId
        try {
            const res = await fetch(PROXY_URL + '/api/connect', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                clientId = data.clientId;
                sessionStorage.setItem('clientId', clientId);
            } else {
                alert('No se pudo conectar al servidor');
                return;
            }
        } catch (err) {
            alert('Error de conexión: ' + err.message);
            return;
        }
    }

    appState.clientId = parseInt(clientId);
    appState.username = `Usuario_${appState.clientId}`;
    
    document.getElementById('currentUserId').textContent = appState.clientId;

    // Inicializar managers
    audioManager = new AudioManager(handleAudioEvent);

    // Conectar a WebSocket (ICE proxy)
    try {
        iceProxy = new ICEProxy(WS_URL);
        await iceProxy.connect(appState.username, appState.clientId);
        console.log('[App] Conectado a ICE Proxy');

        // Registrar manejadores
        iceProxy.onMessage(handleRemoteMessage);
        iceProxy.onVoiceNote(handleRemoteVoiceNote);
        iceProxy.onCall(handleCallEvent);

    } catch (err) {
        console.error('[App] Error conectando a ICE:', err);
    }

    // Setup UI
    setupEventListeners();
    loadLocalData();
    startPolling();
});

// ==================== Event Listeners ====================
function setupEventListeners() {
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    // Crear grupo
    const createGroupBtn = document.getElementById('createGroupBtn');
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', () => {
            const groupName = prompt('Nombre del grupo:');
            if (groupName) handleCreateGroup(groupName);
        });
    }

    // Enviar mensaje
    const messageForm = document.getElementById('messageForm');
    if (messageForm) {
        messageForm.addEventListener('submit', handleSendMessage);
    }

    // Grabar nota de voz
    const recordVoiceBtn = document.getElementById('recordVoiceBtn');
    if (recordVoiceBtn) {
        recordVoiceBtn.addEventListener('click', handleRecordVoice);
    }

    // Iniciar llamada
    const startCallBtn = document.getElementById('startCallBtn');
    if (startCallBtn) {
        startCallBtn.addEventListener('click', handleStartCall);
    }

    // Terminar llamada
    const endCallBtn = document.getElementById('endCallBtn');
    if (endCallBtn) {
        endCallBtn.addEventListener('click', handleEndCall);
        endCallBtn.style.display = 'none';
    }

    // Agregar contacto
    const addContactBtn = document.getElementById('addContactBtn');
    if (addContactBtn) {
        addContactBtn.addEventListener('click', handleAddContact);
    }

    // Refrescar clientes
    const refreshClientsBtn = document.getElementById('refreshClientsBtn');
    if (refreshClientsBtn) {
        refreshClientsBtn.addEventListener('click', loadOnlineClients);
    }

    // Refrescar grupos
    const refreshGroupsBtn = document.getElementById('refreshGroupsBtn');
    if (refreshGroupsBtn) {
        refreshGroupsBtn.addEventListener('click', loadGroups);
    }
}

// ==================== Manejo de Mensajes ====================
async function handleSendMessage(e) {
    e.preventDefault();

    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (!message || !appState.currentChat) return;

    const { type, id } = appState.currentChat;

    try {
        // Enviar via REST al proxy
        const endpoint = type === 'user' ? '/api/messages/user' : '/api/messages/group';
        const body = {
            clientId: appState.clientId,
            message: message
        };
        if (type === 'user') body.targetId = id;
        else body.groupName = id;

        const res = await fetch(PROXY_URL + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (res.ok) {
            addMessageToUI({
                type: 'sent',
                from: appState.clientId,
                content: message,
                timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
            });
            input.value = '';
        }
    } catch (err) {
        console.error('[App] Error enviando mensaje:', err);
        alert('Error al enviar mensaje');
    }
}

function handleRemoteMessage(msg) {
    if (!msg) return;
    console.log('[App] Mensaje remoto:', msg);
    addMessageToUI({
        type: 'received',
        from: msg.from || msg.sender,
        content: msg.content,
        timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    });
}

// ==================== Manejo de Notas de Voz ====================
async function handleRecordVoice() {
    if (!appState.currentChat) {
        alert('Selecciona un chat primero');
        return;
    }

    try {
        if (!audioManager.recording) {
            await audioManager.startRecording();
            const btn = document.getElementById('recordVoiceBtn');
            btn.textContent = '⏹️ Detener grabación';
            btn.style.backgroundColor = '#d32f2f';
        } else {
            const btn = document.getElementById('recordVoiceBtn');
            const blob = await audioManager.stopRecording();
            btn.textContent = '🎤 Grabar nota de voz';
            btn.style.backgroundColor = '';

            // Enviar nota de voz
            const { type, id } = appState.currentChat;
            const targetType = type === 'user' ? 'user' : 'group';
            const filename = `voice_${Date.now()}.webm`;

            await iceProxy.sendVoiceNote(id, targetType, blob, filename);
            showSystemMessage('Nota de voz enviada');

            // Reproducir localmente (echo)
            await audioManager.playAudio(blob, false);
        }
    } catch (err) {
        console.error('[App] Error con nota de voz:', err);
        alert('Error: ' + err.message);
    }
}

function handleRemoteVoiceNote(data) {
    if (data.type === 'audio-chunk' && callInProgress) {
        // Reproducir chunk de llamada
        audioManager.processCallAudioChunk(data.data).catch(err => 
            console.warn('[App] Error reproduciendo chunk:', err.message)
        );
    } else if (data.type === 'voicenote' && appState.currentChat) {
        // Nota de voz recibida
        console.log('[App] Nota de voz recibida de:', data.from);
        addVoiceNoteToUI({
            type: 'received',
            from: data.from,
            filename: data.filename,
            timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        });
    }
}

// ==================== Manejo de Llamadas ====================
async function handleStartCall() {
    if (!appState.currentChat || appState.currentChat.type !== 'user') {
        alert('Selecciona un usuario para llamar');
        return;
    }

    try {
        const callKey = iceProxy.startCall(appState.currentChat.id);
        callInProgress = { callKey, remoteId: appState.currentChat.id, startTime: Date.now() };

        showSystemMessage('Llamada iniciada...');

        // UI de llamada
        updateCallUI(true, callKey);
    } catch (err) {
        console.error('[App] Error iniciando llamada:', err);
        alert('Error: ' + err.message);
    }
}

async function handleEndCall() {
    if (callInProgress) {
        iceProxy.endCall(callInProgress.callKey);
        audioManager.stopCallStreaming();

        showSystemMessage('Llamada terminada');
        updateCallUI(false);
        callInProgress = null;
    }
}

function handleCallEvent(event) {
    if (!event) return;

    if (event.type === 'incoming') {
        // Llamada entrante
        if (confirm(`¿Aceptar llamada de ${event.from}?`)) {
            iceProxy.acceptCall(event.callKey);
            callInProgress = { callKey: event.callKey, remoteId: event.from, startTime: Date.now() };
            updateCallUI(true, event.callKey);

            // Iniciar streaming de audio
            audioManager.startCallStreaming(event.callKey, event.from);
        } else {
            iceProxy.rejectCall(event.callKey);
        }
    } 
    else if (event.type === 'accepted') {
        showSystemMessage('Llamada aceptada');
        updateCallUI(true, event.callKey);
        // Iniciar streaming de audio
        audioManager.startCallStreaming(event.callKey, appState.currentChat.id);
    }
    else if (event.type === 'rejected') {
        showSystemMessage('Llamada rechazada');
        updateCallUI(false);
        callInProgress = null;
    }
    else if (event.type === 'ended') {
        showSystemMessage('Llamada terminada por el otro usuario');
        audioManager.stopCallStreaming();
        updateCallUI(false);
        callInProgress = null;
    }
}

function updateCallUI(inCall, callKey = null) {
    const startBtn = document.getElementById('startCallBtn');
    const endBtn = document.getElementById('endCallBtn');

    if (inCall) {
        startBtn.style.display = 'none';
        endBtn.style.display = 'block';
        showSystemMessage('📞 En llamada...');
    } else {
        startBtn.style.display = 'block';
        endBtn.style.display = 'none';
    }
}

function handleAudioEvent(event) {
    if (!event) return;

    if (event.type === 'call-audio-chunk' && callInProgress) {
        // Enviar chunk de audio durante llamada
        iceProxy.sendAudioChunk(event.callKey, event.data);
    }
}

// ==================== UI - Renderizado ====================
function selectChat(type, id) {
    appState.currentChat = { type, id };
    clearMessages();
    
    // Actualizar header
    if (type === 'user') {
        document.getElementById('chatTitle').textContent = `Usuario ${id}`;
    } else {
        document.getElementById('chatTitle').textContent = id;
    }

    // Mostrar controles de audio
    const recordBtn = document.getElementById('recordVoiceBtn');
    const callBtn = document.getElementById('startCallBtn');
    if (recordBtn) recordBtn.style.display = 'block';
    if (callBtn && type === 'user') callBtn.style.display = 'block';
    if (callBtn && type !== 'user') callBtn.style.display = 'none';

    document.getElementById('messageInputContainer').style.display = 'block';
}

function clearMessages() {
    const container = document.getElementById('messagesContainer');
    if (container) container.innerHTML = '';
}

function addMessageToUI(messageData) {
    const { type, from, content, timestamp } = messageData;
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.innerHTML = `
        <div class="message-bubble">
            <div class="message-header">
                <span class="message-sender">${type === 'sent' ? 'Tú' : `Usuario ${from}`}</span>
                <span class="message-timestamp">${timestamp}</span>
            </div>
            <div class="message-content">${escapeHtml(content)}</div>
        </div>
    `;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function addVoiceNoteToUI(voiceData) {
    const { type, from, filename, timestamp } = voiceData;
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.innerHTML = `
        <div class="message-bubble">
            <div class="message-header">
                <span class="message-sender">${type === 'sent' ? 'Tú' : `Usuario ${from}`}</span>
                <span class="message-timestamp">${timestamp}</span>
            </div>
            <div class="message-voice">
                <button class="btn-play-voice" onclick="playVoiceFromFilename('${filename}')">🔊 Reproducir</button>
                <small>${filename}</small>
            </div>
        </div>
    `;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function showSystemMessage(message) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'system-message';
    div.textContent = message;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ==================== Utilidades ====================
function handleCreateGroup(groupName) {
    fetch(PROXY_URL + '/api/groups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: appState.clientId, groupName })
    }).then(() => {
        appState.groups.push(groupName);
        saveLocalData();
        showSystemMessage(`Grupo '${groupName}' creado`);
    });
}

function handleLogout() {
    if (confirm('¿Desconectarse?')) {
        fetch(PROXY_URL + '/api/disconnect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: appState.clientId })
        }).then(() => {
            sessionStorage.removeItem('clientId');
            window.location.href = 'index.html';
        });
    }
}

function loadLocalData() {
    try {
        const contacts = localStorage.getItem('chatApp_contacts');
        if (contacts) appState.contacts = JSON.parse(contacts);
    } catch (err) {
        console.error('[App] Error cargando datos locales:', err);
    }
}

function saveLocalData() {
    localStorage.setItem('chatApp_contacts', JSON.stringify(appState.contacts));
}

function startPolling() {
    // Polling cada 2 segundos para mensajes nuevos y clientes online
    loadOnlineClients(); // Cargar clientes inicialmente
    loadContacts();      // Cargar contactos inicialmente
    
    setInterval(async () => {
        try {
            const res = await fetch(PROXY_URL + '/api/messages/' + appState.clientId);
            const data = await res.json();
            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => handleRemoteMessage(msg));
            }
        } catch (err) {
            console.error('[App] Error en polling:', err);
        }
    }, 2000);

    // Refrescar clientes online cada 5 segundos
    setInterval(loadOnlineClients, 5000);
}

async function loadOnlineClients() {
    try {
        const res = await fetch(PROXY_URL + '/api/clients');
        if (!res.ok) {
            console.warn('[App] API /api/clients no disponible, mostrando lista vacía');
            displayOnlineClients([]);
            return;
        }
        const data = await res.json();
        appState.onlineClients = data.clients || [];
        displayOnlineClients(appState.onlineClients);
    } catch (err) {
        console.error('[App] Error cargando clientes online:', err);
        displayOnlineClients([]);
    }
}

function displayOnlineClients(clients) {
    const list = document.getElementById('onlineClientsList');
    if (!list) return;

    if (!clients || clients.length === 0) {
        list.innerHTML = '<p class="empty-message">No hay clientes conectados</p>';
        return;
    }

    list.innerHTML = clients
        .filter(c => c.id !== appState.clientId) // Excluir el cliente actual
        .map(client => `
            <div class="contact-item" onclick="handleSelectClientAsContact(${client.id}, '${client.name || 'Usuario ' + client.id}')">
                <span class="contact-name">${client.name || 'Usuario ' + client.id}</span>
                <span class="contact-status online">●</span>
            </div>
        `)
        .join('');
}

function handleSelectClientAsContact(clientId, clientName) {
    // Agregar a contactos automáticamente
    const contact = { id: clientId, name: clientName, type: 'user' };
    
    // Verificar si ya existe
    const exists = appState.contacts.some(c => c.id === clientId);
    if (!exists) {
        appState.contacts.push(contact);
        saveLocalData();
        showSystemMessage(`${clientName} agregado a contactos`);
    }

    // Abrir el chat con el contacto
    selectChat('user', clientId, clientName);
}

function loadContacts() {
    displayContacts();
}

function displayContacts() {
    const list = document.getElementById('contactsList');
    if (!list) return;

    if (!appState.contacts || appState.contacts.length === 0) {
        list.innerHTML = '<p class="empty-message">No hay contactos</p>';
        return;
    }

    list.innerHTML = appState.contacts
        .map(contact => `
            <div class="contact-item" onclick="selectChat('user', ${contact.id}, '${contact.name}')">
                <span class="contact-name">${contact.name}</span>
            </div>
        `)
        .join('');
}

function loadGroups() {
    displayGroups();
}

function displayGroups() {
    const list = document.getElementById('groupsList');
    if (!list) return;

    if (!appState.groups || appState.groups.length === 0) {
        list.innerHTML = '<p class="empty-message">No hay grupos</p>';
        return;
    }

    list.innerHTML = appState.groups
        .map(group => `
            <div class="contact-item" onclick="selectChat('group', '${group}', '${group}')">
                <span class="contact-name">${group}</span>
            </div>
        `)
        .join('');
}

function handleAddContact() {
    const contactId = prompt('ID del usuario:');
    if (!contactId) return;
    
    const contactName = prompt('Nombre (opcional):') || `Usuario ${contactId}`;
    const contact = { id: parseInt(contactId), name: contactName, type: 'user' };
    
    const exists = appState.contacts.some(c => c.id === parseInt(contactId));
    if (!exists) {
        appState.contacts.push(contact);
        saveLocalData();
        displayContacts();
        showSystemMessage(`${contactName} agregado a contactos`);
    } else {
        showSystemMessage('Este contacto ya existe');
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function playVoiceFromFilename(filename) {
    // Obtener la URL del archivo de voz desde el proxy
    const voiceUrl = PROXY_URL + '/api/voice/user-' + appState.clientId + '/' + filename;
    const audio = new Audio(voiceUrl);
    audio.play();
}

// Exportar para uso global en HTML
window.selectChat = selectChat;
window.playVoiceFromFilename = playVoiceFromFilename;
