# Tarea 2 - Cliente Web HTTP para Chat


- Emanuel Murillo A00405783
- Victoria Restrepo A00405025
## Descripción del Proyecto

Este proyecto implementa un **cliente web** (HTML, CSS, JavaScript) que se comunica con el backend de chat en Java a través de un **servidor proxy HTTP** construido con Express.js. El proxy actúa como intermediario, traduciendo las peticiones HTTP del navegador a comandos TCP que el servidor Java puede entender.

## Arquitectura

```
┌─────────────────┐      HTTP      ┌──────────────────┐      TCP      ┌─────────────────┐
│                 │ ◄────────────► │                  │ ◄───────────► │                 │
│  Navegador Web  │                │  Proxy Express   │               │  Servidor Java  │
│  (HTML/CSS/JS)  │                │   (Node.js)      │               │   (TCP 5000)    │
│                 │                │                  │               │                 │
└─────────────────┘                └──────────────────┘               └─────────────────┘
    Cliente Web                      Puerto 3000                        Puerto 5000
```

## Estructura del Proyecto

```
ChatProyecto/
├── proxy-server/              # Servidor proxy HTTP (Express)
│   ├── package.json
│   ├── server.js              # Servidor Express con endpoints REST
│   └── tcpClient.js           # Manejador de conexiones TCP
│
├── web-client/                # Cliente web (frontend)
│   ├── index.html             # Página de login/conexión
│   ├── chat.html              # Interfaz principal de chat
│   ├── css/
│   │   └── styles.css         # Estilos responsive
│   └── js/
│       └── app.js             # Lógica del cliente
│
├── server/                    # Backend Java (existente)
│   └── src/main/java/server/
│       ├── ChatServer.java
│       ├── ClientHandler.java
│       └── HistoryService.java
│
├── client/                    # Cliente Java (existente - no se usa)
│
└── history/                   # Archivos de historial
    ├── user-1_2.log
    ├── group-*.log
    └── ...
```

## Funcionalidades Implementadas

### Requerimientos Cumplidos

1. **Crear grupos de chat**
   - Los usuarios pueden crear grupos con nombres personalizados
   - Se traducen a comandos `/createGroup` al servidor Java

2. **Enviar mensajes de texto a usuarios**
   - Mensajes privados entre usuarios identificados por ID
   - Comando TCP: `/msg <userId> <mensaje>`

3. **Enviar mensajes de texto a grupos**
   - Mensajes a grupos existentes
   - Comando TCP: `/msgGroup <groupName> <mensaje>`

4. **Visualizar historial de mensajes**
   - Lee archivos `.log` generados por el `HistoryService`
   - Muestra mensajes de texto y referencias a notas de voz
   - Historial de conversaciones privadas y grupales

### ⚠️ Funcionalidades NO Implementadas (según requerimientos)

- **Notas de voz en tiempo real**: Se implementarán en el proyecto final con WebSockets
- **Llamadas de voz**: Se implementarán en el proyecto final con WebSockets

## Instalación y Configuración

### Requisitos Previos

- **Java JDK 11+** (para el servidor backend)
- **Node.js 14+** y **npm** (para el proxy Express)
- **Navegador web moderno** (Chrome, Firefox, Edge, Safari)

### Paso 1: Instalar Dependencias del Proxy

```bash
cd proxy-server
npm install
```

Esto instalará:
- `express`: Framework web
- `cors`: Middleware para permitir peticiones cross-origin
- `body-parser`: Parser de JSON

### Paso 2: Compilar el Servidor Java

Desde la raíz del proyecto:

```bash
# Windows PowerShell
.\gradlew.bat clean build -x test

# Linux/Mac
./gradlew clean build -x test
```

## Ejecución del Sistema

### 1. Iniciar el Servidor Java (Backend TCP)

```bash
# Opción 1: Con Gradle
.\gradlew.bat :server:run --args="5000 6000"

# Opción 2: Con JAR
java -jar server/build/libs/server.jar 5000 6000
```

El servidor escuchará en:
- **Puerto TCP 5000**: Mensajería y control
- **Puerto UDP 6000**: Audio (no usado en esta tarea)

### 2. Iniciar el Proxy HTTP

En otra terminal:

```bash
cd proxy-server
npm start
```

El proxy escuchará en: **http://localhost:3000**

### 3. Abrir el Cliente Web

Abrir en el navegador:
```
http://localhost:3000/index.html
```

O simplemente: `http://localhost:3000`

## Uso del Cliente Web

### Conexión

1. Abrir `http://localhost:3000` en el navegador
2. Hacer clic en "Conectar"
3. El sistema asignará automáticamente un ID de cliente (1, 2, 3...)

### Crear Grupo

1. Click en el botón ➕ en la sección "Grupos"
2. Ingresar nombre del grupo
3. Click en "Crear Grupo"

### Agregar Contacto

1. Click en el botón ➕ en la sección "Contactos"
2. Ingresar ID del usuario (ej: 2, 3, 4)
3. Opcionalmente ingresar un nombre personalizado
4. Click en "Agregar"

### Enviar Mensajes

1. Seleccionar un contacto o grupo de la lista
2. Escribir mensaje en el campo de texto inferior
3. Click en "Enviar" o presionar Enter

### Cargar Historial

1. Seleccionar una conversación (contacto o grupo)
2. Click en el botón "📜 Cargar Historial"
3. Se mostrarán los mensajes anteriores guardados

## API REST del Proxy

### Endpoints Disponibles

#### `POST /api/connect`
Conecta un nuevo cliente al servidor Java.

**Response:**
```json
{
  "success": true,
  "clientId": 1,
  "message": "Conectado al servidor exitosamente"
}
```

#### `POST /api/disconnect`
Desconecta un cliente.

**Request:**
```json
{
  "clientId": 1
}
```

#### `POST /api/groups/create`
Crea un nuevo grupo.

**Request:**
```json
{
  "clientId": 1,
  "groupName": "Amigos"
}
```

#### `POST /api/messages/user`
Envía mensaje privado.

**Request:**
```json
{
  "clientId": 1,
  "targetId": 2,
  "message": "Hola!"
}
```

#### `POST /api/messages/group`
Envía mensaje a grupo.

**Request:**
```json
{
  "clientId": 1,
  "groupName": "Amigos",
  "message": "Hola a todos!"
}
```

#### `GET /api/history/user/:fromId/:toId`
Obtiene historial de conversación privada.

**Response:**
```json
{
  "success": true,
  "messages": [
    {
      "timestamp": "2025-01-08 14:30:00",
      "from": 1,
      "to": 2,
      "content": "Hola!"
    }
  ],
  "voiceNotes": []
}
```

#### `GET /api/history/group/:groupName`
Obtiene historial de grupo.

## Protocolo TCP (Backend Java)

El proxy traduce peticiones HTTP a estos comandos TCP:

| Acción | Comando TCP |
|--------|-------------|
| Crear grupo | `/createGroup <nombre>` |
| Unirse a grupo | `/joinGroup <nombre>` |
| Mensaje privado | `/msg <userId> <mensaje>` |
| Mensaje grupal | `/msgGroup <nombre> <mensaje>` |

## Características Técnicas

### Frontend (Cliente Web)

- **HTML5**: Estructura semántica
- **CSS3**: Diseño responsive con flexbox/grid
- **JavaScript ES6+**: Lógica moderna con async/await
- **LocalStorage**: Persistencia de contactos y grupos
- **SessionStorage**: Manejo de sesión de usuario
- **Fetch API**: Comunicación HTTP con el proxy

### Proxy (Express)

- **Node.js + Express**: Servidor HTTP
- **net (TCP)**: Conexión con backend Java
- **CORS**: Permite peticiones desde el navegador
- **Pool de conexiones**: Maneja múltiples clientes simultáneos
- **File System**: Lee archivos de historial

### Backend (Java)

- **Socket TCP**: Comunicación cliente-servidor
- **Multithreading**: Manejo concurrente de clientes
- **HistoryService**: Persistencia en archivos `.log`
- **Protocolo personalizado**: Comandos de texto

## Solución de Problemas

### Error: "Cannot connect to server"

1. Verificar que el servidor Java esté ejecutándose
2. Confirmar que el puerto 5000 esté libre
3. Revisar configuración de firewall

### Error: "CORS policy"

- El proxy debe estar ejecutándose en el puerto 3000
- Abrir el cliente desde `http://localhost:3000`, no desde `file://`

### Error: "Cliente no conectado"

- Refrescar la página e iniciar sesión nuevamente
- Verificar que el proxy esté conectado al servidor Java

### El historial no se carga

- Verificar que exista el archivo en la carpeta `history/`
- El formato debe ser: `user-X_Y.log` o `group-NOMBRE.log`

## Pruebas Recomendadas

### Escenario 1: Chat entre dos usuarios

1. Abrir dos navegadores (o pestañas en modo incógnito)
2. Conectar cliente 1 y cliente 2
3. Ambos agregan al otro como contacto
4. Enviar mensajes entre ellos
5. Cargar historial y verificar que aparecen

### Escenario 2: Chat grupal

1. Cliente 1 crea grupo "Test"
2. Cliente 2 se une al grupo "Test" (desde el modal ➕)
3. Ambos envían mensajes al grupo
4. Verificar que ambos reciben los mensajes

### Escenario 3: Persistencia

1. Enviar varios mensajes
2. Cerrar el navegador
3. Reconectar y cargar historial
4. Verificar que los mensajes persisten

## Tecnologías Utilizadas

| Componente | Tecnologías |
|------------|-------------|
| **Frontend** | HTML5, CSS3, JavaScript ES6+ |
| **Proxy** | Node.js, Express.js, net (TCP) |
| **Backend** | Java 11+, TCP Sockets, Multithreading |
| **Almacenamiento** | Archivos de texto (.log) |
| **Protocolo** | HTTP (web↔proxy), TCP (proxy↔backend) |



## Notas Adicionales

- Esta implementación cumple con los requerimientos de la Tarea 2
- Las funcionalidades en tiempo real (WebSockets) se implementarán en el proyecto final
- El servidor Java original NO fue modificado, solo se agregó la capa HTTP
- Los clientes web pueden coexistir con clientes Java tradicionales

---


