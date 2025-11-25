# Cómo Ejecutar el Chat con ZeroC ICE

Este proyecto es una aplicación de chat implementada con:
- **Backend**: Java con ZeroC ICE para RPC
- **Proxy**: Node.js/Express para WebSocket y HTTP
- **Frontend**: Navegador con JavaScript vanilla

## Arquitectura

```
Navegador (http://localhost:3000)
    ↓
Express Proxy (http://localhost:3000, ws://localhost:3000)
    ↓
Java Backend (TCP: 5000, UDP: 6000, Ice WebSocket: 10000)
```

## Requisitos Previos

- Java 11 o superior
- Node.js 14+
- Gradle 7+
- Git

## ⚡ QUICK START (Localhost)

```bash
# Terminal 1
java -jar server/build/libs/server.jar 5000 6000

# Terminal 2
cd proxy-server && node server.js

# Navegador
http://localhost:3000
```

### Para Red Local (Múltiples PCs)

Consulta `CONECTAR_RED_LOCAL.md` para instrucciones completas de firewall y red.
Resumen rápido:
- Ejecuta firewall rules (Paso 2 en CONECTAR_RED_LOCAL.md)
- Obtén tu IP: `ipconfig` en PowerShell
- Accede desde otro PC: `http://192.168.x.x:3000`
- El sistema detecta automáticamente IPs locales

## Pasos para Ejecutar

### 1. Construir el Proyecto Java

```bash
cd c:\Users\emanu\OneDrive\Documentos\GitHub\RepositoriosUniversidad\chatproyecto
.\gradlew clean build
```

Este comando:
- Descarga ZeroC ICE 3.7.10
- Genera stubs desde `Chat.ice` usando slice2java
- Compila los servicios Java (ChatServiceI, AudioCallServiceI)
- Crea un fat JAR con todas las dependencias en `server/build/libs/server.jar`

### 2. Iniciar el Servidor Java

En una terminal (Terminal 1):

```bash
cd c:\Users\emanu\OneDrive\Documentos\GitHub\RepositoriosUniversidad\chatproyecto
java -jar server/build/libs/server.jar 5000 6000
```

Salida esperada:
```
Iniciando servidores...
TCP: 5000, UDP: 6000, Ice WebSocket: 10000
Iniciando servidor Ice...
Servidor Ice iniciado exitosamente
WebSocket endpoint: ws://localhost:10000
Servicios disponibles:
- ChatService
- AudioCallService
```

### 3. Iniciar el Proxy Node.js

En otra terminal (Terminal 2):

```bash
cd c:\Users\emanu\OneDrive\Documentos\GitHub\RepositoriosUniversidad\chatproyecto\proxy-server
node server.js
```

Salida esperada:
```
[Proxy Server] Escuchando en http://localhost:3000
[Proxy Server] Servidor Java en localhost:5000
```

### 4. Abrir el Cliente Web

En tu navegador:
```
http://localhost:3000
```

Verás:
1. Página de login
2. Presiona "Conectar" para obtener tu ID de cliente
3. Se abrirá la página de chat con:
   - Sección de Grupos
   - Sección de Clientes Online (se actualiza cada 5 segundos)
   - Sección de Contactos
   - Area de mensajes

## Características Implementadas

### ✅ ICE (RPC)
- Integrado con ZeroC ICE 3.7.10
- Servicios disponibles: ChatService, AudioCallService
- Stubs generados automáticamente desde `server/src/main/slice/Chat.ice`
- Accesibles vía WebSocket en `ws://localhost:10000`

### ✅ Chat en Tiempo Real
- Mensajes entre usuarios
- Grupos de chat
- Historial de conversaciones
- WebSockets para notificaciones en tiempo real

### ✅ Audio/Voz
- Grabación de notas de voz
- Envío vía WebSocket (binario)
- Reproducción en tiempo real
- Relay UDP para optimizar transmisión de audio

### ✅ Clientes Online
- Lista dinámica de usuarios conectados
- Se actualiza automáticamente cada 5 segundos
- Click para agregar como contacto
- Disponible en `/api/clients`

## Estructura del Proyecto

```
chatproyecto/
├── server/                           # Backend Java
│   ├── src/main/java/
│   │   ├── server/                  # Lógica principal del servidor
│   │   │   ├── ChatServer.java      # Servidor TCP principal
│   │   │   ├── ClientHandler.java   # Manejo de clientes TCP
│   │   │   ├── HistoryService.java  # Persistencia de historial
│   │   │   └── ice/                 # Servicios ZeroC ICE
│   │   │       ├── IceChatServer.java
│   │   │       ├── ChatServiceI.java
│   │   │       └── AudioCallServiceI.java
│   │   └── ui/Main.java             # Punto de entrada
│   ├── src/main/slice/              # Definiciones IDL de ICE
│   │   └── Chat.ice
│   ├── generated-src/               # Stubs generados (auto-generado)
│   ├── gradle/ice.gradle            # Configuración slice2java
│   └── build.gradle                 # Configuración Gradle
├── proxy-server/                     # Proxy Node.js
│   ├── server.js                    # Servidor Express + WebSocket
│   ├── tcpClient.js                 # Cliente TCP al servidor Java
│   └── package.json
├── web-client/                       # Frontend
│   ├── index.html                   # Login
│   ├── chat.html                    # Chat UI
│   ├── js/
│   │   ├── app-new.js               # Lógica principal
│   │   ├── audioManager.js          # Grabación de audio
│   │   └── ice/
│   │       ├── iceProxy.js          # Proxy WebSocket para ICE
│   │       └── iceClient.js         # Cliente de bajo nivel
│   └── css/styles.css               # Estilos
└── history/                          # Archivos de historial (persistencia)
```

## Troubleshooting

### El cliente dice "Cargando clientes..." pero no aparece nada

**Problema**: El endpoint `/api/clients` devuelve una lista vacía
**Solución**: Es normal si no hay otros clientes conectados. Abre otra pestaña del navegador y conecta otro cliente.

### Error: "No se puede conectar al servidor remoto"

**Problema**: El servidor Java no está corriendo
**Solución**: Verifica que en Terminal 1 esté corriendo `java -jar server/build/libs/server.jar 5000 6000`

### Error en consola del navegador: "WebSocket is closed"

**Problema**: El proxy no está corriendo
**Solución**: Verifica que en Terminal 2 esté corriendo `node server.js` en la carpeta `proxy-server`

### "Tamaño JSON inválido" en el proxy

**Problema**: Datos binarios malformados en el WebSocket
**Solución**: Es un mensaje de validación, ignóralo. El sistema descarta datos malformados automáticamente.

## Testing

### Prueba rápida del endpoint de clientes

```python
import urllib.request
import json

response = urllib.request.urlopen('http://localhost:3000/api/clients')
data = json.loads(response.read())
print(json.dumps(data, indent=2))
```

Salida esperada:
```json
{
  "success": true,
  "clients": [
    {"id": "1", "connected": true, "type": "tcp"},
    {"id": "2", "connected": true, "type": "websocket"}
  ]
}
```

## Notas de Desarrollo

- Los stubs de ICE se generan automáticamente en `server/generated-src/` durante el build
- El proyecto usa un fat JAR para facilitar la distribución (no requiere classpath complejo)
- El frontend es vanilla JavaScript (sin frameworks) para máxima compatibilidad
- El proxy es necesario para permitir WebSockets desde el navegador (CORS + protocolo WebSocket)
- Los mensajes se persisten en `history/` en formato JSON por sesión

## Git

Para trabajar con el repositorio:

```bash
git add .
git commit -m "Descripción de cambios"
git push
```

Archivos ignorados:
- `server/generated-src/` (regenerado en cada build)
- `server/build/` (carpeta de construcción)
- `proxy-server/node_modules/` (dependencias Node.js)
- `web-client/build/` (si existe)
