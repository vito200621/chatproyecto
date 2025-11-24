// ==================== Configuración ====================
const PROXY_URL = 'http://localhost:3000';
let iceClient = null;
let currentIceUser = null;

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
        // Importar dinámicamente el cliente Ice
        const { default: IceChatClient } = await import('./js/ice/IceClient.js');
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

    setupEventListeners();
    loadLocalData();
    startPolling();
    loadOnlineClients();

    showSystemMessage("Usando conexión HTTP - Polling activado");
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