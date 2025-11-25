# Chat Proyecto - Implementación Completa

## Descripción General

Aplicación de chat con soporte para:
- ✅ Mensajes de texto (privados y grupos)
- ✅ Notas de voz grabadas
- ✅ Llamadas de voz en tiempo real (WebSocket)
- ✅ ZeroC ICE para RPC
- ✅ Historial persistente

## Arquitectura

### Backend (Java)
```
server/
├── ice/
│   └── AudioCallServiceI.java        # Implementación ZeroC ICE para audio
├── ChatServer.java                    # Servidor TCP principal
├── ClientHandler.java                 # Manejo de clientes
├── HistoryService.java                # Persistencia de mensajes y audio
└── UDPRelay.java                      # Relay UDP para audio (UDP directo)
```

### Proxy (Node.js)
```
proxy-server/
├── server.js                          # WebSocket + REST endpoints
├── tcpClient.js                       # Cliente TCP hacia servidor Java
└── package.json                       # Dependencias
```

### Frontend (Web)
```
web-client/
├── chat.html                          # Interfaz principal
├── js/
│   ├── app-new.js                     # Aplicación principal
│   ├── audioManager.js                # Gestor de grabación/reproducción
│   └── ice/
│       └── iceProxy.js                # Cliente WebSocket simplificado
├── css/
│   └── styles.css                     # Estilos de la UI
```

## Flujo de Datos

### Mensajes de Texto
```
Web Client → WebSocket → Proxy → TCP → Servidor Java → TCP → Otro Cliente/Proxy → WebSocket → Web Client
```

### Notas de Voz
```
Web Client (MediaRecorder) → base64 → WebSocket → Proxy → TCP (voicenoteUser:) → Servidor Java
→ HistoryService (guarda en history/*_voice/) → TCP → Proxy → WebSocket → Web Client (playback)
```

### Llamadas en Tiempo Real (WebSocket)
```
Iniciador: WebSocket (call-start) → Proxy (ICEProxy) → WebSocket → Receptor
Aceptación: WebSocket (call-accept) → Proxy → WebSocket → Iniciador
Streaming: WebSocket (binary chunks) ↔ Proxy ↔ WebSocket
Cierre: WebSocket (call-end) → Proxy → WebSocket
```

### Llamadas via ZeroC ICE (Alternativa)
```
Cliente ICE → RPC (startCall) → AudioCallServiceI → Callback (onMessage) → Audio Streaming
```

## Funcionalidades Implementadas

### 1. ZeroC ICE (AudioCallServiceI.java)
- `startCall()`: Inicia llamada entre usuarios
- `streamCallAudio()`: Reenvía chunks de audio en tiempo real
- `endCall()`: Termina la llamada
- Registro de callbacks por usuario para notificaciones en tiempo real

### 2. WebSocket Server (proxy-server/server.js)
- Registro de clientes por clientId
- Soporte para:
  - Mensajes JSON (texto, control)
  - Mensajes binarios (audio streaming)
- Reenvío de audio en tiempo real entre clientes conectados
- Gestión automática de llamadas activas

### 3. TCPClient Binario (proxy-server/tcpClient.js)
- `sendVoiceNoteToUser(targetId, filename, buffer)`
- `sendVoiceNoteToGroup(groupName, filename, buffer)`
- Implementa protocolo binario: `header\nlength\n[bytes]`

### 4. AudioManager (web-client/js/audioManager.js)
- Grabación con MediaRecorder (WebM)
- Reproducción de audio (Web Audio API + fallback HTML5)
- Streaming de audio para llamadas
- Conversión base64 para transmisión

### 5. ICEProxy (web-client/js/ice/iceProxy.js)
- Cliente WebSocket simplificado
- Interfaz amigable para:
  - Envío de notas de voz
  - Control de llamadas (start, accept, reject, end)
  - Streaming de audio binario

### 6. Interface Web (chat.html + app-new.js)
- UI moderna y responsive
- Botones para grabación de audio (🎤)
- Botones para llamadas (📞)
- Reproductor de notas de voz
- Sistema de notificaciones en tiempo real

## Cómo Usar

### 1. Iniciar el Servidor Java

```bash
cd server
./gradlew run
# O en Windows:
gradlew.bat run
```

El servidor escuchará en `localhost:5000` (TCP) y abrirá un puerto UDP para audio relay.

### 2. Iniciar el Proxy

```bash
cd proxy-server
npm install
node server.js
# O para desarrollo con auto-reload:
npm run dev
```

El proxy estará en `http://localhost:3000` y WebSocket en `ws://localhost:3000`.

### 3. Acceder a la Web

Abre `http://localhost:3000/chat.html` en el navegador.

### 4. Prueba de Funcionalidad

#### Prueba 1: Mensajes de Texto
1. Abre dos pestañas/navegadores
2. Ambos conectan al proxy (reciben clientId)
3. Selecciona contacto en una pestaña → Envía mensaje
4. El otro cliente recibe el mensaje (via polling)

#### Prueba 2: Notas de Voz
1. Selecciona un contacto
2. Click en botón 🎤 para grabar
3. Habla por el micrófono
4. Click nuevamente para detener
5. Nota se envía via WebSocket → Proxy → Servidor Java
6. Se guarda en `history/user-X_Y_voice/`
7. Se puede reproducir desde el historial

#### Prueba 3: Llamadas WebSocket
1. Usuario A selecciona a Usuario B
2. Click en 📞 para iniciar llamada
3. Usuario B recibe notificación (confirm)
4. Si acepta, comienza streaming de audio
5. Ambos hablan en tiempo real (bidireccional)
6. Click en 📞❌ para terminar

## Variables de Entorno

### Proxy
```bash
JAVA_HOST=localhost       # Host del servidor Java
JAVA_PORT=5000           # Puerto TCP del servidor Java
NODE_ENV=production       # Modo de ejecución
```

### Web Client
- Configurar URLs en `app-new.js`:
  - `PROXY_URL`: `http://localhost:3000`
  - `WS_URL`: `ws://localhost:3000`

## Limitaciones y Consideraciones

1. **Navegador**: Requiere soporte para:
   - WebSocket
   - MediaRecorder
   - Web Audio API
   - ArrayBuffer/TypedArray

2. **Audio**: 
   - Codec WebM (Opus/Vorbis)
   - Latencia: ~100-200ms en LAN
   - No optimizado para conexiones de larga distancia

3. **Seguridad**:
   - Sin encriptación (WebSocket es ws://, no wss://)
   - Sin autenticación
   - Requiere HTTPS + WSS para producción

4. **Escalabilidad**:
   - Proxy soporta ~1000 conexiones WebSocket simultáneas
   - Relay UDP limitado a ancho de banda local

## Posibles Mejoras Futuras

1. Migrar a WSS (WebSocket Secure)
2. Agregar autenticación y tokens JWT
3. Implementar encriptación E2E para audio
4. Opción de video (WebRTC con STUN/TURN)
5. Base de datos para persistencia
6. Bucket de audio en cloud storage
7. Transcripción de voz a texto (speech-to-text)
8. Compresión de audio adaptativa

## Testing

### Test Manual de Extremo a Extremo
```bash
# Terminal 1: Servidor Java
cd server && ./gradlew run

# Terminal 2: Proxy
cd proxy-server && npm start

# Terminal 3: Abrir navegadores
# Cliente 1: http://localhost:3000/chat.html
# Cliente 2: http://localhost:3000/chat.html (en otra pestaña/navegador)

# Pruebas:
# 1. Ambos clientes envían mensajes de texto
# 2. Un cliente graba una nota de voz
# 3. Cliente A llama a Cliente B
# 4. Ambos hablan durante la llamada
```

## Archivos Principales

| Archivo | Descripción |
|---------|-------------|
| `server/src/main/java/server/ice/AudioCallServiceI.java` | Implementación ICE para audio |
| `proxy-server/server.js` | WebSocket y endpoints REST |
| `proxy-server/tcpClient.js` | Cliente TCP binario |
| `web-client/js/audioManager.js` | Grabación/reproducción de audio |
| `web-client/js/ice/iceProxy.js` | Cliente WebSocket para control |
| `web-client/js/app-new.js` | Lógica principal de la aplicación |
| `web-client/chat.html` | Interfaz HTML |
| `web-client/css/styles.css` | Estilos responsive |

## Protocolo de Eventos WebSocket

### Cliente → Proxy
```json
{
  "type": "voicenote",
  "toType": "user|group",
  "target": "userId|groupName",
  "filename": "voice_XXX.webm",
  "base64": "..."
}

{
  "type": "call-start",
  "callerId": "senderId",
  "receiverId": "receiverId"
}

{
  "type": "call-accept|call-reject|call-end",
  "callKey": "senderId->receiverId"
}
```

### Proxy → Cliente
```json
{
  "type": "call-incoming",
  "callerId": "senderId",
  "callKey": "senderId->receiverId"
}

{
  "type": "call-accepted|call-rejected|call-ended",
  "callKey": "senderId->receiverId"
}
```

## Licencia

Este proyecto es de código abierto bajo la licencia MIT.
