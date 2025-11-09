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
