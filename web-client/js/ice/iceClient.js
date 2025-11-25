import Ice from 'ice';


import { Chat } from '../../generated/Chat.js'; 

class IceChatClient {
    constructor() {
        this.communicator = null;
        this.chatService = null;
        this.audioService = null;
        this.connected = false;
        this.userId = null;
        this.adapter = null; // Necesitamos guardar referencia al adaptador

        // Callbacks para la UI
        this.onMessageCallback = null;
        this.onVoiceNoteCallback = null;
        this.onUserJoinedCallback = null;
    }

    async initialize() {
        try {
            console.log("Inicializando cliente Ice...");
            this.communicator = Ice.initialize();

            // --- Conectar al ChatService ---
            // NOTA: Asegúrate que en Java registraste el objeto con la identidad "ChatService"
            const base = this.communicator.stringToProxy("ChatService:ws -h localhost -p 10000");
            this.chatService = await Chat.ChatServicePrx.checkedCast(base);

            if (!this.chatService) throw new Error("No se pudo conectar al servicio Chat");

            // --- Conectar al AudioCallService ---
            // CORRECCIÓN 1: Usamos Chat.AudioCallServicePrx (está dentro del módulo Chat)
            // NOTA: Asegúrate que en Java tienes un objeto registrado como "AudioCallService"
            const audioBase = this.communicator.stringToProxy("AudioCallService:ws -h localhost -p 10000");
            this.audioService = await Chat.AudioCallServicePrx.checkedCast(audioBase);

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
        if (!this.connected) throw new Error("No conectado al servidor");

        try {
            const user = await this.chatService.login(username);
            this.userId = user.id;
            console.log("Usuario logueado ID:", this.userId);

            // Registrar callbacks es OBLIGATORIO para recibir mensajes
            await this.registerCallbacks();

            return user;
        } catch (error) {
            console.error("Error en login:", error);
            throw error;
        }
    }

    // --- CORRECCIÓN 2: Implementación correcta del Callback con Adaptador ---
    async registerCallbacks() {
        try {
            // 1. Crear un adaptador local en el navegador (necesario para bidireccionalidad)
            // Usamos "ws -h localhost" sin puerto para que el sistema asigne uno efímero
            this.adapter = await this.communicator.createObjectAdapterWithEndpoints("ClientAdapter", "ws -h localhost");

            // 2. Definir la clase que implementa la interfaz ChatCallback
            const self = this;
            class ChatCallbackI extends Chat.ChatCallback {
                onMessage(msg) {
                    console.log("Mensaje recibido:", msg);
                    if (self.onMessageCallback) self.onMessageCallback(msg);
                }
                onVoiceNote(from, filename, data) {
                    console.log("Nota de voz recibida de:", from);
                    if (self.onVoiceNoteCallback) self.onVoiceNoteCallback(from, filename, data);
                }
                onUserJoined(user, group) {
                    if (self.onUserJoinedCallback) self.onUserJoinedCallback(user, group);
                }
            }

            // 3. Instanciar y añadir al adaptador
            const callbackServant = new ChatCallbackI();
            // Creamos una identidad única para este cliente
            const identity = new Ice.Identity(this.userId, "callback"); 
            this.adapter.add(callbackServant, identity);
            
            // 4. Activar el adaptador (CRÍTICO: si no, no entran mensajes)
            this.adapter.activate();

            // 5. Crear el proxy para enviárselo al servidor Java
            const myProxy = this.adapter.createProxy(identity);
            const callbackPrx = Chat.ChatCallbackPrx.uncheckedCast(myProxy);

            // 6. Registrar en el servidor
            await this.chatService.registerCallback(this.userId, callbackPrx);
            console.log("Callbacks registrados y escuchando...");

        } catch (error) {
            console.error("Error registrando callbacks:", error);
        }
    }

    async sendPrivateMessage(toUser, message) {
        if (!this.connected) throw new Error("No conectado");
        await this.chatService.sendPrivateMessage(this.userId, toUser, message);
    }

    async sendGroupMessage(groupName, message) {
        if (!this.connected) throw new Error("No conectado");
        await this.chatService.sendGroupMessage(this.userId, groupName, message);
    }

    async createGroup(groupName) {
        if (!this.connected) throw new Error("No conectado");
        return await this.chatService.createGroup(groupName, this.userId);
    }

    async joinGroup(groupName) {
        if (!this.connected) throw new Error("No conectado");
        await this.chatService.joinGroup(groupName, this.userId);
    }

    async listGroups() {
        if (!this.connected) throw new Error("No conectado");
        return await this.chatService.listGroups(this.userId);
    }

    // --- CORRECCIÓN 3: Manejo de Bytes para Audio ---
    async sendVoiceNoteToUser(toUser, filename, audioData) {
        if (!this.connected) throw new Error("No conectado");
        
        // Ice necesita Array de JS standard, no Uint8Array (a menos que uses mappings específicos)
        // audioData llega como ArrayBuffer o Uint8Array desde el recorder
        const buffer = new Uint8Array(audioData);
        const iceData = Array.from(buffer); 

        await this.chatService.sendVoiceNoteToUser(this.userId, toUser, filename, iceData);
    }

    async sendVoiceNoteToGroup(groupName, filename, audioData) {
        if (!this.connected) throw new Error("No conectado");

        const buffer = new Uint8Array(audioData);
        const iceData = Array.from(buffer);

        await this.chatService.sendVoiceNoteToGroup(this.userId, groupName, filename, iceData);
    }

    // Setters de la UI
    setOnMessageCallback(callback) { this.onMessageCallback = callback; }
    setOnVoiceNoteCallback(callback) { this.onVoiceNoteCallback = callback; }
    setOnUserJoinedCallback(callback) { this.onUserJoinedCallback = callback; }

    destroy() {
        if (this.communicator) {
            this.communicator.destroy();
        }
        this.connected = false;
    }
}

export default IceChatClient;