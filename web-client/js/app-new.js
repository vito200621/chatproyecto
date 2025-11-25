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
    // Grupos a los que este cliente ya se ha unido (persistente local)
    joinedGroups: new Set(),
    contacts: [],
    onlineClients: [],
    activeCalls: new Map(),
    // almacenamiento local por conversación
    // clave: user:min_max o group:GroupName
    conversations: {},
    unread: {
        users: new Map(),   // id -> count
        groups: new Map()   // name -> count
    }
};

// ==================== Configuración ====================
// Detectar URL del proxy automáticamente (http/https y puerto actuales)
const __proto = window.location.protocol === 'https:' ? 'https' : 'http';
const __wsProto = __proto === 'https' ? 'wss' : 'ws';
const __host = window.location.host; // incluye puerto actual
const PROXY_URL = `${__proto}://${__host}`;
const WS_URL = `${__wsProto}://${__host}`;

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
    // Cargar grupos reales al inicio
    try { await loadGroups(); } catch (_) {}
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

        // Optimistic UI: guardar y pintar antes de enviar
        const now = new Date();
        const localMsg = {
            type: 'sent',
            from: appState.clientId,
            content: message,
            // Timestamp canónico ISO para ordenar y deduplicar
            tsIso: now.toISOString(),
            // Etiqueta amigable para UI
            timestamp: now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        };
        storeMessage(type, id, localMsg);
        addMessageToUI(localMsg);
        input.value = '';

        const res = await fetch(PROXY_URL + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            // Opcional: marcar error en UI
            showSystemMessage('No se pudo enviar el mensaje (se reintentará)');
        }
    } catch (err) {
        console.error('[App] Error enviando mensaje:', err);
        alert('Error al enviar mensaje');
    }
}

function handleRemoteMessage(msg) {
    if (!msg) return;
    console.log('[App] Mensaje remoto:', msg);
    const content = msg.content || '';
    const rxTsIso = msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString();
    const tsLabel = new Date(rxTsIso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    // Detectar privado: "[Privado] de X: mensaje"
    const priv = content.match(/^\[Privado\]\s+de\s+(\d+)\s*:\s*(.*)$/);
    // Detectar grupo: "[Grupo] Usuario X: mensaje" o "[<nombre>] Usuario X: mensaje"
    const grp = content.match(/^\[(.+?)\]\s+Usuario\s+(\d+)\s*:\s*(.*)$/);

    if (priv) {
        const fromId = parseInt(priv[1]);
        const body = priv[2];
        // Guardar siempre en el store
        storeMessage('user', fromId, { type: 'received', from: fromId, content: body, tsIso: rxTsIso, timestamp: tsLabel });
        if (appState.currentChat && appState.currentChat.type === 'user' && appState.currentChat.id === fromId) {
            addMessageToUI({ type: 'received', from: fromId, content: body, tsIso: rxTsIso, timestamp: tsLabel });
        } else {
            // Incrementar no leídos y asegurar presencia en contactos
            incrementUnread('user', fromId);
            ensureContact(fromId, `Usuario ${fromId}`);
            displayContacts();
            console.log('[App] Msg privado para otro chat. No leídos:', getUnread('user', fromId));
        }
        return;
    }
    if (grp) {
        const groupName = grp[1];
        const fromId = parseInt(grp[2]);
        const body = grp[3];
        // Guardar siempre en el store
        storeMessage('group', groupName, { type: 'received', from: fromId, content: body, tsIso: rxTsIso, timestamp: tsLabel });
        if (appState.currentChat && appState.currentChat.type === 'group' && appState.currentChat.id === groupName) {
            addMessageToUI({ type: 'received', from: fromId, content: body, tsIso: rxTsIso, timestamp: tsLabel });
        } else {
            // Incrementar no leídos de grupo y asegurar listado
            incrementUnread('group', groupName);
            if (!appState.groups.includes(groupName)) {
                appState.groups.push(groupName);
            }
            displayGroups();
            console.log('[App] Msg de grupo para otro chat. Grupo:', groupName, 'No leídos:', getUnread('group', groupName));
        }
        return;
    }
    // Si no coincide con los patrones específicos, detectar si es mensaje del sistema
    // Filtrar solo mensajes claramente del sistema (listados, comandos, etc.)
    const isSystemMessage = content.includes('---') ||
                           content.includes('Únete con:') ||
                           content.includes('GRUPOS DISPONIBLES') ||
                           content.includes('miembros)') ||
                           content.startsWith('/') ||
                           content === '';

    if (isSystemMessage) {
        console.log('[App] Mensaje del sistema ignorado:', content);
        return;
    }

    // Si es un mensaje normal que no matcheó los patrones, intentar mostrarlo
    if (appState.currentChat) {
        const data = {
            type: 'received',
            from: msg.from || msg.sender || 'Desconocido',
            content: content,
            tsIso: rxTsIso,
            timestamp: tsLabel
        };
        storeMessage(appState.currentChat.type, appState.currentChat.id, data);
        addMessageToUI(data);
    }
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
            const filename = `voice_${Date.now()}.wav`;

            await iceProxy.sendVoiceNote(id, targetType, blob, filename);
            showSystemMessage('Nota de voz enviada');
            // Agregar a la UI como nota enviada (sin autoplay)
            addVoiceNoteToUI({
                type: 'sent',
                from: appState.clientId,
                filename,
                timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
            });
            storeVoiceNote(type, id, { type: 'sent', from: appState.clientId, filename, timestamp: new Date().toISOString() });
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
    } else if (data.type === 'voicenote') {
        // Nota de voz recibida (no autoplay). Pintar si corresponde; en cualquier caso almacenar
        console.log('[App] Nota de voz recibida de:', data.from);
        const note = {
            type: 'received',
            from: data.from,
            filename: data.filename,
            timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        };
        storeVoiceNote(data.toType === 'group' ? 'group' : 'user', data.toType === 'group' ? data.target : data.from, note);
        if (appState.currentChat &&
            ((appState.currentChat.type === 'user' && Number(appState.currentChat.id) === Number(data.from)) ||
             (appState.currentChat.type === 'group' && String(appState.currentChat.id) === String(data.target)))) {
            addVoiceNoteToUI(note);
        } else {
            // marcar no leído
            if (data.toType === 'group') incrementUnread('group', data.target);
            else incrementUnread('user', data.from);
            displayContacts();
            displayGroups();
        }
    }
}

// ==================== Manejo de Llamadas ====================
async function handleStartCall() {
    if (!appState.currentChat || appState.currentChat.type !== 'user') {
        alert('Selecciona un usuario para llamar');
        return;
    }

    try {
        // Pre-solicitar acceso al micrófono para asegurar prompt por gesto del usuario
        try { await audioManager.requestMicrophoneAccess(); } catch (e) {
            // Si falla, informar y no iniciar llamada
            showSystemMessage('No se pudo acceder al micrófono: ' + e.message);
            return;
        }
        const callKey = iceProxy.startCall(appState.currentChat.id);
        callInProgress = { callKey, remoteId: appState.currentChat.id, startTime: Date.now() };

        showSystemMessage('Llamada iniciada...');

        // UI de llamada
        updateCallUI(true, callKey);
        // Registrar en conversación como evento
        const otherId = appState.currentChat.id;
        storeMessage('user', otherId, { type: 'system', from: appState.clientId, content: '📞 Llamada iniciada', timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) });
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
        // Iniciar streaming de audio en ambos lados
        try {
            const [fromId, toId] = String(event.callKey).split('->');
            const remoteId = Number(fromId) === Number(appState.clientId) ? Number(toId) : Number(fromId);
            audioManager.startCallStreaming(event.callKey, remoteId);
            // Registrar en conversación
            storeMessage('user', remoteId, { type: 'system', from: appState.clientId, content: '✅ Llamada conectada', timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) });
        } catch (e) {
            console.warn('No se pudo iniciar streaming:', e.message);
            // Notificar fin de llamada si no se puede capturar audio
            try { iceProxy.endCall(event.callKey); } catch (_) {}
            updateCallUI(false);
        }
    }
    else if (event.type === 'rejected') {
        showSystemMessage('Llamada rechazada');
        updateCallUI(false);
        callInProgress = null;
        // Registrar evento
        const [fromId, toId] = String(event.callKey || '').split('->');
        const remoteId = Number(fromId) === Number(appState.clientId) ? Number(toId) : Number(fromId);
        if (!isNaN(remoteId)) {
            storeMessage('user', remoteId, { type: 'system', from: appState.clientId, content: '❌ Llamada rechazada', timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) });
        }
    }
    else if (event.type === 'ended') {
        showSystemMessage('Llamada terminada por el otro usuario');
        audioManager.stopCallStreaming();
        updateCallUI(false);
        callInProgress = null;
        // Registrar evento en la conversación correspondiente
        const [fromId, toId] = String(event.callKey || '').split('->');
        const remoteId = Number(fromId) === Number(appState.clientId) ? Number(toId) : Number(fromId);
        if (!isNaN(remoteId)) {
            storeMessage('user', remoteId, { type: 'system', from: appState.clientId, content: '🔚 Llamada finalizada', timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) });
        }
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
function selectChat(type, id, name) {
    appState.currentChat = { type, id };
    clearMessages();

    // Actualizar header
    const title = document.getElementById('chatTitle');
    if (title) title.textContent = type === 'user' ? (name || `Usuario ${id}`) : (name || String(id));
    const subtitle = document.getElementById('chatSubtitle');
    if (subtitle) subtitle.textContent = type === 'group' ? 'Chat grupal' : 'Chat privado';

    // Mostrar controles de audio
    const recordBtn = document.getElementById('recordVoiceBtn');
    const callBtn = document.getElementById('startCallBtn');
    if (recordBtn) recordBtn.style.display = 'block';
    if (callBtn) callBtn.style.display = type === 'user' ? 'block' : 'none';

    document.getElementById('messageInputContainer').style.display = 'block';

    // Limpiar no leídos para esta conversación
    clearUnread(type, id);
    if (type === 'user') displayContacts(); else displayGroups();

    // Pintar desde cache local primero
    renderConversation(type, id);

    // Luego cargar historial automáticamente (merge simple)
    if (type === 'user') {
        loadUserHistory(appState.clientId, id).catch(err => console.warn('Historial usuario error:', err));
    } else {
        loadGroupHistory(id).catch(err => console.warn('Historial grupo error:', err));
    }
}

function clearMessages() {
    const container = document.getElementById('messagesContainer');
    if (container) container.innerHTML = '';
}

function addMessageToUI(messageData) {
    const { type, from, content } = messageData;
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    // Mensajes de sistema
    if (type === 'system') {
        const sys = document.createElement('div');
        sys.className = 'system-message';
        const tsLabel = messageData.timestamp || (messageData.tsIso ? new Date(messageData.tsIso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '');
        sys.textContent = `${tsLabel ? `[${tsLabel}] ` : ''}${content}`;
        container.appendChild(sys);
        container.scrollTop = container.scrollHeight;
        return;
    }

    const div = document.createElement('div');
    div.className = `message ${type}`;
    const tsLabel = messageData.timestamp || (messageData.tsIso ? new Date(messageData.tsIso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '');
    div.innerHTML = `
        <div class="message-bubble">
            <div class="message-header">
                <span class="message-sender">${type === 'sent' ? 'Tú' : `Usuario ${from}`}</span>
                <span class="message-timestamp">${tsLabel}</span>
            </div>
            <div class="message-content">${escapeHtml(content)}</div>
        </div>
    `;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function addVoiceNoteToUI(voiceData) {
    const { type, from, filename } = voiceData;
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    const div = document.createElement('div');
    div.className = `message ${type}`;
    const tsLabel = voiceData.timestamp || (voiceData.tsIso ? new Date(voiceData.tsIso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '');
    div.innerHTML = `
        <div class="message-bubble">
            <div class="message-header">
                <span class="message-sender">${type === 'sent' ? 'Tú' : `Usuario ${from}`}</span>
                <span class="message-timestamp">${tsLabel}</span>
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
    }).then(async (res) => {
        showSystemMessage(`Grupo '${groupName}' creado`);
        // Marcar como unido localmente y refrescar vista
        appState.joinedGroups.add(groupName);
        saveJoinedGroups();
        await loadGroups();
    }).catch(err => console.error('Error creando grupo', err));
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
        const joined = localStorage.getItem('chatApp_joinedGroups_v1');
        if (joined) appState.joinedGroups = new Set(JSON.parse(joined));
        const convs = localStorage.getItem('chatApp_conversations_v1');
        if (convs) {
            const parsed = JSON.parse(convs);
            // Validar estructura
            if (parsed && typeof parsed === 'object') {
                appState.conversations = parsed;
            }
        }
        const unread = localStorage.getItem('chatApp_unread_v1');
        if (unread) {
            const u = JSON.parse(unread);
            if (u && u.users && u.groups) {
                appState.unread.users = new Map(u.users);
                appState.unread.groups = new Map(u.groups);
            }
        }
    } catch (err) {
        console.error('[App] Error cargando datos locales:', err);
    }
}

function saveLocalData() {
    localStorage.setItem('chatApp_contacts', JSON.stringify(appState.contacts));
}

function saveJoinedGroups() {
    try {
        localStorage.setItem('chatApp_joinedGroups_v1', JSON.stringify(Array.from(appState.joinedGroups)));
    } catch (_) {}
}

function saveConversations() {
    try {
        localStorage.setItem('chatApp_conversations_v1', JSON.stringify(appState.conversations));
    } catch (e) {
        // Si supera tamaño, ignorar silenciosamente
    }
}

function saveUnread() {
    try {
        const payload = {
            users: Array.from(appState.unread.users.entries()),
            groups: Array.from(appState.unread.groups.entries())
        };
        localStorage.setItem('chatApp_unread_v1', JSON.stringify(payload));
    } catch (_) {}
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

    // De-duplicar por id
    const byId = new Map();
    for (const c of clients) {
        if (Number(c.id) === Number(appState.clientId)) continue; // excluir self
        byId.set(Number(c.id), { id: Number(c.id), name: c.name, sources: c.sources });
    }

    list.innerHTML = Array.from(byId.values()).map(client => `
            <div class="contact-item" onclick="handleSelectClientAsContact(${client.id}, '${client.name || 'Usuario ' + client.id}')">
                <span class="contact-name">${client.name || 'Usuario ' + client.id}</span>
                <span class="contact-status online" title="${(client.sources||[]).join('+')}">●</span>
            </div>
        `).join('');
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
        .map(contact => {
            const unread = getUnread('user', contact.id);
            const badge = unread > 0 ? `<span class="badge">${unread}</span>` : '';
            return `
            <div class="contact-item" onclick="selectChat('user', ${contact.id}, '${contact.name}')">
                <span class="contact-name">${contact.name}</span>
                ${badge}
            </div>`;
        })
        .join('');
}

async function loadGroups() {
    try {
        const res = await fetch(`${PROXY_URL}/api/groups?clientId=${appState.clientId}`);
        const data = await res.json();
        if (data && data.success) {
            appState.groups = data.groups || [];
        } else {
            appState.groups = appState.groups || [];
        }
    } catch (err) {
        console.warn('[App] No se pudo cargar grupos:', err.message);
    }
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
        .map(group => {
            const unread = getUnread('group', group);
            const badge = unread > 0 ? `<span class="badge">${unread}</span>` : '';
            const joined = appState.joinedGroups.has(group);
            const actionBtn = joined 
                ? '' 
                : `<button class="btn btn-secondary" style="margin-left:auto" onclick="joinGroup('${group}')">Unirse</button>`;
            return `
            <div class="contact-item">
                <span class="contact-name" onclick="selectChat('group', '${group}', '${group}')">${group}</span>
                ${badge}
                ${actionBtn}
            </div>`;
        })
        .join('');
}

async function joinGroup(groupName) {
    try {
        const res = await fetch(PROXY_URL + '/api/groups/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: appState.clientId, groupName })
        });
        const data = await res.json();
        if (data && data.success) {
            showSystemMessage(`Te uniste al grupo '${groupName}'`);
            appState.joinedGroups.add(groupName);
            saveJoinedGroups();
            displayGroups();
            // Abrir el chat del grupo y cargar historial
            selectChat('group', groupName, groupName);
        } else {
            alert('No se pudo unir al grupo: ' + (data.error || 'Error desconocido'));
        }
    } catch (err) {
        alert('Error de red al unirse al grupo: ' + err.message);
    }
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
    // Construir la ruta correcta según la conversación actual
    if (!appState.currentChat) return;
    let conv;
    if (appState.currentChat.type === 'user') {
        const a = Math.min(Number(appState.clientId), Number(appState.currentChat.id));
        const b = Math.max(Number(appState.clientId), Number(appState.currentChat.id));
        conv = `user-${a}_${b}_voice`;
    } else {
        conv = `group-${appState.currentChat.id}_voice`;
    }
    const voiceUrl = `${PROXY_URL}/api/voice/${encodeURIComponent(conv)}/${encodeURIComponent(filename)}`;
    console.log('[App] Reproduciendo audio:', voiceUrl);

    const audio = new Audio(voiceUrl);
    audio.onerror = (e) => {
        console.error('[App] Error reproduciendo audio:', e);
        showSystemMessage('Error al reproducir audio: ' + filename);
    };
    audio.oncanplay = () => console.log('[App] Audio listo para reproducir');
    audio.play().catch(err => {
        console.error('[App] Error en play():', err);
        showSystemMessage('No se pudo reproducir el audio');
    });
}

// Exportar para uso global en HTML
window.selectChat = selectChat;
window.playVoiceFromFilename = playVoiceFromFilename;
window.joinGroup = joinGroup;

// ==================== Historial ====================
async function loadUserHistory(fromId, toId) {
    const res = await fetch(`${PROXY_URL}/api/history/user/${fromId}/${toId}`);
    const data = await res.json();
    if (!data || !data.success) return;

    // Actualizar el store con mensajes del servidor (deduplicación en storeMessage)
    (data.messages || []).forEach(m => {
        const type = m.from === fromId ? 'sent' : 'received';
        const tsIso = m.timestamp ? new Date(m.timestamp.replace(' ', 'T')).toISOString() : new Date().toISOString();
        const tsLabel = new Date(tsIso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const msg = { type, from: m.from, content: m.content, tsIso, timestamp: tsLabel };
        storeMessage('user', toId, msg);
    });

    (data.voiceNotes || []).forEach(v => {
        const tsIso = v.timestamp ? new Date(v.timestamp.replace(' ', 'T')).toISOString() : new Date().toISOString();
        const tsLabel = new Date(tsIso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const vn = { type: v.from === fromId ? 'sent' : 'received', from: v.from, filename: v.filename, tsIso, timestamp: tsLabel };
        storeVoiceNote('user', toId, vn);
    });

    // Re-renderizar toda la conversación con los datos actualizados y ordenados
    renderConversation('user', toId);
}

async function loadGroupHistory(groupName) {
    const res = await fetch(`${PROXY_URL}/api/history/group/${encodeURIComponent(groupName)}`);
    const data = await res.json();
    if (!data || !data.success) return;

    // Actualizar el store con mensajes del servidor (deduplicación en storeMessage)
    (data.messages || []).forEach(m => {
        const type = m.from === appState.clientId ? 'sent' : 'received';
        const tsIso = m.timestamp ? new Date(m.timestamp.replace(' ', 'T')).toISOString() : new Date().toISOString();
        const tsLabel = new Date(tsIso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const msg = { type, from: m.from, content: m.content, tsIso, timestamp: tsLabel };
        storeMessage('group', groupName, msg);
    });

    (data.voiceNotes || []).forEach(v => {
        const tsIso = v.timestamp ? new Date(v.timestamp.replace(' ', 'T')).toISOString() : new Date().toISOString();
        const tsLabel = new Date(tsIso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const vn = { type: v.from === appState.clientId ? 'sent' : 'received', from: v.from, filename: v.filename, tsIso, timestamp: tsLabel };
        storeVoiceNote('group', groupName, vn);
    });

    // Re-renderizar toda la conversación con los datos actualizados y ordenados
    renderConversation('group', groupName);
}

// ==================== No leídos ====================
function getUnread(type, key) {
    if (type === 'user') return appState.unread.users.get(Number(key)) || 0;
    return appState.unread.groups.get(String(key)) || 0;
}

function incrementUnread(type, key) {
    if (type === 'user') {
        const k = Number(key);
        appState.unread.users.set(k, (appState.unread.users.get(k) || 0) + 1);
    } else {
        const k = String(key);
        appState.unread.groups.set(k, (appState.unread.groups.get(k) || 0) + 1);
    }
    saveUnread();
}

function clearUnread(type, key) {
    if (type === 'user') {
        appState.unread.users.delete(Number(key));
    } else {
        appState.unread.groups.delete(String(key));
    }
    saveUnread();
}

function ensureContact(id, name) {
    const exists = appState.contacts.some(c => c.id === Number(id));
    if (!exists) {
        appState.contacts.push({ id: Number(id), name: name || `Usuario ${id}`, type: 'user' });
        saveLocalData();
    }
}

// ==================== Conversaciones (store local) ====================
function convKey(type, id) {
    if (type === 'user') {
        const a = Math.min(Number(appState.clientId), Number(id));
        const b = Math.max(Number(appState.clientId), Number(id));
        return `user:${a}_${b}`;
    }
    return `group:${String(id)}`;
}

function getOrCreateConversation(type, id) {
    const key = convKey(type, id);
    if (!appState.conversations[key]) {
        appState.conversations[key] = { messages: [], voiceNotes: [] };
    }
    return appState.conversations[key];
}

function storeMessage(type, id, message) {
    const conv = getOrCreateConversation(type, id);
    // Verificar que no exista duplicado antes de agregar
    const exists = conv.messages.some(m =>
        m.from === message.from &&
        m.content === message.content &&
        m.type === message.type
    );
    if (!exists) {
        conv.messages.push(message);
        saveConversations();
    }
}

function storeVoiceNote(type, id, note) {
    const conv = getOrCreateConversation(type, id);
    // Verificar que no exista duplicado antes de agregar
    const exists = conv.voiceNotes.some(v =>
        v.from === note.from &&
        v.filename === note.filename &&
        v.type === note.type
    );
    if (!exists) {
        conv.voiceNotes.push(note);
        saveConversations();
    }
}

function renderConversation(type, id) {
    const conv = getOrCreateConversation(type, id);
    clearMessages();

    // Combinar mensajes y notas de voz en una sola lista
    const allItems = [
        ...conv.messages.map(m => ({ ...m, itemType: 'message' })),
        ...conv.voiceNotes.map(v => ({ ...v, itemType: 'voiceNote' }))
    ];

    // Ordenar por tsIso ascendente (más antiguos primero, más recientes al final)
    allItems.sort((a, b) => {
        const aa = a.tsIso || a.timestamp || '';
        const bb = b.tsIso || b.timestamp || '';
        return String(aa).localeCompare(String(bb));
    });

    // Renderizar en orden (más antiguos arriba, más recientes abajo)
    for (const item of allItems) {
        if (item.itemType === 'message') {
            addMessageToUI(item);
        } else {
            addVoiceNoteToUI(item);
        }
    }

    // Scroll automático al final (último mensaje)
    const container = document.getElementById('messagesContainer');
    if (container) container.scrollTop = container.scrollHeight;
}

// Helpers para evitar duplicados al fusionar historial/polling
function messageExists(type, id, candidate) {
    const conv = getOrCreateConversation(type, id);
    // Comparar sin timestamp: solo from+content+type para evitar duplicados
    // El timestamp puede variar entre servidor y localStorage
    return conv.messages.some(m =>
        m.from === candidate.from &&
        m.content === candidate.content &&
        m.type === candidate.type
    );
}

function voiceNoteExists(type, id, candidate) {
    const conv = getOrCreateConversation(type, id);
    // Comparar sin timestamp: solo from+filename+type
    return conv.voiceNotes.some(v =>
        v.from === candidate.from &&
        v.filename === candidate.filename &&
        v.type === candidate.type
    );
}

// Guardado de emergencia al salir
window.addEventListener('beforeunload', () => {
    try {
        saveConversations();
        saveUnread();
        saveJoinedGroups();
        saveLocalData();
    } catch (_) {}
});
