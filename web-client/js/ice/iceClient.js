import Ice from 'ice';

import { Chat, AudioCall } from '../../generated/Chat.js';

class IceChatClient {
    constructor() {
        this.communicator = null;
        this.chatService = null;
        this.audioService = null;
        this.connected = false;
        this.userId = null;
        this.callbackProxy = null;

        // Callbacks para la UI
        this.onMessageCallback = null;
        this.onVoiceNoteCallback = null;
        this.onUserJoinedCallback = null;
    }

    async initialize() {
        try {
            console.log("Inicializando cliente Ice...");

            // Inicializar Ice
            this.communicator = Ice.initialize();

            // Conectar al servidor Ice via WebSocket
            const base = this.communicator.stringToProxy("ChatService:ws -h localhost -p 10000");
            this.chatService = await Chat.ChatServicePrx.checkedCast(base);

            if (!this.chatService) {
                throw new Error("No se pudo conectar al servicio Chat");
            }

            // Conectar al servicio de audio
            const audioBase = this.communicator.stringToProxy("AudioCallService:ws -h localhost -p 10000");
            this.audioService = await AudioCall.AudioCallServicePrx.checkedCast(audioBase);

            this.connected = true;
            console.log("Conectado al servidor Ice via WebSocket");

            return true;
        } catch (error) {
            console.error("Error conectando a Ice:", error);
            this.connected = false;
            return false;
        }
    }

    async login(username) {
        if (!this.connected) {
            throw new Error("No conectado al servidor");
        }

        try {
            const user = await this.chatService.login(username);
            this.userId = user.id;
            console.log("Usuario logueado:", user);

            // Registrar callbacks para mensajes en tiempo real
            await this.registerCallbacks();

            return user;
        } catch (error) {
            console.error("Error en login:", error);
            throw error;
        }
    }

    async registerCallbacks() {
        try {
            // Crear proxy para callbacks
            this.callbackProxy = await this.communicator.createProxy({
                onMessage: (msg) => {
                    console.log("Mensaje recibido via Ice:", msg);
                    if (this.onMessageCallback) {
                        this.onMessageCallback(msg);
                    }
                },
                onVoiceNote: (from, filename, data) => {
                    console.log("Nota de voz recibida via Ice:", from, filename);
                    if (this.onVoiceNoteCallback) {
                        this.onVoiceNoteCallback(from, filename, data);
                    }
                },
                onUserJoined: (user, group) => {
                    console.log("Usuario unido via Ice:", user, group);
                    if (this.onUserJoinedCallback) {
                        this.onUserJoinedCallback(user, group);
                    }
                }
            });

            // Registrar el callback en el servidor
            await this.chatService.registerCallback(this.userId, this.callbackProxy);
            console.log("Callbacks registrados exitosamente");

        } catch (error) {
            console.error("Error registrando callbacks:", error);
        }
    }

    async sendPrivateMessage(toUser, message) {
        if (!this.connected || !this.userId) {
            throw new Error("No conectado o no logueado");
        }

        try {
            await this.chatService.sendPrivateMessage(this.userId, toUser, message);
            console.log("Mensaje privado enviado a", toUser);
        } catch (error) {
            console.error("Error enviando mensaje privado:", error);
            throw error;
        }
    }

    async sendGroupMessage(groupName, message) {
        if (!this.connected || !this.userId) {
            throw new Error("No conectado o no logueado");
        }

        try {
            await this.chatService.sendGroupMessage(this.userId, groupName, message);
            console.log("Mensaje grupal enviado a", groupName);
        } catch (error) {
            console.error("Error enviando mensaje grupal:", error);
            throw error;
        }
    }

    async createGroup(groupName) {
        if (!this.connected || !this.userId) {
            throw new Error("No conectado o no logueado");
        }

        try {
            const groupId = await this.chatService.createGroup(groupName, this.userId);
            console.log("Grupo creado:", groupId);
            return groupId;
        } catch (error) {
            console.error("Error creando grupo:", error);
            throw error;
        }
    }

    async joinGroup(groupName) {
        if (!this.connected || !this.userId) {
            throw new Error("No conectado o no logueado");
        }

        try {
            await this.chatService.joinGroup(groupName, this.userId);
            console.log("Unido al grupo:", groupName);
        } catch (error) {
            console.error("Error uniéndose al grupo:", error);
            throw error;
        }
    }

    async listGroups() {
        if (!this.connected || !this.userId) {
            throw new Error("No conectado o no logueado");
        }

        try {
            const groups = await this.chatService.listGroups(this.userId);
            console.log("Grupos obtenidos:", groups);
            return groups;
        } catch (error) {
            console.error("Error obteniendo grupos:", error);
            throw error;
        }
    }

    async sendVoiceNoteToUser(toUser, filename, audioData) {
        if (!this.connected || !this.userId) {
            throw new Error("No conectado o no logueado");
        }

        try {
            // Convertir ArrayBuffer a byte array para Ice
            const byteArray = new Uint8Array(audioData);
            await this.chatService.sendVoiceNoteToUser(this.userId, toUser, filename, byteArray);
            console.log("Nota de voz enviada a", toUser);
        } catch (error) {
            console.error("Error enviando nota de voz:", error);
            throw error;
        }
    }

    async sendVoiceNoteToGroup(groupName, filename, audioData) {
        if (!this.connected || !this.userId) {
            throw new Error("No conectado o no logueado");
        }

        try {
            const byteArray = new Uint8Array(audioData);
            await this.chatService.sendVoiceNoteToGroup(this.userId, groupName, filename, byteArray);
            console.log("Nota de voz enviada al grupo", groupName);
        } catch (error) {
            console.error("Error enviando nota de voz grupal:", error);
            throw error;
        }
    }

    // Métodos para configurar callbacks de UI
    setOnMessageCallback(callback) {
        this.onMessageCallback = callback;
    }

    setOnVoiceNoteCallback(callback) {
        this.onVoiceNoteCallback = callback;
    }

    setOnUserJoinedCallback(callback) {
        this.onUserJoinedCallback = callback;
    }

    destroy() {
        if (this.communicator) {
            try {
                this.communicator.destroy();
            } catch (error) {
                console.error("Error destruyendo communicator:", error);
            }
        }
        this.connected = false;
        this.userId = null;
    }
}

export default IceChatClient;