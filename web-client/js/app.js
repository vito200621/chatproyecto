// ==================== Configuración ====================
const PROXY_URL = 'http://localhost:3000';

// ==================== Estado de la Aplicación ====================
const appState = {
    clientId: null,
    currentChat: null, // { type: 'user' | 'group', id: number | name: string }
    contacts: [],
    groups: [],
    messages: [],
    onlineClients: [],
    pollingInterval: null
};

// ==================== Inicialización ====================
document.addEventListener('DOMContentLoaded', () => {
    // Verificar sesión
    const clientId = sessionStorage.getItem('clientId');
    if (!clientId) {
        window.location.href = 'index.html';
        return;
    }

    appState.clientId = parseInt(clientId);
    document.getElementById('currentUserId').textContent = clientId;

    // Event Listeners
    setupEventListeners();

    // Cargar datos guardados localmente
    loadLocalData();

    // Iniciar polling de mensajes y clientes
    startPolling();

    // Cargar clientes conectados
    loadOnlineClients();
});

// ==================== Event Listeners ====================
function setupEventListeners() {
    // Logout
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Crear grupo
    document.getElementById('createGroupBtn').addEventListener('click', () => {
        showModal('createGroupModal');
    });

    // Agregar contacto
    document.getElementById('addContactBtn').addEventListener('click', () => {
        showModal('addContactModal');
    });

    // Refrescar clientes online
    document.getElementById('refreshClientsBtn').addEventListener('click', () => {
        loadOnlineClients();
    });

    // Cargar historial
    document.getElementById('loadHistoryBtn').addEventListener('click', handleLoadHistory);

    // Enviar mensaje
    document.getElementById('messageForm').addEventListener('submit', handleSendMessage);

    // Forms de modales
    document.getElementById('createGroupForm').addEventListener('submit', handleCreateGroup);
    document.getElementById('addContactForm').addEventListener('submit', handleAddContact);

    // Cerrar modales
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            hideModal(modal.id);
        });
    });

    // Cerrar modal al hacer click fuera
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideModal(modal.id);
            }
        });
    });
}

// ==================== Manejo de Logout ====================
async function handleLogout() {
    if (!confirm('¿Estás seguro que deseas desconectarte?')) {
        return;
    }

    try {
        await fetch(`${PROXY_URL}/api/disconnect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: appState.clientId })
        });
    } catch (error) {
        console.error('Error al desconectar:', error);
    }

    sessionStorage.removeItem('clientId');
    window.location.href = 'index.html';
}

// ==================== Manejo de Grupos ====================
async function handleCreateGroup(e) {
    e.preventDefault();

    const groupName = document.getElementById('groupNameInput').value.trim();

    if (!groupName) {
        alert('Por favor ingresa un nombre de grupo');
        return;
    }

    try {
        const response = await fetch(`${PROXY_URL}/api/groups/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: appState.clientId,
                groupName
            })
        });

        const data = await response.json();

        if (data.success) {
            // Agregar grupo a la lista
            addGroupToList(groupName);

            // Limpiar form y cerrar modal
            document.getElementById('groupNameInput').value = '';
            hideModal('createGroupModal');

            showNotification('Grupo creado exitosamente', 'success');
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al crear el grupo');
    }
}

function addGroupToList(groupName) {
    // Verificar si ya existe
    if (appState.groups.includes(groupName)) {
        return;
    }

    appState.groups.push(groupName);
    saveLocalData();
    renderGroups();
}

function renderGroups() {
    const groupsList = document.getElementById('groupsList');

    if (appState.groups.length === 0) {
        groupsList.innerHTML = '<p class="empty-message">No hay grupos disponibles</p>';
        return;
    }

    groupsList.innerHTML = appState.groups.map(groupName => `
        <div class="group-item" data-group="${groupName}">
            <span class="group-icon">👥</span>
            <div class="group-info">
                <div class="group-name">${groupName}</div>
            </div>
        </div>
    `).join('');

    // Event listeners para seleccionar grupo
    groupsList.querySelectorAll('.group-item').forEach(item => {
        item.addEventListener('click', () => {
            const groupName = item.dataset.group;
            selectChat('group', groupName);
        });
    });
}

// ==================== Manejo de Contactos ====================
async function handleAddContact(e) {
    e.preventDefault();

    const contactId = parseInt(document.getElementById('contactIdInput').value);
    const contactName = document.getElementById('contactNameInput').value.trim();

    if (!contactId || contactId === appState.clientId) {
        alert('Por favor ingresa un ID válido diferente al tuyo');
        return;
    }

    // Agregar contacto
    addContactToList(contactId, contactName || `Usuario ${contactId}`);

    // Limpiar form y cerrar modal
    document.getElementById('contactIdInput').value = '';
    document.getElementById('contactNameInput').value = '';
    hideModal('addContactModal');

    showNotification('Contacto agregado exitosamente', 'success');
}

function addContactToList(contactId, contactName) {
    // Verificar si ya existe
    if (appState.contacts.find(c => c.id === contactId)) {
        return;
    }

    appState.contacts.push({ id: contactId, name: contactName });
    saveLocalData();
    renderContacts();
}

function renderContacts() {
    const contactsList = document.getElementById('contactsList');

    if (appState.contacts.length === 0) {
        contactsList.innerHTML = '<p class="empty-message">No hay contactos disponibles</p>';
        return;
    }

    contactsList.innerHTML = appState.contacts.map(contact => `
        <div class="contact-item" data-id="${contact.id}">
            <span class="contact-icon">👤</span>
            <div class="contact-info">
                <div class="contact-name">${contact.name}</div>
                <div class="contact-id">ID: ${contact.id}</div>
            </div>
        </div>
    `).join('');

    // Event listeners para seleccionar contacto
    contactsList.querySelectorAll('.contact-item').forEach(item => {
        item.addEventListener('click', () => {
            const contactId = parseInt(item.dataset.id);
            selectChat('user', contactId);
        });
    });
}

// ==================== Selección de Chat ====================
function selectChat(type, id) {
    appState.currentChat = { type, id };

    // Actualizar UI
    updateChatHeader();
    clearMessages();
    showMessageInput();

    // Marcar como activo
    document.querySelectorAll('.contact-item, .group-item').forEach(item => {
        item.classList.remove('active');
    });

    if (type === 'user') {
        const item = document.querySelector(`.contact-item[data-id="${id}"]`);
        if (item) item.classList.add('active');
    } else {
        const item = document.querySelector(`.group-item[data-group="${id}"]`);
        if (item) item.classList.add('active');
    }

    // Mostrar botón de cargar historial
    document.getElementById('loadHistoryBtn').style.display = 'block';
}

function updateChatHeader() {
    const { type, id } = appState.currentChat;

    if (type === 'user') {
        const contact = appState.contacts.find(c => c.id === id);
        document.getElementById('chatTitle').textContent = contact ? contact.name : `Usuario ${id}`;
        document.getElementById('chatSubtitle').textContent = `ID: ${id}`;
    } else {
        document.getElementById('chatTitle').textContent = id;
        document.getElementById('chatSubtitle').textContent = 'Grupo';
    }
}

function showMessageInput() {
    document.getElementById('messageInputContainer').style.display = 'block';
}

// ==================== Envío de Mensajes ====================
async function handleSendMessage(e) {
    e.preventDefault();

    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();

    if (!message || !appState.currentChat) {
        return;
    }

    const { type, id } = appState.currentChat;

    try {
        let endpoint = '';
        let body = {
            clientId: appState.clientId,
            message
        };

        if (type === 'user') {
            endpoint = `${PROXY_URL}/api/messages/user`;
            body.targetId = id;
        } else {
            endpoint = `${PROXY_URL}/api/messages/group`;
            body.groupName = id;
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (data.success) {
            // Agregar mensaje a la UI
            addMessageToUI({
                type: 'sent',
                from: appState.clientId,
                content: message,
                timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
            });

            // Limpiar input
            messageInput.value = '';
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al enviar el mensaje');
    }
}

// ==================== Manejo de Historial ====================
async function handleLoadHistory() {
    if (!appState.currentChat) {
        return;
    }

    const { type, id } = appState.currentChat;

    try {
        let endpoint = '';

        if (type === 'user') {
            endpoint = `${PROXY_URL}/api/history/user/${appState.clientId}/${id}`;
        } else {
            endpoint = `${PROXY_URL}/api/history/group/${id}`;
        }

        const response = await fetch(endpoint);
        const data = await response.json();

        if (data.success) {
            clearMessages();

            // Renderizar mensajes de texto
            data.messages.forEach(msg => {
                const isSent = msg.from === appState.clientId;
                addMessageToUI({
                    type: isSent ? 'sent' : 'received',
                    from: msg.from,
                    content: msg.content,
                    timestamp: msg.timestamp
                });
            });

            // Renderizar notas de voz
            data.voiceNotes.forEach(voice => {
                const isSent = voice.from === appState.clientId;
                addVoiceNoteToUI({
                    type: isSent ? 'sent' : 'received',
                    from: voice.from,
                    filename: voice.filename,
                    timestamp: voice.timestamp
                });
            });

            showNotification('Historial cargado exitosamente', 'success');
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al cargar el historial');
    }
}

// ==================== Renderizado de Mensajes ====================
function clearMessages() {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';
}

function addMessageToUI(messageData) {
    const { type, from, content, timestamp } = messageData;

    const container = document.getElementById('messagesContainer');

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const senderName = type === 'sent' ? 'Tú' : `Usuario ${from}`;

    messageDiv.innerHTML = `
        <div class="message-bubble">
            <div class="message-header">
                <span class="message-sender">${senderName}</span>
                <span class="message-timestamp">${timestamp}</span>
            </div>
            <div class="message-content">${escapeHtml(content)}</div>
        </div>
    `;

    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

function addVoiceNoteToUI(voiceData) {
    const { type, from, filename, timestamp } = voiceData;

    const container = document.getElementById('messagesContainer');

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const senderName = type === 'sent' ? 'Tú' : `Usuario ${from}`;

    messageDiv.innerHTML = `
        <div class="message-bubble">
            <div class="message-header">
                <span class="message-sender">${senderName}</span>
                <span class="message-timestamp">${timestamp}</span>
            </div>
            <div class="message-voice">
                <span class="message-voice-icon">🎤</span>
                <div class="message-voice-info">
                    <div>Nota de voz</div>
                    <small>${filename}</small>
                </div>
            </div>
        </div>
    `;

    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
}

// ==================== Modales ====================
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add('active');
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('active');
}

// ==================== Notificaciones ====================
function showNotification(message, type = 'info') {
    // Simple console log por ahora
    // Puedes implementar un sistema de toast/snackbar más sofisticado
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// ==================== Almacenamiento Local ====================
function saveLocalData() {
    localStorage.setItem('chatApp_contacts', JSON.stringify(appState.contacts));
    localStorage.setItem('chatApp_groups', JSON.stringify(appState.groups));
}

function loadLocalData() {
    try {
        const contacts = localStorage.getItem('chatApp_contacts');
        const groups = localStorage.getItem('chatApp_groups');

        if (contacts) {
            appState.contacts = JSON.parse(contacts);
        }

        if (groups) {
            appState.groups = JSON.parse(groups);
        }

        renderContacts();
        renderGroups();
    } catch (error) {
        console.error('Error al cargar datos locales:', error);
    }
}

// ==================== Polling de Mensajes ====================
function startPolling() {
    // Polling cada 1 segundo para mensajes nuevos
    appState.pollingInterval = setInterval(async () => {
        await pollMessages();
        await loadOnlineClients();
    }, 1000);
}

function stopPolling() {
    if (appState.pollingInterval) {
        clearInterval(appState.pollingInterval);
        appState.pollingInterval = null;
    }
}

async function pollMessages() {
    try {
        const response = await fetch(`${PROXY_URL}/api/messages/${appState.clientId}`);
        const data = await response.json();

        if (data.success && data.messages.length > 0) {
            data.messages.forEach(msg => {
                processIncomingMessage(msg.content);
            });
        }
    } catch (error) {
        console.error('Error en polling:', error);
    }
}

function processIncomingMessage(message) {
    console.log('[Cliente] Mensaje recibido:', message);

    // Parsear el mensaje según el formato del servidor
    // Ejemplos:
    // "[Privado] de 1: Hola"
    // "[Grupo] Usuario 1: Hola"
    // "Group 'Test' created and you have joined it."

    if (message.startsWith('[Privado]')) {
        // Mensaje privado recibido
        const match = message.match(/\[Privado\] de (\d+): (.+)/);
        if (match && appState.currentChat && appState.currentChat.type === 'user') {
            const fromId = parseInt(match[1]);
            const content = match[2];

            if (appState.currentChat.id === fromId) {
                addMessageToUI({
                    type: 'received',
                    from: fromId,
                    content: content,
                    timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                });
            }
        }
    } else if (message.includes('Usuario')) {
        // Mensaje de grupo: "[Grupo] Usuario 1: Hola"
        const match = message.match(/\[(.+?)\] Usuario (\d+): (.+)/);
        if (match && appState.currentChat && appState.currentChat.type === 'group') {
            const groupName = match[1];
            const fromId = parseInt(match[2]);
            const content = match[3];

            if (appState.currentChat.id === groupName) {
                addMessageToUI({
                    type: 'received',
                    from: fromId,
                    content: content,
                    timestamp: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                });
            }
        }
    } else {
        // Mensajes del sistema (notificaciones)
        showSystemMessage(message);
    }
}

function showSystemMessage(message) {
    // Mostrar mensaje del sistema en el área de mensajes si hay chat activo
    if (appState.currentChat) {
        const container = document.getElementById('messagesContainer');
        const systemDiv = document.createElement('div');
        systemDiv.className = 'system-message';
        systemDiv.textContent = message;
        container.appendChild(systemDiv);
        container.scrollTop = container.scrollHeight;
    }
}

async function loadOnlineClients() {
    try {
        const response = await fetch(`${PROXY_URL}/api/clients`);
        const data = await response.json();

        if (data.success) {
            appState.onlineClients = data.clients;
            renderOnlineClients();
        }
    } catch (error) {
        console.error('Error al cargar clientes:', error);
    }
}

function renderOnlineClients() {
    const onlineList = document.getElementById('onlineClientsList');

    // Filtrar para no mostrar el cliente actual
    const otherClients = appState.onlineClients.filter(c => c.id !== appState.clientId);

    if (otherClients.length === 0) {
        onlineList.innerHTML = '<p class="empty-message">No hay otros clientes conectados</p>';
        return;
    }

    onlineList.innerHTML = otherClients.map(client => `
        <div class="contact-item online-client" data-id="${client.id}">
            <span class="contact-icon">🟢</span>
            <div class="contact-info">
                <div class="contact-name">Usuario ${client.id}</div>
                <div class="contact-id">Conectado</div>
            </div>
        </div>
    `).join('');

    // Event listeners para seleccionar cliente online
    onlineList.querySelectorAll('.online-client').forEach(item => {
        item.addEventListener('click', () => {
            const clientId = parseInt(item.dataset.id);
            selectChat('user', clientId);

            // Auto-agregar a contactos si no existe
            if (!appState.contacts.find(c => c.id === clientId)) {
                addContactToList(clientId, `Usuario ${clientId}`);
            }
        });
    });
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Detener polling al cerrar la página
window.addEventListener('beforeunload', () => {
    stopPolling();
});
