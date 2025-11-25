/**
 * AudioManager: maneja grabación, reproducción y streaming de audio para el chat
 */
class AudioManager {
    constructor(onAudioReceived = null) {
        this.recording = false;
        this.mediaRecorder = null; // usado para llamadas (streaming webm)
        this.stream = null;
        this.audioChunks = [];
        this.activeCall = null;
        this.audioContext = null;
        this.analyser = null;
        this.onAudioReceived = onAudioReceived;
        this.callAudioBuffer = [];
        this.isPlayingCall = false;

        // Grabación WAV (notas de voz)
        this._wavProcessor = null;
        this._wavSource = null;
        this._wavBuffers = [];
        this._wavSampleRate = 44100;

        // Reproducción de llamadas en tiempo real (MediaSource)
        this._ms = null;               // MediaSource
        this._sb = null;               // SourceBuffer
        this._mseQueue = [];           // Cola de ArrayBuffer pendientes
        this._mseReady = false;
        this._callAudioEl = null;      // <audio> para la llamada
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
            // getUserMedia requiere contexto seguro (HTTPS) o localhost en la mayoría de navegadores
            if (!window.isSecureContext && location.hostname !== 'localhost') {
                throw new Error('Acceso al micrófono bloqueado: usa HTTPS o localhost. Opciones: 1) abrir http://localhost:3000, 2) servir con HTTPS, 3) iniciar Chrome con --unsafely-treat-insecure-origin-as-secure para http://' + location.host);
            }
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

            // Preparar AudioContext y ScriptProcessor para capturar PCM y luego generar WAV
            await this.initAudioContext();
            this._wavSampleRate = this.audioContext.sampleRate || 44100;
            this._wavBuffers = [];

            // Crear fuente desde el stream de micrófono
            this._wavSource = this.audioContext.createMediaStreamSource(this.stream);

            // ScriptProcessor está deprecado pero funciona ampliamente; 4096 frames, mono
            const bufferSize = 4096;
            const channelCount = 1;
            this._wavProcessor = this.audioContext.createScriptProcessor(bufferSize, channelCount, channelCount);
            this._wavProcessor.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0); // Float32Array
                // Copiar para no retener el buffer interno
                this._wavBuffers.push(new Float32Array(input));
            };

            // Conectar cadena
            this._wavSource.connect(this._wavProcessor);
            this._wavProcessor.connect(this.audioContext.destination); // necesario en algunos navegadores

            this.recording = true;
            console.log('[Audio] Grabación WAV iniciada @', this._wavSampleRate, 'Hz');
            return true;
        } catch (err) {
            console.error('[Audio] Error iniciando grabación WAV:', err);
            throw err;
        }
    }

    /**
     * Detener grabación y obtener Blob
     */
    async stopRecording() {
        if (!this.recording) return null;

        // Detener pipeline WAV
        try {
            if (this._wavProcessor) {
                this._wavProcessor.disconnect();
            }
            if (this._wavSource) {
                try { this._wavSource.disconnect(); } catch (_) {}
            }
        } catch (_) {}

        this.recording = false;

        // Unir buffers Float32 en un único Float32Array
        const totalLength = this._wavBuffers.reduce((sum, arr) => sum + arr.length, 0);
        const pcm = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of this._wavBuffers) {
            pcm.set(chunk, offset);
            offset += chunk.length;
        }

        // Convertir a PCM16 y empacar en WAV
        const wavBuffer = this._encodeWAV(pcm, this._wavSampleRate);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        console.log('[Audio] Grabación WAV detenida, tamaño:', blob.size);
        return blob;
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
                // Intentar como WAV primero, luego fallback a webm
                blob = new Blob([bytes.buffer], { type: 'audio/wav' });
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
            const url = isBase64 ? `data:audio/wav;base64,${data}` : data;
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
            
            // Crear/asegurar reproductor basado en MediaSource para la llamada entrante
            this._setupMediaSourcePlayback();

            // Crear grabador de audio para streaming
            // Preferir Opus explícito; fallback a lo que haya disponible
            const preferredMime = 'audio/webm;codecs=opus';
            const altMime = 'audio/webm';
            const mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(preferredMime))
                ? preferredMime
                : ((window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(altMime)) ? altMime : '');

            this.mediaRecorder = mimeType
                ? new MediaRecorder(this.stream, { mimeType })
                : new MediaRecorder(this.stream);
            
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
            // Inicializar cadena de MediaSource si no está lista
            if (!this._ms || !this._mseReady || !this._sb) {
                this._setupMediaSourcePlayback();
            }

            const buffer = await audioData.arrayBuffer();
            // Si el SourceBuffer está actualizado, encolar o anexar directamente
            if (this._sb.updating || this._mseQueue.length > 0) {
                this._mseQueue.push(buffer);
            } else {
                this._sb.appendBuffer(buffer);
            }
        } catch (err) {
            console.warn('[Audio] No se pudo encolar chunk MSE:', err.message);
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
        try {
            if (this._wavProcessor) this._wavProcessor.disconnect();
            if (this._wavSource) this._wavSource.disconnect();
        } catch (_) {}
        this._wavBuffers = [];

        // Cerrar MediaSource y limpiar elemento de audio de llamada
        try {
            if (this._sb) {
                try { this._sb.abort(); } catch (_) {}
            }
            if (this._ms) {
                if (this._ms.readyState === 'open') {
                    try { this._ms.endOfStream(); } catch (_) {}
                }
            }
        } catch (_) {}
        this._sb = null;
        this._ms = null;
        this._mseQueue = [];
        this._mseReady = false;
        if (this._callAudioEl) {
            try { this._callAudioEl.pause(); } catch (_) {}
            if (this._callAudioEl.parentNode) {
                // Mantener el elemento para sesiones futuras pero detener playback
                this._callAudioEl.src = '';
            }
        }
    }

    // ================== Helpers WAV ==================
    _encodeWAV(float32Samples, sampleRate) {
        // Convertir Float32 [-1,1] a Int16 LE
        const pcm16 = this._floatTo16BitPCM(float32Samples);
        const bytesPerSample = 2;
        const blockAlign = 1 * bytesPerSample; // mono
        const byteRate = sampleRate * blockAlign;
        const dataSize = pcm16.byteLength;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        // RIFF header
        this._writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        this._writeString(view, 8, 'WAVE');
        // fmt chunk
        this._writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);         // Subchunk1Size (16 for PCM)
        view.setUint16(20, 1, true);          // AudioFormat (1 = PCM)
        view.setUint16(22, 1, true);          // NumChannels (mono)
        view.setUint32(24, sampleRate, true); // SampleRate
        view.setUint32(28, byteRate, true);   // ByteRate
        view.setUint16(32, blockAlign, true); // BlockAlign
        view.setUint16(34, 16, true);         // BitsPerSample
        // data chunk
        this._writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);
        // PCM data
        const pcmBytes = new Uint8Array(buffer, 44);
        pcmBytes.set(new Uint8Array(pcm16.buffer));
        return buffer;
    }

    _floatTo16BitPCM(float32Samples) {
        const out = new ArrayBuffer(float32Samples.length * 2);
        const view = new DataView(out);
        let offset = 0;
        for (let i = 0; i < float32Samples.length; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, float32Samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return out;
    }

    _writeString(dataview, offset, str) {
        for (let i = 0; i < str.length; i++) {
            dataview.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    // ================== MediaSource Helpers (llamadas) ==================
    _setupMediaSourcePlayback() {
        try {
            if (!('MediaSource' in window)) {
                console.warn('[Audio] MediaSource no soportado, el audio de la llamada puede no reproducirse correctamente');
                return;
            }

            if (!this._callAudioEl) {
                // Crear un elemento <audio> dedicado para la llamada
                const el = document.createElement('audio');
                el.autoplay = true;
                el.playsInline = true;
                el.controls = false;
                el.style.display = 'none';
                document.body.appendChild(el);
                this._callAudioEl = el;
            }

            // Reinicializar MSE
            this._ms = new MediaSource();
            this._mseQueue = [];
            this._mseReady = false;
            this._sb = null;

            this._callAudioEl.src = URL.createObjectURL(this._ms);

            this._ms.onsourceopen = () => {
                try {
                    const mime = 'audio/webm; codecs=opus';
                    if (!MediaSource.isTypeSupported || !MediaSource.isTypeSupported(mime)) {
                        console.warn('[Audio] MIME no soportado por MSE, intentando fallback a audio/webm');
                    }
                    const chosen = (MediaSource.isTypeSupported && MediaSource.isTypeSupported(mime)) ? mime : 'audio/webm';
                    this._sb = this._ms.addSourceBuffer(chosen);
                    this._mseReady = true;

                    this._sb.addEventListener('updateend', () => {
                        if (!this._sb) return;
                        if (this._mseQueue.length > 0 && !this._sb.updating) {
                            const next = this._mseQueue.shift();
                            try { this._sb.appendBuffer(next); } catch (e) {
                                console.warn('[Audio] Error al anexar chunk MSE:', e.message);
                            }
                        }
                    });

                    // Intentar drenar cola si ya hay datos
                    if (this._mseQueue.length > 0 && !this._sb.updating) {
                        const first = this._mseQueue.shift();
                        try { this._sb.appendBuffer(first); } catch (e) {
                            console.warn('[Audio] Error anexando primer chunk MSE:', e.message);
                        }
                    }
                } catch (e) {
                    console.error('[Audio] Error inicializando MediaSource:', e);
                }
            };
        } catch (e) {
            console.warn('[Audio] No se pudo preparar MediaSource:', e.message);
        }
    }
}
