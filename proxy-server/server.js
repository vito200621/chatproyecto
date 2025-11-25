const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const TCPClient = require('./tcpClient');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../web-client')));

// Crear servidor HTTP explícito para adjuntar WebSocket
const http = require('http');
const { WebSocketServer } = require('ws');

// Pool de conexiones TCP
const server = http.createServer(app);

// Mapa de conexiones WebSocket por clientId (cuando se registren)
const wsClients = new Map();
// Mapeo de llamadas activas: "fromId->toId" -> { initiator, receiver, startTime }
const activeCalls = new Map();

// Crear WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('[WS] Nueva conexión');

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (msg) => {
        try {
            // Soportar mensajes JSON y binarios
            if (typeof msg === 'string') {
                const data = JSON.parse(msg);
                
                if (data.type === 'register' && data.clientId) {
                    ws.clientId = data.clientId;
                    wsClients.set(data.clientId, ws);
                    ws.send(JSON.stringify({ type: 'registered', clientId: data.clientId }));
                    console.log('[WS] Cliente registrado:', data.clientId);
                }
                
                else if (data.type === 'voicenote') {
                    // Envío de nota de voz (grabación de mensaje)
                    const { toType, target, filename, base64 } = data;
                    if (!toType || !target || !base64) return;
                    const buffer = Buffer.from(base64, 'base64');
                    const tcpClient = connections.get(data.fromClientId || data.clientId);
                    if (!tcpClient) {
                        ws.send(JSON.stringify({ type: 'error', message: 'No conectado al servidor Java' }));
                        return;
                    }

                    try {
                        if (toType === 'user') {
                            await tcpClient.sendVoiceNoteToUser(target, filename, buffer);
                        } else if (toType === 'group') {
                            await tcpClient.sendVoiceNoteToGroup(target, filename, buffer);
                        }
                        ws.send(JSON.stringify({ type: 'voicenote-sent', toType, target, filename }));
                    } catch (err) {
                        console.error('[WS] Error enviando nota de voz:', err.message);
                        ws.send(JSON.stringify({ type: 'error', message: 'Error al enviar nota: ' + err.message }));
                    }
                }
                
                else if (data.type === 'call-start') {
                    // Iniciar llamada entre dos usuarios
                    const { callerId, receiverId } = data;
                    const callKey = `${callerId}->${receiverId}`;
                    activeCalls.set(callKey, { initiator: ws.clientId, receiver: receiverId, startTime: Date.now() });
                    
                    console.log('[WS] Llamada iniciada:', callKey);
                    
                    // Notificar al receptor si está conectado
                    if (wsClients.has(receiverId)) {
                        wsClients.get(receiverId).send(JSON.stringify({ 
                            type: 'call-incoming', 
                            callerId,
                            callKey 
                        }));
                    }
                }
                
                else if (data.type === 'call-accept') {
                    // Aceptar llamada
                    const { callKey } = data;
                    if (activeCalls.has(callKey)) {
                        const call = activeCalls.get(callKey);
                        const [from, to] = callKey.split('->');
                        console.log('[WS] Llamada aceptada:', callKey);
                        
                        // Notificar al iniciador
                        if (wsClients.has(from)) {
                            wsClients.get(from).send(JSON.stringify({ 
                                type: 'call-accepted', 
                                callKey 
                            }));
                        }
                    }
                }
                
                else if (data.type === 'call-end') {
                    // Terminar llamada
                    const { callKey } = data;
                    activeCalls.delete(callKey);
                    const [from, to] = callKey.split('->');
                    console.log('[WS] Llamada terminada:', callKey);
                    
                    // Notificar al otro usuario
                    const otherClient = from === ws.clientId ? to : from;
                    if (wsClients.has(otherClient)) {
                        wsClients.get(otherClient).send(JSON.stringify({ 
                            type: 'call-ended', 
                            callKey 
                        }));
                    }
                }
                
                else if (data.type === 'call-reject') {
                    // Rechazar llamada
                    const { callKey } = data;
                    activeCalls.delete(callKey);
                    const [from, to] = callKey.split('->');
                    console.log('[WS] Llamada rechazada:', callKey);
                    
                    if (wsClients.has(from)) {
                        wsClients.get(from).send(JSON.stringify({ 
                            type: 'call-rejected', 
                            callKey 
                        }));
                    }
                }
                
            } else if (Buffer.isBuffer(msg)) {
                // Mensaje binario: streaming de audio durante llamada
                try {
                    const jsonSize = msg.readUInt32BE(0);
                    const jsonStr = msg.toString('utf8', 4, 4 + jsonSize);
                    const metadata = JSON.parse(jsonStr);
                    const audioData = msg.slice(4 + jsonSize);
                    
                    const { callKey, from } = metadata;
                    const [fromId, toId] = callKey.split('->');
                    const targetId = from === fromId ? toId : fromId;
                    
                    // Reenviar audio al otro usuario en la llamada
                    if (wsClients.has(targetId)) {
                        wsClients.get(targetId).send(msg);
                    }
                } catch (err) {
                    console.error('[WS] Error procesando audio binario:', err.message);
                }
            }
        } catch (err) {
            console.error('[WS] Error manejando mensaje:', err.message);
        }
    });

    ws.on('close', () => {
        if (ws.clientId) {
            wsClients.delete(ws.clientId);
            // Terminar cualquier llamada activa de este usuario
            for (const [callKey, call] of activeCalls) {
                if (callKey.includes(ws.clientId)) {
                    activeCalls.delete(callKey);
                    const [from, to] = callKey.split('->');
                    const otherUser = from === ws.clientId ? to : from;
                    if (wsClients.has(otherUser)) {
                        wsClients.get(otherUser).send(JSON.stringify({ 
                            type: 'call-ended', 
                            callKey 
                        }));
                    }
                }
            }
        }
    });
});

// Ping/pong para mantener conexiones
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// Pool de conexiones TCP
const connections = new Map();

// Configuración del servidor Java
const JAVA_SERVER_HOST = process.env.JAVA_HOST || 'localhost';
const JAVA_SERVER_PORT = process.env.JAVA_PORT || 5000;

/**
 * Endpoint: Conectar al servidor Java
 * POST /api/connect
 */
app.post('/api/connect', async (req, res) => {
    try {
        const tcpClient = new TCPClient(JAVA_SERVER_HOST, JAVA_SERVER_PORT);
        const clientId = await tcpClient.connect();

        // Guardar la conexión en el pool
        connections.set(clientId, tcpClient);

        console.log(`[Proxy] Cliente ${clientId} conectado`);

        res.json({
            success: true,
            clientId: clientId,
            message: 'Conectado al servidor exitosamente'
        });
    } catch (error) {
        console.error('[Proxy] Error al conectar:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Endpoint: Desconectar del servidor
 * POST /api/disconnect
 */
app.post('/api/disconnect', (req, res) => {
    const { clientId } = req.body;

    if (!clientId || !connections.has(clientId)) {
        return res.status(400).json({
            success: false,
            error: 'Cliente no encontrado'
        });
    }

    const tcpClient = connections.get(clientId);
    tcpClient.disconnect();
    connections.delete(clientId);

    console.log(`[Proxy] Cliente ${clientId} desconectado`);

    res.json({
        success: true,
        message: 'Desconectado exitosamente'
    });
});

/**
 * Endpoint: Crear grupo
 * POST /api/groups/create
 */
app.post('/api/groups/create', async (req, res) => {
    const { clientId, groupName } = req.body;

    if (!clientId || !groupName) {
        return res.status(400).json({
            success: false,
            error: 'clientId y groupName son requeridos'
        });
    }

    const tcpClient = connections.get(clientId);
    if (!tcpClient) {
        return res.status(404).json({
            success: false,
            error: 'Cliente no conectado'
        });
    }

    try {
        await tcpClient.createGroup(groupName);
        res.json({
            success: true,
            message: `Grupo '${groupName}' creado exitosamente`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Endpoint: Unirse a grupo
 * POST /api/groups/join
 */
app.post('/api/groups/join', async (req, res) => {
    const { clientId, groupName } = req.body;

    if (!clientId || !groupName) {
        return res.status(400).json({
            success: false,
            error: 'clientId y groupName son requeridos'
        });
    }

    const tcpClient = connections.get(clientId);
    if (!tcpClient) {
        return res.status(404).json({
            success: false,
            error: 'Cliente no conectado'
        });
    }

    try {
        await tcpClient.joinGroup(groupName);
        res.json({
            success: true,
            message: `Unido al grupo '${groupName}' exitosamente`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Endpoint: Enviar mensaje privado
 * POST /api/messages/user
 */
app.post('/api/messages/user', async (req, res) => {
    const { clientId, targetId, message } = req.body;

    if (!clientId || !targetId || !message) {
        return res.status(400).json({
            success: false,
            error: 'clientId, targetId y message son requeridos'
        });
    }

    const tcpClient = connections.get(clientId);
    if (!tcpClient) {
        return res.status(404).json({
            success: false,
            error: 'Cliente no conectado'
        });
    }

    try {
        await tcpClient.sendPrivateMessage(targetId, message);
        res.json({
            success: true,
            message: 'Mensaje enviado exitosamente'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Endpoint: Enviar mensaje a grupo
 * POST /api/messages/group
 */
app.post('/api/messages/group', async (req, res) => {
    const { clientId, groupName, message } = req.body;

    if (!clientId || !groupName || !message) {
        return res.status(400).json({
            success: false,
            error: 'clientId, groupName y message son requeridos'
        });
    }

    const tcpClient = connections.get(clientId);
    if (!tcpClient) {
        return res.status(404).json({
            success: false,
            error: 'Cliente no conectado'
        });
    }

    try {
        await tcpClient.sendGroupMessage(groupName, message);
        res.json({
            success: true,
            message: 'Mensaje enviado al grupo exitosamente'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Endpoint: Obtener historial de conversación privada
 * GET /api/history/user/:fromId/:toId
 */
app.get('/api/history/user/:fromId/:toId', (req, res) => {
    const { fromId, toId } = req.params;

    // Calcular el nombre del archivo de historial
    const min = Math.min(parseInt(fromId), parseInt(toId));
    const max = Math.max(parseInt(fromId), parseInt(toId));
    const filename = `user-${min}_${max}.log`;
    const filepath = path.join(__dirname, '../history', filename);

    // Verificar si existe el archivo
    if (!fs.existsSync(filepath)) {
        return res.json({
            success: true,
            messages: [],
            voiceNotes: []
        });
    }

    try {
        // Leer el archivo de historial
        const content = fs.readFileSync(filepath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());

        const messages = [];
        const voiceNotes = [];

        lines.forEach(line => {
            // Parsear cada línea: [timestamp] user-X -> user-Y | mensaje
            const match = line.match(/\[(.*?)\]\s+user-(\d+)\s+->\s+user-(\d+)\s+\|\s+(.+)/);
            if (match) {
                const [, timestamp, from, to, content] = match;

                if (content.startsWith('[voice]')) {
                    const voiceFile = content.replace('[voice] ', '').trim();
                    voiceNotes.push({
                        timestamp,
                        from: parseInt(from),
                        to: parseInt(to),
                        filename: voiceFile
                    });
                } else {
                    messages.push({
                        timestamp,
                        from: parseInt(from),
                        to: parseInt(to),
                        content
                    });
                }
            }
        });

        res.json({
            success: true,
            messages,
            voiceNotes
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Endpoint: Obtener historial de grupo
 * GET /api/history/group/:groupName
 */
app.get('/api/history/group/:groupName', (req, res) => {
    const { groupName } = req.params;

    const filename = `group-${groupName}.log`;
    const filepath = path.join(__dirname, '../history', filename);

    // Verificar si existe el archivo
    if (!fs.existsSync(filepath)) {
        return res.json({
            success: true,
            messages: [],
            voiceNotes: []
        });
    }

    try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());

        const messages = [];
        const voiceNotes = [];

        lines.forEach(line => {
            // Parsear: [timestamp] user-X @groupName | mensaje
            const match = line.match(/\[(.*?)\]\s+user-(\d+)\s+@(\S+)\s+\|\s+(.+)/);
            if (match) {
                const [, timestamp, from, group, content] = match;

                if (content.startsWith('[voice]')) {
                    const voiceFile = content.replace('[voice] ', '').trim();
                    voiceNotes.push({
                        timestamp,
                        from: parseInt(from),
                        group,
                        filename: voiceFile
                    });
                } else {
                    messages.push({
                        timestamp,
                        from: parseInt(from),
                        group,
                        content
                    });
                }
            }
        });

        res.json({
            success: true,
            messages,
            voiceNotes
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Endpoint: Verificar estado de conexión
 * GET /api/status/:clientId
 */
app.get('/api/status/:clientId', (req, res) => {
    const { clientId } = req.params;
    const tcpClient = connections.get(parseInt(clientId));

    if (!tcpClient) {
        return res.json({
            connected: false
        });
    }

    res.json({
        connected: tcpClient.isConnected(),
        clientId: tcpClient.getClientId()
    });
});

/**
 * Endpoint: Obtener lista de clientes conectados
 * GET /api/clients
 */
app.get('/api/clients', (req, res) => {
    const clients = [];

    connections.forEach((tcpClient, clientId) => {
        if (tcpClient.isConnected()) {
            clients.push({
                id: clientId,
                connected: true
            });
        }
    });

    res.json({
        success: true,
        clients: clients
    });
});

/**
 * Endpoint: Servir archivo de nota de voz
 * GET /api/voice/:conv/:filename
 */
app.get('/api/voice/:conv/:filename', (req, res) => {
    const { conv, filename } = req.params;
    let dirName = conv;
    if (!dirName.endsWith('_voice')) dirName = dirName + '_voice';
    const filepath = path.join(__dirname, '../history', dirName, filename);
    if (!fs.existsSync(filepath)) {
        return res.status(404).send('Not found');
    }
    res.sendFile(filepath);
});

/**
 * Endpoint: Obtener mensajes nuevos (polling)
 * GET /api/messages/:clientId
 */
app.get('/api/messages/:clientId', (req, res) => {
    const { clientId } = req.params;
    const tcpClient = connections.get(parseInt(clientId));

    if (!tcpClient) {
        return res.status(404).json({
            success: false,
            error: 'Cliente no conectado'
        });
    }

    const messages = tcpClient.getMessages();

    res.json({
        success: true,
        messages: messages
    });
});

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`[Proxy Server] Escuchando en http://localhost:${PORT}`);
    console.log(`[Proxy Server] Servidor Java en ${JAVA_SERVER_HOST}:${JAVA_SERVER_PORT}`);
});

// Manejo de cierre
process.on('SIGINT', () => {
    console.log('\n[Proxy Server] Cerrando conexiones...');
    connections.forEach((tcpClient, clientId) => {
        console.log(`[Proxy Server] Desconectando cliente ${clientId}`);
        tcpClient.disconnect();
    });
    process.exit(0);
});
