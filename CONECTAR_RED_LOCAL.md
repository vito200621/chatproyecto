# Conectar PCs en la Misma Red Local

## ¿Cómo Funciona?

Sí, es totalmente posible conectar múltiples PCs desde la misma red local. El sistema funciona así:

```
PC A (192.168.1.100)                PC B (192.168.1.101)
  │                                   │
  └─ Navegador                       └─ Navegador
     http://192.168.1.100:3000          http://192.168.1.100:3000
              ↓                                    ↓
     Express Proxy (3000)             Conecta al mismo proxy
              ↓                                    ↓
     Java Server (5000/6000)   ←────────────────┘
              ↓
     Comparte estado de clientes
     Enruta mensajes entre PCs
```

## Paso 1: Verificar tu IP Local

Abre PowerShell y ejecuta:

```powershell
ipconfig
```

Busca algo como:

```
Adaptador de Ethernet o Wi-Fi:
   IPv4 Address . . . . . . . . . : 192.168.1.100
```

Anota esa IP (ejemplo: `192.168.1.100`)

## Paso 2: Configurar Firewall (Solo una vez)

**Ejecuta PowerShell como Administrador** y copia estos comandos:

```powershell
# Proxy Node.js
netsh advfirewall firewall add rule name="Chat Proxy 3000" dir=in action=allow protocol=tcp localport=3000

# Java Server TCP
netsh advfirewall firewall add rule name="Chat Server 5000" dir=in action=allow protocol=tcp localport=5000

# Java Server UDP (audio)
netsh advfirewall firewall add rule name="Chat Server 6000" dir=in action=allow protocol=udp localport=6000

# Ice WebSocket
netsh advfirewall firewall add rule name="Chat Ice 10000" dir=in action=allow protocol=tcp localport=10000
```

## Paso 3: Iniciar los Servidores (en PC A)

**Terminal 1 - Java:**
```bash
cd C:\Users\emanu\OneDrive\Documentos\GitHub\RepositoriosUniversidad\chatproyecto
java -jar server/build/libs/server.jar 5000 6000
```

**Terminal 2 - Proxy:**
```bash
cd C:\Users\emanu\OneDrive\Documentos\GitHub\RepositoriosUniversidad\chatproyecto\proxy-server
node server.js
```

Verás algo como:
```
[Proxy Server] Escuchando en http://0.0.0.0:3000
[Proxy Server] Accede desde esta PC: http://localhost:3000
[Proxy Server] Accede desde otra PC en red local:
  → http://192.168.1.100:3000
[Proxy Server] Servidor Java en localhost:5000
```

## Paso 4: Conectar desde Otra PC

En otra PC en la misma red WiFi/Ethernet, abre el navegador y ve a:

```
http://192.168.1.100:3000
```

(Reemplaza `192.168.1.100` con tu IP real)

## Paso 5: Verificar Que Funcionó

Después de conectar desde la otra PC:

1. En la primera PC: Verás que aparecen los clientes online
2. En la segunda PC: También verás los clientes online
3. Intenta enviar un mensaje entre las dos PCs

## ¿Por Qué No Aparecen los Clientes?

### Posibles Problemas

1. **Firewall bloqueando**
   - Solución: Ejecuta los comandos de firewall del Paso 2
   - Verifica: `netsh advfirewall firewall show rule name="Chat*"`

2. **Antivirus bloqueando**
   - Solución: Agrega excepciones para puerto 3000, 5000, 6000, 10000
   - O desactívalo temporalmente para testing

3. **Router con aislamiento de red**
   - Solución: En configuración del router, deshabilita "Client Isolation"
   - O conecta ambos PCs por Ethernet en lugar de WiFi

4. **Proxy no detecta IPs de otras interfaces**
   - Ya solucionado: El proxy ahora escucha en `0.0.0.0` (todas las interfaces)
   - Y detecta automáticamente todas las IPs locales

5. **Cliente web conectando a localhost hardcodeado**
   - Ya solucionado: Ahora usa `window.location.hostname` automáticamente

### Verificar Conectividad Básica

**Desde PC B, prueba conectar a PC A:**

```powershell
# Test TCP al proxy (3000)
Test-NetConnection -ComputerName 192.168.1.100 -Port 3000

# Test TCP al servidor Java (5000)
Test-NetConnection -ComputerName 192.168.1.100 -Port 5000
```

Deberían mostrar: `TcpTestSucceeded : True`

## Debugging

### Ver qué PCs están conectadas

**Desde cualquier PC, ejecuta:**

```python
import urllib.request
import json

# Reemplaza con tu IP
url = 'http://192.168.1.100:3000/api/clients'

try:
    response = urllib.request.urlopen(url)
    data = json.loads(response.read())
    print(json.dumps(data, indent=2))
except Exception as e:
    print(f"Error: {e}")
```

Deberías ver:
```json
{
  "success": true,
  "clients": [
    {"id": "1", "connected": true, "type": "tcp"},
    {"id": "2", "connected": true, "type": "websocket"}
  ]
}
```

### Ver logs del proxy

Mira la Terminal 2 (donde corre `node server.js`):
- Cuando se conecta un cliente: `[WS] Nueva conexión`
- Cuando se registra: `[WS] Cliente registrado: <clientId>`
- Cuando envía mensaje: `[WS] Mensaje recibido`

### Ver logs del servidor Java

Mira la Terminal 1 (donde corre `java -jar`):
- Cuando se conecta: `[Server] Nuevo cliente: <clientId>`
- Cuando envía mensaje: `[Mensaje]`

## Diferencia: Localhost vs Red Local

| Concepto | Localhost | Red Local |
|----------|-----------|-----------|
| URL | `http://localhost:3000` | `http://192.168.x.x:3000` |
| Accesible desde | Solo la misma PC | Cualquier PC en la red |
| Binding del servidor | `server.listen(3000, 'localhost')` | `server.listen(3000, '0.0.0.0')` |
| Caso de uso | Desarrollo local | Testing multidispositivo |

## Notas Importantes

- El servidor Java debe estar en **una sola PC** (donde ejecutas `java -jar`)
- El proxy Node.js debe estar en la **misma PC** que el servidor Java
- Los clientes web pueden estar en **cualquier PC** de la red
- No necesitan instalar nada, solo un navegador
- Funciona con WiFi, Ethernet, o ambos (siempre que estén en el mismo router)

## Red Pública vs Red Local

**Tu pregunta menciona "red pública" - aclaración:**

- Si estás en WiFi público/open de un café: `localhost:3000` no será accesible desde otros PCs
- Solución: Usa la IP local (`192.168.x.x`) en lugar de `localhost`
- Si el café tiene aislamiento de red: Conecta ambas PCs por Ethernet o espera a estar en una red con más permisos

**Red local (casa/oficina):**
- Recomendado: Ethernet > WiFi 5GHz > WiFi 2.4GHz
- Todos en el mismo router = pueden conectarse entre sí
