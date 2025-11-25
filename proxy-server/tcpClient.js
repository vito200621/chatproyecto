const net = require('net');

/**
 * Clase que maneja la conexión TCP con el servidor Java
 */
class TCPClient {
    constructor(host = 'localhost', port = 5000) {
        this.host = host;
        this.port = port;
        this.socket = null;
        this.connected = false;
        this.clientId = null;
        this.messageCallback = null;
        // Múltiples listeners para eventos de línea recibida
        this.messageListeners = new Set();
        this.buffer = '';
        this.messageQueue = []; // Cola de mensajes entrantes
    }

    /**
     * Conectar al servidor Java
     */
    connect() {
        return new Promise((resolve, reject) => {
            this.socket = new net.Socket();

            this.socket.connect(this.port, this.host, () => {
                console.log(`[TCP] Conectado a ${this.host}:${this.port}`);
                this.connected = true;
            });

            this.socket.on('data', (data) => {
                this.buffer += data.toString();
                const lines = this.buffer.split('\n');

                // Guardar la última línea incompleta
                this.buffer = lines.pop();

                lines.forEach(line => {
                    if (line.trim()) {
                        this.handleMessage(line.trim());
                    }
                });
            });

            this.socket.on('error', (err) => {
                console.error('[TCP] Error:', err.message);
                this.connected = false;
                reject(err);
            });

            this.socket.on('close', () => {
                console.log('[TCP] Conexión cerrada');
                this.connected = false;
            });

            // Esperar el mensaje de conexión inicial del servidor
            this.socket.once('data', (data) => {
                const msg = data.toString().trim();
                console.log('[TCP] Mensaje inicial:', msg);

                // Extraer el ID del cliente del mensaje "Conectado al servidor. Tu id es X."
                const match = msg.match(/Tu id es (\d+)/);
                if (match) {
                    this.clientId = parseInt(match[1]);
                    console.log('[TCP] Client ID asignado:', this.clientId);
                    resolve(this.clientId);
                } else {
                    reject(new Error('No se pudo obtener el ID del cliente'));
                }
            });
        });
    }

    /**
     * Manejar mensajes entrantes del servidor
     */
    handleMessage(message) {
        console.log('[TCP] Mensaje recibido:', message);

        // Agregar a la cola de mensajes
        this.messageQueue.push({
            content: message,
            timestamp: new Date().toISOString()
        });

        if (this.messageCallback) {
            this.messageCallback(message);
        }
        // Notificar a listeners adicionales
        if (this.messageListeners && this.messageListeners.size > 0) {
            for (const fn of this.messageListeners) {
                try { fn(message); } catch (e) { /* ignore listener errors */ }
            }
        }
    }

    /**
     * Obtener mensajes pendientes y limpiar la cola
     */
    getMessages() {
        const messages = [...this.messageQueue];
        this.messageQueue = [];
        return messages;
    }

    /**
     * Registrar callback para mensajes entrantes
     */
    onMessage(callback) {
        this.messageCallback = callback;
    }

    /**
     * Añadir un listener temporal de mensajes de texto (por línea)
     */
    addMessageListener(fn) {
        this.messageListeners.add(fn);
        return () => this.messageListeners.delete(fn);
    }

    /**
     * Solicita al servidor la lista de grupos y espera la respuesta multi-línea
     * Formato esperado (desde ChatServer.listGroups):
     * --- GRUPOS DISPONIBLES ---
     * - <groupName> (<n> miembros)
     * ...
     * Únete con: /joinGroup <nombre>
     */
    async listGroupsWait(timeoutMs = 1500) {
        if (!this.connected) throw new Error('No conectado');

        return new Promise(async (resolve, reject) => {
            const lines = [];
            let started = false;
            const cancel = this.addMessageListener((line) => {
                if (line.includes('--- GRUPOS DISPONIBLES ---')) {
                    started = true;
                    lines.length = 0; // reset lines from this point
                    return;
                }
                if (!started) return;

                // Fin del bloque
                if (line.startsWith('Únete con:')) {
                    // Parsear grupos
                    const groups = [];
                    for (const l of lines) {
                        const m = l.match(/^\-\s+(.+?)\s+\(/);
                        if (m) groups.push(m[1]);
                    }
                    cancel();
                    clearTimeout(timer);
                    resolve(groups);
                    return;
                }

                // Acumular línea
                lines.push(line);
            });

            // Timeout
            const timer = setTimeout(() => {
                try { cancel(); } catch (_) {}
                // Mejor devolver lo que tengamos si empezó
                if (lines.length > 0) {
                    const groups = [];
                    for (const l of lines) {
                        const m = l.match(/^\-\s+(.+?)\s+\(/);
                        if (m) groups.push(m[1]);
                    }
                    resolve(groups);
                } else {
                    reject(new Error('Timeout esperando lista de grupos'));
                }
            }, timeoutMs);

            try {
                await this.send('/listGroups');
            } catch (err) {
                cancel();
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    /**
     * Enviar un comando al servidor
     */
    send(command) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.socket) {
                reject(new Error('No conectado al servidor'));
                return;
            }

            this.socket.write(command + '\n', (err) => {
                if (err) {
                    console.error('[TCP] Error enviando:', err);
                    reject(err);
                } else {
                    console.log('[TCP] Comando enviado:', command);
                    resolve();
                }
            });
        });
    }

    /**
     * Crear un grupo
     */
    async createGroup(groupName) {
        return this.send(`/createGroup ${groupName}`);
    }

    /**
     * Unirse a un grupo
     */
    async joinGroup(groupName) {
        return this.send(`/joinGroup ${groupName}`);
    }

    /**
     * Enviar mensaje privado a un usuario
     */
    async sendPrivateMessage(targetId, message) {
        return this.send(`/msg ${targetId} ${message}`);
    }

    /**
     * Enviar mensaje a un grupo
     */
    async sendGroupMessage(groupName, message) {
        return this.send(`/msgGroup ${groupName} ${message}`);
    }

    /**
     * Enviar nota de voz a usuario (envío binario)
     * Escribe el encabezado esperado por el servidor Java, luego la longitud y los bytes raw
     */
    async sendVoiceNoteToUser(targetId, filename, buffer) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.socket) return reject(new Error('No conectado'));
            try {
                // Encabezado textual
                this.socket.write(`voicenoteUser:${targetId}:${filename}\n`);
                // Longitud en línea separada
                this.socket.write(String(buffer.length) + '\n');
                // Escribir bytes raw
                this.socket.write(buffer, (err) => {
                    if (err) return reject(err);
                    console.log('[TCP] Nota de voz enviada a usuario', targetId, filename, buffer.length);
                    resolve();
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Enviar nota de voz a grupo
     */
    async sendVoiceNoteToGroup(groupName, filename, buffer) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.socket) return reject(new Error('No conectado'));
            try {
                this.socket.write(`voicenoteGroup:${groupName}:${filename}\n`);
                this.socket.write(String(buffer.length) + '\n');
                this.socket.write(buffer, (err) => {
                    if (err) return reject(err);
                    console.log('[TCP] Nota de voz enviada a grupo', groupName, filename, buffer.length);
                    resolve();
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Desconectar del servidor
     */
    disconnect() {
        if (this.socket) {
            this.socket.end();
            this.socket.destroy();
            this.connected = false;
            this.clientId = null;
        }
    }

    /**
     * Verificar si está conectado
     */
    isConnected() {
        return this.connected;
    }

    /**
     * Obtener el ID del cliente
     */
    getClientId() {
        return this.clientId;
    }
}

module.exports = TCPClient;
