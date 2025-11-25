# 🎯 Guía Rápida de Inicio - Chat Proyecto

## ✨ Lo que se implementó

### 1. **ZeroC ICE - AudioCallServiceI.java** ✅
- Manejo completo de llamadas de audio en tiempo real
- Forwarding de audio entre usuarios
- Sistema de callbacks para notificaciones
- Registro de llamadas activas

### 2. **WebSocket Server - proxy-server/server.js** ✅
- Servidor WebSocket con soporte binario
- Reenvío de audio en tiempo real
- Control de llamadas (start, accept, reject, end)
- Gestión automática de clientes

### 3. **Cliente TCP Binario - proxy-server/tcpClient.js** ✅
- Envío de notas de voz al servidor Java
- Protocolo: `header\nlength\n[bytes raw]`
- Compatible con servidor Java existente

### 4. **Gestor de Audio - web-client/js/audioManager.js** ✅
- Grabación con MediaRecorder (WebM)
- Reproducción con Web Audio API
- Streaming de audio para llamadas
- Conversión base64 para transmisión

### 5. **Cliente ICE Proxy - web-client/js/ice/iceProxy.js** ✅
- Cliente WebSocket simplificado
- Control de notas de voz y llamadas
- Interfaz amigable para control

### 6. **Interfaz Web - chat.html + app-new.js** ✅
- Botones para:
  - 🎤 Grabar nota de voz
  - 📞 Iniciar llamada
  - 📞❌ Terminar llamada
- Reproductor de audio integrado
- UI responsive y moderna

## 🚀 Inicio Rápido

### Opción A: Scripts automáticos (Recomendado)

**Windows:**
```cmd
start-all.bat
```

**Linux/Mac:**
```bash
chmod +x start-all.sh
./start-all.sh
```

### Opción B: Manual (3 terminales)

**Terminal 1 - Servidor Java:**
```bash
cd server
./gradlew run
```

**Terminal 2 - Proxy Node.js:**
```bash
cd proxy-server
npm install
node server.js
```

**Terminal 3 - Navegador:**
```
http://localhost:3000/chat.html
```

## 📝 Flujos de Prueba

### Prueba 1: Mensaje de Texto
```
1. Abre http://localhost:3000/chat.html en 2 pestañas (Cliente A y B)
2. Ambos reciben clientId automático
3. Cliente A: selecciona contacto → escribe mensaje → envía
4. Cliente B: recibe mensaje en tiempo real (via polling cada 2s)
```

### Prueba 2: Nota de Voz
```
1. Cliente A: selecciona contacto
2. Click en botón 🎤
3. Habla al micrófono (~5-10 segundos)
4. Click nuevamente para detener
5. Audio se comprime y envía via WebSocket
6. Proxy reenvía al servidor Java
7. Servidor guarda en: history/user-X_Y_voice/voice_XXX.webm
8. Cliente B: recibe notificación de nota
9. Ambos pueden reproducir con 🔊 Reproducir
```

### Prueba 3: Llamada WebSocket
```
1. Cliente A: selecciona a Cliente B
2. Click en 📞 "Iniciar llamada"
3. Cliente B: recibe prompt "¿Aceptar llamada de A?"
4. Si acepta:
   - A y B ven: "📞 En llamada..."
   - Comienza streaming de audio bidireccional
   - Ambos pueden hablar simultáneamente
5. Click en 📞❌ para terminar
6. Ambos reciben "Llamada terminada"
```

## 🎬 Demo Completo (5 minutos)

1. **Inicio** (0:00 - 1:00)
   - Ejecuta `start-all.bat` o scripts
   - Abre 2 pestañas: `http://localhost:3000/chat.html`

2. **Mensajería** (1:00 - 2:00)
   - Pestaña 1 → escribe "Hola" → envía
   - Pestaña 2 → ve "Hola" recibido

3. **Audio** (2:00 - 4:00)
   - Pestaña 1 → click 🎤 → habla → click nuevamente
   - Pestaña 2 → ve nota de voz → reproduce con 🔊

4. **Llamada** (4:00 - 5:00)
   - Pestaña 1 → click 📞
   - Pestaña 2 → aceptar llamada
   - Ambos hablan durante 10-15 segundos
   - Pestaña 1 → click 📞❌ para terminar

## 📊 Arquitectura de Mensajes

```
WEB CLIENT (Pestaña 1)
    ↓ WebSocket
PROXY SERVER (Node.js)
    ↓ TCP
SERVIDOR JAVA (ChatServer)
    ↓ TCP / Almacenamiento
HISTORY SERVICE + UDP RELAY
    ↓ Reenvío a otro cliente
PROXY SERVER (Node.js)
    ↓ WebSocket
WEB CLIENT (Pestaña 2)
```

## 🔧 Configuración

Puedes personalizar las URLs en `web-client/js/app-new.js`:

```javascript
const PROXY_URL = 'http://localhost:3000';    // URL del proxy
const WS_URL = 'ws://localhost:3000';         // WebSocket del proxy
```

## 🐛 Troubleshooting

| Problema | Solución |
|----------|----------|
| "Cannot GET /chat.html" | Asegúrate que el proxy está corriendo en puerto 3000 |
| Micrófono no funciona | Revisa permisos en navegador (chrome://settings/privacy) |
| Llamada no se establece | Ambos clientes deben estar en la misma red local |
| Servidor Java no inicia | Verifica que el puerto 5000 esté libre (`netstat -an`) |
| WebSocket rechazado | Usa `ws://` no `wss://` en red local |

## 📚 Documentación

Ver `IMPLEMENTATION.md` para:
- Detalles técnicos completos
- Protocolo WebSocket JSON
- Estructura de directorios
- Mejoras futuras

## ✅ Checklist de Funcionalidades

- [x] Mensajes de texto
- [x] Notas de voz (grabación + reproducción)
- [x] Llamadas de voz (WebSocket)
- [x] Grupos de chat
- [x] Contactos
- [x] Historial persistente
- [x] ZeroC ICE para RPC
- [x] Streaming de audio binario
- [x] UI moderna y responsive
- [x] Manejo de errores
- [x] Notificaciones en tiempo real

## 🎯 Próximos Pasos (Opcional)

1. **Seguridad**: Migrar a WSS (WebSocket Secure)
2. **Video**: Agregar WebRTC para videollamadas
3. **Base de datos**: Reemplazar archivos con PostgreSQL
4. **Autenticación**: Agregar login con contraseña
5. **Compresión**: Compresión adaptativa de audio
6. **Transcripción**: Speech-to-text para notas de voz

## 📞 Soporte

Para reportar bugs o sugerir mejoras, abre un issue en GitHub.

---

**¡Listo!** Disfruta del chat. 🎉
