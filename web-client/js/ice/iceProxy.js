/**
 * ICEProxy: Cliente simplificado para interactuar con ZeroC ICE desde el navegador
 * Usa WebSocket como transporte para mensaje de control
 * Audio/voz se maneja via WebSocket binario o HTTP
 */
class ICEProxy {
    constructor(wsUrl = 'ws://localhost:3000') {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.clientId = null;
        this.username = null;
        this.callbacks = {};
        this.connected = false;
        this.messageHandlers = {};
        this.voiceNoteHandlers = [];
        this.callHandlers = [];
    }

    /**
     * Conectar y registrarse
     */
    async connect(username, clientId) {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.wsUrl);
                
                this.ws.onopen = () => {
                    console.log('[ICE Proxy] WebSocket conectado');
                    this.username = username;
                    this.clientId = clientId;
                    
                    // Registrarse en el proxy
                    this.ws.send(JSON.stringify({
                        type: 'register',
                        clientId: clientId,
                        username: username
                    }));
                    
                    this.connected = true;
                    resolve(true);
                };
                
                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this._handleMessage(data);
                    } catch (err) {
                        // Mensaje binario (audio streaming)
                        this._handleBinaryMessage(event.data);
                    }
                };
                
                this.ws.onerror = (err) => {
                    console.error('[ICE Proxy] WebSocket error:', err);
                    this.connected = false;
                    reject(err);
                };
                
                this.ws.onclose = () => {
                    console.log('[ICE Proxy] WebSocket cerrado');
                    this.connected = false;
                };
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Manejar mensajes JSON
     */
    _handleMessage(data) {
        if (!data || !data.type) return;

        const { type } = data;

        if (type === 'registered') {
            console.log('[ICE Proxy] Registrado con clientId:', data.clientId);
        } 
        else if (type === 'message') {
            this.messageHandlers['onMessage']?.(data);
        }
        else if (type === 'voicenote') {
            this.voiceNoteHandlers.forEach(handler => handler(data));
        }
        else if (type === 'call-incoming') {
            this.callHandlers.forEach(handler => handler({
                type: 'incoming',
                from: data.callerId,
                callKey: data.callKey
            }));
        }
        else if (type === 'call-accepted') {
            this.callHandlers.forEach(handler => handler({
                type: 'accepted',
                callKey: data.callKey
            }));
        }
        else if (type === 'call-rejected') {
            this.callHandlers.forEach(handler => handler({
                type: 'rejected',
                callKey: data.callKey
            }));
        }
        else if (type === 'call-ended') {
            this.callHandlers.forEach(handler => handler({
                type: 'ended',
                callKey: data.callKey
            }));
        }
        else if (type === 'voicenote-sent') {
            console.log('[ICE Proxy] Nota de voz enviada');
        }
        else if (type === 'error') {
            console.error('[ICE Proxy] Error:', data.message);
        }
    }

    /**
     * Manejar mensajes binarios (audio streaming)
     */
    _handleBinaryMessage(buffer) {
        try {
            if (buffer.byteLength < 8) return;

            const view = new Uint8Array(buffer);
            const jsonSize = view[0] << 24 | view[1] << 16 | view[2] << 8 | view[3];
            
            if (jsonSize > 10000) return; // Sanity check

            const metadata = JSON.parse(
                new TextDecoder().decode(view.slice(4, 4 + jsonSize))
            );
            const audioData = buffer.slice(4 + jsonSize);

            // Notificar manejadores de audio
            this.voiceNoteHandlers.forEach(handler => handler({
                type: 'audio-chunk',
                callKey: metadata.callKey,
                from: metadata.from,
                data: new Blob([audioData], { type: 'audio/webm' })
            }));
        } catch (err) {
            console.warn('[ICE Proxy] Error procesando mensaje binario:', err.message);
        }
    }

    /**
     * Enviar nota de voz
     */
    async sendVoiceNote(targetId, targetType, blob, filename = null) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket no conectado');
        }

        const base64 = await this._blobToBase64(blob);
        const fn = filename || `voice_${Date.now()}.webm`;

        this.ws.send(JSON.stringify({
            type: 'voicenote',
            clientId: this.clientId,
            toType: targetType,
            target: targetId,
            filename: fn,
            base64: base64
        }));
    }

    /**
     * Iniciar llamada
     */
    startCall(receiverId) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket no conectado');
        }

        const callKey = `${this.clientId}->${receiverId}`;
        this.ws.send(JSON.stringify({
            type: 'call-start',
            callerId: this.clientId,
            receiverId: receiverId,
            callKey: callKey
        }));

        return callKey;
    }

    /**
     * Aceptar llamada
     */
    acceptCall(callKey) {
        this.ws.send(JSON.stringify({
            type: 'call-accept',
            callKey: callKey
        }));
    }

    /**
     * Rechazar llamada
     */
    rejectCall(callKey) {
        this.ws.send(JSON.stringify({
            type: 'call-reject',
            callKey: callKey
        }));
    }

    /**
     * Terminar llamada
     */
    endCall(callKey) {
        this.ws.send(JSON.stringify({
            type: 'call-end',
            callKey: callKey
        }));
    }

    /**
     * Enviar chunk de audio durante llamada (mensaje binario)
     */
    sendAudioChunk(callKey, audioChunk) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        audioChunk.arrayBuffer().then(buffer => {
            const metadata = JSON.stringify({
                callKey: callKey,
                from: this.clientId,
                type: 'audio'
            });

            const metadataBytes = new TextEncoder().encode(metadata);
            const jsonSize = metadataBytes.length;

            // Construir mensaje: [4 bytes size][metadata][audio data]
            const message = new ArrayBuffer(4 + jsonSize + buffer.byteLength);
            const view = new Uint8Array(message);

            // Escribir tamaño en big-endian
            view[0] = (jsonSize >>> 24) & 0xFF;
            view[1] = (jsonSize >>> 16) & 0xFF;
            view[2] = (jsonSize >>> 8) & 0xFF;
            view[3] = jsonSize & 0xFF;

            // Escribir metadata
            view.set(metadataBytes, 4);

            // Escribir audio
            view.set(new Uint8Array(buffer), 4 + jsonSize);

            this.ws.send(message);
        });
    }

    /**
     * Registrar manejador para mensajes
     */
    onMessage(handler) {
        this.messageHandlers['onMessage'] = handler;
    }

    /**
     * Registrar manejador para notas de voz / audio chunks
     */
    onVoiceNote(handler) {
        if (!this.voiceNoteHandlers.includes(handler)) {
            this.voiceNoteHandlers.push(handler);
        }
    }

    /**
     * Registrar manejador para eventos de llamada
     */
    onCall(handler) {
        if (!this.callHandlers.includes(handler)) {
            this.callHandlers.push(handler);
        }
    }

    /**
     * Convertir Blob a base64
     */
    async _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Desconectar
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.connected = false;
        }
    }
}
