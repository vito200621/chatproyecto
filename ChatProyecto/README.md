# ChatProyecto

Proyecto de chat por terminal en Java que integra:
- TCP para mensajería entre 2 usuarios.
- UDP para transmisión de audio (voz en vivo) entre dos clientes vía un relay en el servidor.
- Semáforos para coordinar el procesamiento de solicitudes de mensajes entre los dos usuarios.
- Thread pools (ExecutorService) en el servidor para manejar concurrencia de clientes.

No tiene UI gráfica; se usa por terminal con un menú simple:
- Para mensaje 1, para audio 2.

## Estructura
- server: servidor TCP (mensajes) + relay UDP (audio).
- client: cliente con conexión TCP para mensajes y audio por UDP (micrófono/parlante).

## Requisitos
- Java 17+
- Micrófono y parlantes habilitados para probar audio.

## Compilación
Desde la carpeta `ChatProyecto`:

Windows:
```
.\gradlew.bat clean build -x test
```

## Ejecución
1) Servidor (por defecto TCP 5000, UDP 6000):
```
.\gradlew.bat :server:run --args="5000 6000"
```

2) Cliente 1:
```
.\gradlew.bat :client:run --args="127.0.0.1 5000 6000"
```

3) Cliente 2 (en otra terminal):
```
.\gradlew.bat :client:run --args="127.0.0.1 5000 6000"
```

Si al ejecutar con Gradle ves que imprime el menú y el proceso termina, asegúrate de usar las tareas del proyecto actualizado. Ahora la tarea `:client:run` adjunta la entrada estándar (stdin) y permite escribir en el menú. Alternativamente, puedes ejecutar el jar directamente para garantizar la interacción:

- Servidor:
```
java -jar server/build/libs/server.jar 5000 6000
```
- Cliente (cada terminal):
```
java -jar client/build/libs/client.jar 127.0.0.1 5000 6000
```

En el cliente verás el menú:
- "Seleccione una opción: Para mensaje 1, para audio 2, salir q"

- Opción 1: te pedirá el texto a enviar al otro usuario.
- Opción 2: alterna el envío de audio (inicia/detiene). Siempre está habilitada la recepción de audio para escuchar al otro lado.
- Opción q: salir.

## Notas técnicas
- El servidor asigna IDs 1 y 2 a los clientes conectados y reenvía los mensajes entre ellos.
- Un `Semaphore(1, true)` asegura que el procesamiento de mensajes sea serializado (simula una sección crítica compartida entre 2 usuarios).
- El audio viaja por UDP: el servidor aprende los endpoints UDP de cada cliente cuando reciba sus primeros paquetes y actúa como relay hacia el otro cliente.

## Basado en ejemplos del repositorio
- 02_udp: base para datagramas.
- 03_tcp: base para conexión TCP.
- 04_semaforos: uso de semáforos.
- 05_thread_pools: manejo de hilos en el servidor.
- 06_audio: captura y reproducción de audio.


## Solución a error en Windows: "Unable to delete directory ... build\\classes\\java\\main"
Para evitar bloqueos típicos de Windows (OneDrive, antivirus, indexadores, IDEs) al borrar `build/classes`, el proyecto ahora redirige por defecto las carpetas de build fuera del repositorio a `%LOCALAPPDATA%\\ChatProyectoBuild\\<modulo>`.

- Puedes forzar u orientar la ubicación del build con:
  - Variable de entorno: `CHATPROYECTO_BUILD_BASE=C:\\Ruta\\FueraDeOneDrive`
  - Propiedad Gradle: `-PchatProyecto.buildBase=C:\\Ruta\\FueraDeOneDrive`
- Verifica la ubicación efectiva de cada subproyecto:
  - `.\u200bgradlew.bat :client:printBuildDir :server:printBuildDir`

Ejemplos (PowerShell):
```
$env:CHATPROYECTO_BUILD_BASE="C:\\Temp\\ChatBuild"
.\gradlew.bat --stop
.\gradlew.bat clean build -x test
.\gradlew.bat :server:run --args="5000 6000"
.\gradlew.bat :client:run --args="127.0.0.1 5000 6000"
```

Notas y solución de problemas:
- Cierra procesos del servidor/cliente antes de recompilar.
- Si ves rutas de error bajo OneDrive (p. ej., `C:\\Users\\...\\OneDrive\\...\\client\\build\\classes`), probablemente estás compilando otra copia del proyecto. Asegúrate de abrir y construir esta carpeta y/o ejecuta `git pull` para traer los cambios.
- Si el problema persiste, ejecuta `.\u200bgradlew.bat :client:printBuildDir :server:printBuildDir` y comparte la salida.
