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
app.listen(PORT, () => {
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
