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

// Helper: configurar manejadores WS en una instancia dada
function setupWebSocketServer(wssInstance) {
    wssInstance.on('connection', (ws) => {
        console.log('[WS] 📱 Nueva conexión WebSocket desde cliente');

        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        // Nota: ws v8+ provee flag isBinary para distinguir texto/binario
        ws.on('message', async (msg, isBinary) => {
        try {
            // Soportar mensajes JSON y binarios
            if (!isBinary && typeof msg === 'string') {
                const data = JSON.parse(msg);
                console.log(`[WS] Mensaje recibido: type=${data.type}, clientId=${data.clientId}`);
                
                if (data.type === 'register' && data.clientId) {
                    // Si ya existe una conexión registrada con ese clientId, cerrarla para evitar duplicados
                    const existing = wsClients.get(data.clientId);
                    if (existing && existing !== ws) {
                        try { existing.terminate(); } catch (_) {}
                        wsClients.delete(data.clientId);
                    }
                    ws.clientId = data.clientId;
                    wsClients.set(data.clientId, ws);
                    ws.send(JSON.stringify({ type: 'registered', clientId: data.clientId }));
                    console.log(`[WS] ✅ Cliente ${data.clientId} registrado exitosamente`);
                    console.log(`[WS] 📊 Total clientes WebSocket: ${wsClients.size}`);
                }
                
                else if (data.type === 'voicenote') {
                    // Envío de nota de voz (grabación de mensaje)
                    const { toType, target, filename, base64, fromClientId } = data;
                    if (!toType || !target || !base64) return;
                    const buffer = Buffer.from(base64, 'base64');
                    const senderId = fromClientId || data.clientId || ws.clientId;
                    const tcpClient = connections.get(senderId);

                    // Determinar la carpeta de destino
                    let voiceDir;
                    if (toType === 'user') {
                        const min = Math.min(parseInt(senderId), parseInt(target));
                        const max = Math.max(parseInt(senderId), parseInt(target));
                        voiceDir = path.join(__dirname, '../history', `user-${min}_${max}_voice`);
                    } else {
                        voiceDir = path.join(__dirname, '../history', `group-${target}_voice`);
                    }

                    // Crear directorio si no existe y guardar archivo
                    try {
                        if (!fs.existsSync(voiceDir)) {
                            fs.mkdirSync(voiceDir, { recursive: true });
                        }
                        const filePath = path.join(voiceDir, filename);
                        fs.writeFileSync(filePath, buffer);
                        console.log(`[WS] ✅ Audio guardado: ${filePath}`);
                    } catch (err) {
                        console.error('[WS] Error guardando audio localmente:', err.message);
                    }

                    // Si hay conexión TCP, intentar enviar también al servidor Java
                    if (tcpClient) {
                        try {
                            if (toType === 'user') {
                                await tcpClient.sendVoiceNoteToUser(target, filename, buffer);
                            } else if (toType === 'group') {
                                await tcpClient.sendVoiceNoteToGroup(target, filename, buffer);
                            }
                            console.log('[WS] Audio también enviado al servidor Java');
                        } catch (err) {
                            console.warn('[WS] No se pudo enviar al servidor Java:', err.message);
                        }
                    }

                    // Notificar al destinatario via WebSocket
                    if (toType === 'user' && wsClients.has(parseInt(target))) {
                        wsClients.get(parseInt(target)).send(JSON.stringify({
                            type: 'voicenote',
                            from: senderId,
                            toType,
                            target,
                            filename
                        }));
                    } else if (toType === 'group') {
                        // Enviar a todos los miembros del grupo conectados
                        wsClients.forEach((client, clientId) => {
                            if (clientId !== senderId) {
                                try {
                                    client.send(JSON.stringify({
                                        type: 'voicenote',
                                        from: senderId,
                                        toType,
                                        target,
                                        filename
                                    }));
                                } catch (_) {}
                            }
                        });
                    }

                    ws.send(JSON.stringify({ type: 'voicenote-sent', toType, target, filename }));
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
                
            } else if (Buffer.isBuffer(msg) || isBinary) {
                // Mensaje binario: streaming de audio durante llamada
                try {
                    const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);

                    // Manejar caso donde llega JSON como binario (algunos navegadores o proxies)
                    if (buf.length > 0 && (buf[0] === 0x7B /* { */ || buf[0] === 0x5B /* [ */)) {
                        try {
                            const jsonStr = buf.toString('utf8');
                            const data = JSON.parse(jsonStr);
                            // Reinyectar a la misma lógica JSON sin duplicar código
                            if (data && data.type) {
                                // Emular mensaje de texto
                                // Nota: evitamos recursión llamando bloque JSON inline
                                if (data.type === 'register' && data.clientId) {
                                    ws.clientId = data.clientId;
                                    wsClients.set(data.clientId, ws);
                                    ws.send(JSON.stringify({ type: 'registered', clientId: data.clientId }));
                                    console.log(`[WS] ✅ Cliente ${data.clientId} registrado exitosamente`);
                                    console.log(`[WS] 📊 Total clientes WebSocket: ${wsClients.size}`);
                                } else if (data.type === 'voicenote') {
                                    const { toType, target, filename, base64, fromClientId } = data;
                                    if (!toType || !target || !base64) return;
                                    const buffer = Buffer.from(base64, 'base64');
                                    const senderId = fromClientId || data.clientId || ws.clientId;
                                    const tcpClient = connections.get(senderId);

                                    // Determinar la carpeta de destino
                                    let voiceDir;
                                    if (toType === 'user') {
                                        const min = Math.min(parseInt(senderId), parseInt(target));
                                        const max = Math.max(parseInt(senderId), parseInt(target));
                                        voiceDir = path.join(__dirname, '../history', `user-${min}_${max}_voice`);
                                    } else {
                                        voiceDir = path.join(__dirname, '../history', `group-${target}_voice`);
                                    }

                                    // Crear directorio y guardar archivo
                                    try {
                                        if (!fs.existsSync(voiceDir)) {
                                            fs.mkdirSync(voiceDir, { recursive: true });
                                        }
                                        const filePath = path.join(voiceDir, filename);
                                        fs.writeFileSync(filePath, buffer);
                                        console.log(`[WS] ✅ Audio guardado: ${filePath}`);
                                    } catch (err) {
                                        console.error('[WS] Error guardando audio:', err.message);
                                    }

                                    // Intentar enviar al servidor Java si hay conexión
                                    if (tcpClient) {
                                        try {
                                            if (toType === 'user') {
                                                await tcpClient.sendVoiceNoteToUser(target, filename, buffer);
                                            } else if (toType === 'group') {
                                                await tcpClient.sendVoiceNoteToGroup(target, filename, buffer);
                                            }
                                            console.log('[WS] Audio enviado al servidor Java');
                                        } catch (err) {
                                            console.warn('[WS] No se pudo enviar al servidor Java:', err.message);
                                        }
                                    }

                                    // Notificar destinatario via WebSocket
                                    if (toType === 'user' && wsClients.has(parseInt(target))) {
                                        wsClients.get(parseInt(target)).send(JSON.stringify({
                                            type: 'voicenote',
                                            from: senderId,
                                            toType,
                                            target,
                                            filename
                                        }));
                                    } else if (toType === 'group') {
                                        wsClients.forEach((client, clientId) => {
                                            if (clientId !== senderId) {
                                                try {
                                                    client.send(JSON.stringify({
                                                        type: 'voicenote',
                                                        from: senderId,
                                                        toType,
                                                        target,
                                                        filename
                                                    }));
                                                } catch (_) {}
                                            }
                                        });
                                    }

                                    ws.send(JSON.stringify({ type: 'voicenote-sent', toType, target, filename }));
                                } else if (data.type === 'call-start') {
                                    const { callerId, receiverId } = data;
                                    const callKey = `${callerId}->${receiverId}`;
                                    activeCalls.set(callKey, { initiator: ws.clientId, receiver: receiverId, startTime: Date.now() });
                                    console.log('[WS] Llamada iniciada:', callKey);
                                    if (wsClients.has(receiverId)) {
                                        wsClients.get(receiverId).send(JSON.stringify({ type: 'call-incoming', callerId, callKey }));
                                    }
                                } else if (data.type === 'call-accept') {
                                    const { callKey } = data;
                                    if (activeCalls.has(callKey)) {
                                        const [from, to] = callKey.split('->');
                                        console.log('[WS] Llamada aceptada:', callKey);
                                        if (wsClients.has(from)) {
                                            wsClients.get(from).send(JSON.stringify({ type: 'call-accepted', callKey }));
                                        }
                                    }
                                } else if (data.type === 'call-end') {
                                    const { callKey } = data;
                                    activeCalls.delete(callKey);
                                    const [from, to] = callKey.split('->');
                                    console.log('[WS] Llamada terminada:', callKey);
                                    const otherClient = from === ws.clientId ? to : from;
                                    if (wsClients.has(otherClient)) {
                                        wsClients.get(otherClient).send(JSON.stringify({ type: 'call-ended', callKey }));
                                    }
                                } else if (data.type === 'call-reject') {
                                    const { callKey } = data;
                                    activeCalls.delete(callKey);
                                    const [from] = callKey.split('->');
                                    console.log('[WS] Llamada rechazada:', callKey);
                                    if (wsClients.has(from)) {
                                        wsClients.get(from).send(JSON.stringify({ type: 'call-rejected', callKey }));
                                    }
                                }
                                return; // ya procesado como JSON
                            }
                        } catch (e) {
                            // Si falla, continuar como binario
                        }
                    }

                    // Validar tamaño mínimo (4 bytes para UInt32BE + datos)
                    if (buf.length < 4) {
                        console.warn('[WS] Buffer binario muy pequeño, ignorando');
                        return;
                    }
                    const jsonSize = buf.readUInt32BE(0);

                    // Validar que el tamaño declarado sea razonable (máx 10KB para metadata)
                    if (jsonSize > 10 * 1024 || jsonSize < 2) {
                        console.warn('[WS] Tamaño JSON inválido:', jsonSize, 'ignorando buffer');
                        return;
                    }

                    // Validar que haya suficientes bytes
                    if (buf.length < 4 + jsonSize) {
                        console.warn('[WS] Buffer incompleto esperado', 4 + jsonSize, 'recibido', buf.length);
                        return;
                    }

                    try {
                        const jsonStr = buf.toString('utf8', 4, 4 + jsonSize);
                        const metadata = JSON.parse(jsonStr);
                        const audioData = buf.slice(4 + jsonSize);
                        
                        const { callKey, from } = metadata;
                        if (!callKey || !from) {
                            console.warn('[WS] Metadata incompleta, falta callKey o from');
                            return;
                        }
                        // Validar que la llamada esté activa
                        if (!activeCalls.has(callKey)) {
                            console.warn('[WS] Audio recibido para llamada inexistente:', callKey);
                            return;
                        }

                        const [fromId, toId] = callKey.split('->');
                        const targetId = from === fromId ? toId : fromId;
                        
                        // Reenviar audio al otro usuario en la llamada
                        if (wsClients.has(targetId)) {
                            wsClients.get(targetId).send(buf, { binary: true });
                        }
                    } catch (jsonErr) {
                        console.warn('[WS] JSON parse error:', jsonErr.message, 'primeros 50 bytes:', buf.slice(4, 54).toString('utf8', 0, 50));
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
                console.log(`[WS] 👋 Cliente ${ws.clientId} desconectado`);
                wsClients.delete(ws.clientId);
                console.log(`[WS] 📊 Clientes WebSocket restantes: ${wsClients.size}`);
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
}

// Crear WebSocket server (HTTP)
const wss = new WebSocketServer({ server });
setupWebSocketServer(wss);

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
// Contador simple para asignar IDs sin necesidad de TCP
let clientCounter = 1000;

/**
 * Endpoint: Conectar al servidor Java
 * POST /api/connect
 * Intenta conectar a TCP pero falla gracefully
 */
app.post('/api/connect', async (req, res) => {
    try {
        // Intentar conexión TCP al servidor Java
        const tcpClient = new TCPClient(JAVA_SERVER_HOST, JAVA_SERVER_PORT);
        const clientId = await tcpClient.connect();

        // Guardar la conexión en el pool
        connections.set(clientId, tcpClient);
        console.log(`[Proxy] Cliente ${clientId} conectado a TCP`);

        res.json({
            success: true,
            clientId: clientId,
            message: 'Conectado al servidor exitosamente'
        });
    } catch (error) {
        console.error('[Proxy] Error en /api/connect:', error.message);
        // No asignar IDs locales: forzar al usuario a conectar al backend real
        res.status(503).json({
            success: false,
            error: 'No se pudo conectar al servidor Java. Verifica que el backend esté corriendo y accesible.',
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

        // Espejar en historial local del proxy para persistencia robusta
        try {
            appendPrivateHistory(Number(clientId), Number(targetId), message);
        } catch (e) {
            console.warn('[History] No se pudo espejar historial privado:', e.message);
        }

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

        // Espejar en historial local del proxy para persistencia robusta
        try {
            appendGroupHistory(String(groupName), Number(clientId), message);
        } catch (e) {
            console.warn('[History] No se pudo espejar historial de grupo:', e.message);
        }

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
    const filesToMerge = [
        path.join(__dirname, '../history', filename),
        path.join(__dirname, '../server/history', filename)
    ];

    try {
        const lines = [];
        for (const fp of filesToMerge) {
            if (fs.existsSync(fp)) {
                const content = fs.readFileSync(fp, 'utf-8');
                content.split('\n').forEach(l => { if (l && l.trim()) lines.push(l.trim()); });
            }
        }

        const messages = [];
        const voiceNotes = [];

        for (const line of lines) {
            const match = line.match(/\[(.*?)\]\s+user-(\d+)\s+->\s+user-(\d+)\s+\|\s+(.+)/);
            if (match) {
                const [, timestamp, from, to, content] = match;
                if (content.startsWith('[voice]')) {
                    const voiceFile = content.replace('[voice] ', '').trim();
                    voiceNotes.push({ timestamp, from: parseInt(from), to: parseInt(to), filename: voiceFile });
                } else {
                    messages.push({ timestamp, from: parseInt(from), to: parseInt(to), content });
                }
            }
        }

        // Ordenar por timestamp ascendente
        const byTs = (a, b) => String(a.timestamp).localeCompare(String(b.timestamp));
        messages.sort(byTs);
        voiceNotes.sort(byTs);

        // Deduplicar por clave estable
        const seenMsg = new Set();
        const dedupMessages = [];
        for (const m of messages) {
            const key = `${m.timestamp}|${m.from}|${m.to}|${m.content}`;
            if (!seenMsg.has(key)) { seenMsg.add(key); dedupMessages.push(m); }
        }
        const seenVn = new Set();
        const dedupVoice = [];
        for (const v of voiceNotes) {
            const key = `${v.timestamp}|${v.from}|${v.to}|${v.filename}`;
            if (!seenVn.has(key)) { seenVn.add(key); dedupVoice.push(v); }
        }

        res.json({ success: true, messages: dedupMessages, voiceNotes: dedupVoice });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Endpoint: Obtener historial de grupo
 * GET /api/history/group/:groupName
 */
app.get('/api/history/group/:groupName', (req, res) => {
    const { groupName } = req.params;

    const filename = `group-${groupName}.log`;
    const filesToMerge = [
        path.join(__dirname, '../history', filename),
        path.join(__dirname, '../server/history', filename)
    ];

    try {
        const lines = [];
        for (const fp of filesToMerge) {
            if (fs.existsSync(fp)) {
                const content = fs.readFileSync(fp, 'utf-8');
                content.split('\n').forEach(l => { if (l && l.trim()) lines.push(l.trim()); });
            }
        }

        const messages = [];
        const voiceNotes = [];

        for (const line of lines) {
            const match = line.match(/\[(.*?)\]\s+user-(\d+)\s+@(\S+)\s+\|\s+(.+)/);
            if (match) {
                const [, timestamp, from, group, content] = match;
                if (content.startsWith('[voice]')) {
                    const voiceFile = content.replace('[voice] ', '').trim();
                    voiceNotes.push({ timestamp, from: parseInt(from), group, filename: voiceFile });
                } else {
                    messages.push({ timestamp, from: parseInt(from), group, content });
                }
            }
        }

        const byTs = (a, b) => String(a.timestamp).localeCompare(String(b.timestamp));
        messages.sort(byTs);
        voiceNotes.sort(byTs);

        const seenMsg = new Set();
        const dedupMessages = [];
        for (const m of messages) {
            const key = `${m.timestamp}|${m.from}|${m.group}|${m.content}`;
            if (!seenMsg.has(key)) { seenMsg.add(key); dedupMessages.push(m); }
        }
        const seenVn = new Set();
        const dedupVoice = [];
        for (const v of voiceNotes) {
            const key = `${v.timestamp}|${v.from}|${v.group}|${v.filename}`;
            if (!seenVn.has(key)) { seenVn.add(key); dedupVoice.push(v); }
        }

        res.json({ success: true, messages: dedupMessages, voiceNotes: dedupVoice });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
    // Merge por id y listar fuentes
    const merged = new Map();

    connections.forEach((tcpClient, clientId) => {
        if (!tcpClient.isConnected()) return;
        const id = Number(clientId);
        const current = merged.get(id) || { id, connected: true, sources: [] };
        if (!current.sources.includes('tcp')) current.sources.push('tcp');
        merged.set(id, current);
    });

    wsClients.forEach((ws, clientId) => {
        const id = Number(clientId);
        const current = merged.get(id) || { id, connected: true, sources: [] };
        if (!current.sources.includes('websocket')) current.sources.push('websocket');
        merged.set(id, current);
    });

    const clients = Array.from(merged.values());

    console.log(`[API] 📊 /api/clients solicitado -> TCP: ${connections.size}, WebSocket: ${wsClients.size}, Total: ${clients.length}`);

    res.json({
        success: true,
        clients,
        stats: {
            tcp_connections: connections.size,
            websocket_clients: wsClients.size,
            total_unique: clients.length,
            timestamp: new Date().toISOString()
        }
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
    const candidates = [
        path.join(__dirname, '../history', dirName, filename),
        path.join(__dirname, '../server/history', dirName, filename)
    ];
    for (const fp of candidates) {
        if (fs.existsSync(fp)) {
            // Forzar Content-Type apropiado según extensión
            const lower = String(filename).toLowerCase();
            if (lower.endsWith('.wav')) {
                res.type('audio/wav');
            } else if (lower.endsWith('.webm')) {
                res.type('audio/webm');
            }
            return res.sendFile(fp);
        }
    }
    return res.status(404).send('Not found');
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

    // Espejar en historial local del proxy los mensajes entrantes para persistencia
    try {
        for (const m of messages) {
            const text = (m && m.content) ? String(m.content) : '';
            // [Privado] de X: mensaje
            const priv = text.match(/^\[Privado\]\s+de\s+(\d+)\s*:\s*(.*)$/);
            // [Grupo] o [Nombre] Usuario X: mensaje
            const grp = text.match(/^\[(.+?)\]\s+Usuario\s+(\d+)\s*:\s*(.*)$/);

            if (priv) {
                const from = Number(priv[1]);
                const body = priv[2];
                try { appendPrivateHistory(from, Number(clientId), body); } catch (_) {}
            } else if (grp) {
                const groupName = String(grp[1]);
                const from = Number(grp[2]);
                const body = grp[3];
                try { appendGroupHistory(groupName, from, body); } catch (_) {}
            }
        }
    } catch (e) {
        console.warn('[History] Espejo de mensajes entrantes falló:', e.message);
    }

    res.json({
        success: true,
        messages: messages
    });
});

/**
 * Endpoint: Listar grupos existentes (usando una conexión TCP real)
 * GET /api/groups?clientId=123
 */
app.get('/api/groups', async (req, res) => {
    try {
        const clientId = parseInt(req.query.clientId);
        if (!clientId) {
            return res.json({ success: true, groups: [] });
        }

        // Si no está conectado al servidor Java, devolver lista vacía (no es error)
        if (!connections.has(clientId)) {
            console.log(`[API] Cliente ${clientId} no conectado al servidor Java, devolviendo lista vacía de grupos`);
            return res.json({ success: true, groups: [] });
        }

        const tcpClient = connections.get(clientId);
        try {
            const groups = await tcpClient.listGroupsWait(2000);
            res.json({ success: true, groups });
        } catch (err) {
            console.warn(`[API] Error obteniendo grupos para cliente ${clientId}:`, err.message);
            // Devolver lista vacía en lugar de error 500
            res.json({ success: true, groups: [] });
        }
    } catch (e) {
        console.error('[API] Error listando grupos:', e);
        res.json({ success: true, groups: [] });
    }
});

// Iniciar servidor en todas las interfaces
const os = require('os');

function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }
    return ips;
}

server.listen(PORT, '0.0.0.0', () => {
    const localIPs = getLocalIPs();
    console.log(`\n[Proxy Server] Escuchando en http://0.0.0.0:${PORT}`);
    console.log(`[Proxy Server] Accede desde esta PC: http://localhost:${PORT}`);
    if (localIPs.length > 0) {
        console.log(`[Proxy Server] Accede desde otra PC en red local:`);
        localIPs.forEach(ip => {
            console.log(`  → http://${ip}:${PORT}`);
        });
    }
    console.log(`[Proxy Server] Servidor Java en ${JAVA_SERVER_HOST}:${JAVA_SERVER_PORT}\n`);
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

// ===================== HTTPS opcional (para micrófono) =====================
try {
    const httpsEnabled = process.env.HTTPS === '1' || process.env.HTTPS === 'true';
    const certDir = path.join(__dirname, 'certs');
    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.pem');
    if (httpsEnabled || (fs.existsSync(keyPath) && fs.existsSync(certPath))) {
        const https = require('https');
        const options = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        const HTTPS_PORT = process.env.HTTPS_PORT ? parseInt(process.env.HTTPS_PORT) : 3443;
        const httpsServer = https.createServer(options, app);
        const wssHttps = new WebSocketServer({ server: httpsServer });
        setupWebSocketServer(wssHttps);

        httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
            const localIPs = getLocalIPs();
            console.log(`\n[Proxy Server] HTTPS activo en https://0.0.0.0:${HTTPS_PORT}`);
            console.log(`[Proxy Server] Accede desde esta PC: https://localhost:${HTTPS_PORT}`);
            if (localIPs.length > 0) {
                console.log(`[Proxy Server] Accede por IP local (requiere confiar el certificado):`);
                localIPs.forEach(ip => console.log(`  → https://${ip}:${HTTPS_PORT}`));
            }
            console.log(`[Proxy Server] Recuerda usar wss:// cuando abras por https.`);
        });
    } else {
        console.log('[Proxy Server] HTTPS no habilitado (defina HTTPS=1 y agregue certs/key.pem, certs/cert.pem para activarlo).');
    }
} catch (e) {
    console.warn('[Proxy Server] No se pudo habilitar HTTPS:', e.message);
}

// ===================== Utilidades de Historial (Proxy Mirror) =====================
function ensureDir(dirPath) {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
    } catch (_) {}
}

function nowTs() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function appendLine(filePath, line) {
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, `[${nowTs()}] ${line}\n`, { encoding: 'utf8' });
}

function appendPrivateHistory(fromId, toId, message) {
    const a = Math.min(Number(fromId), Number(toId));
    const b = Math.max(Number(fromId), Number(toId));
    const file = path.join(__dirname, '../history', `user-${a}_${b}.log`);
    appendLine(file, `user-${fromId} -> user-${toId} | ${message}`);
}

function appendGroupHistory(groupName, fromId, message) {
    const file = path.join(__dirname, '../history', `group-${groupName}.log`);
    appendLine(file, `user-${fromId} @${groupName} | ${message}`);
}
