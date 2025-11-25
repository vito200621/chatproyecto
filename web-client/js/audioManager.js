/**
 * AudioManager: maneja grabación, reproducción y streaming de audio para el chat
 */
class AudioManager {
    constructor(onAudioReceived = null) {
        this.recording = false;
        this.mediaRecorder = null;
        this.stream = null;
        this.audioChunks = [];
        this.activeCall = null;
        this.audioContext = null;
        this.analyser = null;
        this.onAudioReceived = onAudioReceived;
        this.callAudioBuffer = [];
        this.isPlayingCall = false;
    }

    /**
     * Inicializar contexto de audio
     */
    async initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        return this.audioContext;
    }

    /**
     * Obtener permisos del micrófono
     */
    async requestMicrophoneAccess() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Tu navegador no soporta acceso al micrófono');
            }
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            return this.stream;
        } catch (err) {
            console.error('[Audio] Error accediendo micrófono:', err);
            throw err;
        }
    }

    /**
     * Comenzar grabación de nota de voz
     */
    async startRecording() {
        if (this.recording) return;
        
        try {
            if (!this.stream) {
                await this.requestMicrophoneAccess();
            }

            this.audioChunks = [];
            
            if (typeof MediaRecorder === 'undefined') {
                throw new Error('MediaRecorder no disponible');
            }

            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: 'audio/webm'
            });

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.audioChunks.push(e.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                // Procesamiento automático en stopRecording()
            };

            this.mediaRecorder.start();
            this.recording = true;
            console.log('[Audio] Grabación iniciada');
            return true;
        } catch (err) {
            console.error('[Audio] Error iniciando grabación:', err);
            throw err;
        }
    }

    /**
     * Detener grabación y obtener Blob
     */
    async stopRecording() {
        if (!this.recording || !this.mediaRecorder) return null;

        return new Promise((resolve) => {
            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                this.recording = false;
                console.log('[Audio] Grabación detenida, tamaño:', blob.size);
                resolve(blob);
            };
            this.mediaRecorder.stop();
        });
    }

    /**
     * Convertir Blob a base64
     */
    async blobToBase64(blob) {
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
     * Reproducir audio desde base64 o URL
     */
    async playAudio(data, isBase64 = true) {
        try {
            await this.initAudioContext();

            let blob;
            if (isBase64 && typeof data === 'string') {
                const binary = atob(data);
                const len = binary.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                blob = new Blob([bytes.buffer], { type: 'audio/webm' });
            } else if (data instanceof Blob) {
                blob = data;
            } else if (typeof data === 'string' && data.startsWith('http')) {
                // URL
                const response = await fetch(data);
                blob = await response.blob();
            } else {
                throw new Error('Formato de audio desconocido');
            }

            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.audioContext.destination);
            source.start(0);

            console.log('[Audio] Reproducción iniciada');
        } catch (err) {
            console.error('[Audio] Error reproduciendo audio:', err);
            // Fallback a elemento <audio>
            const url = isBase64 ? `data:audio/webm;base64,${data}` : data;
            const audio = new Audio(url);
            audio.play().catch(e => console.error('Error audio fallback:', e));
        }
    }

    /**
     * Iniciar streaming de audio para llamada
     */
    async startCallStreaming(callKey, recipientId) {
        try {
            if (!this.stream) {
                await this.requestMicrophoneAccess();
            }

            this.activeCall = { callKey, recipientId, startTime: Date.now() };
            
            // Crear grabador de audio para streaming
            this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm' });
            
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0 && this.onAudioReceived) {
                    // Enviar chunks de audio en tiempo real
                    this.onAudioReceived({
                        type: 'call-audio-chunk',
                        callKey,
                        data: e.data
                    });
                }
            };

            this.mediaRecorder.start(100); // Enviar chunks cada 100ms
            console.log('[Audio] Streaming de llamada iniciado');
        } catch (err) {
            console.error('[Audio] Error iniciando streaming:', err);
            throw err;
        }
    }

    /**
     * Detener streaming de llamada
     */
    stopCallStreaming() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this.activeCall = null;
        console.log('[Audio] Streaming de llamada detenido');
    }

    /**
     * Procesar chunk de audio recibido en llamada
     */
    async processCallAudioChunk(audioData) {
        if (!this.activeCall) return;

        try {
            await this.initAudioContext();

            // Decodificar y reproducir el audio recibido
            const arrayBuffer = await audioData.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.audioContext.destination);
            source.start(0);
        } catch (err) {
            // Algunos chunks pueden no ser válidos, es normal en streaming
            console.warn('[Audio] No se pudo procesar chunk:', err.message);
        }
    }

    /**
     * Liberar recursos
     */
    cleanup() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this.recording = false;
        this.activeCall = null;
        this.audioChunks = [];
    }
}
