# Integrantes
- Emanuel Murillo - A00405783
- Victoria Restrepo - A00405025

A continuación se explica cómo ejecutar el servidor en una computadora y el/los clientes desde otra(s) en la misma red local (Wi‑Fi o cable Ethernet).

Requisitos previos:
- Ambas máquinas deben estar en la misma red/subred (por ejemplo 192.168.1.X o 10.0.0.X).
- Asegúrate de conocer la IP de la PC donde corre el servidor y de tener abiertos los puertos:
  - TCP 5000 (mensajería y control)
  - UDP 6000 (audio en vivo)

Pasos:
1) Compila los JAR (en cualquiera de las máquinas, normalmente en la del servidor):
   - Windows PowerShell:
     ```
     .\gradlew.bat clean build -x test
     ```

2) Inicia el servidor en la PC anfitriona (servidor):
   - Con Gradle:
     ```
     .\gradlew.bat :server:run --args="5000 6000"
     ```
   - O con el JAR directamente:
     ```
     java -jar server/build/libs/server.jar 5000 6000
     ```
   - El servidor imprimirá las IPs locales detectadas, por ejemplo:
     `[Servidor] IPs locales: 192.168.1.23, 10.0.0.5 (usa una desde otro PC)`.
     Toma una de esas IPs para conectar los clientes desde otras máquinas.

3) Abre el firewall en Windows para permitir conexiones entrantes en la PC del servidor (ejecuta PowerShell como Administrador):
   ```
   netsh advfirewall firewall add rule name="ChatProyecto TCP 5000" dir=in action=allow protocol=TCP localport=5000 profile=any
   netsh advfirewall firewall add rule name="ChatProyecto UDP 6000" dir=in action=allow protocol=UDP localport=6000 profile=any
   ```
   - Si Windows te pide permiso al primer inicio, acepta para redes Privadas y Públicas según corresponda.

4) Inicia el cliente en otra PC de la misma red, apuntando a la IP del servidor y los mismos puertos:
   - Con Gradle:
     ```
     .\gradlew.bat :client:run --args="<IP_DEL_SERVIDOR> 5000 6000"
     ```
   - O con el JAR:
     ```
     java -jar client/build/libs/client.jar <IP_DEL_SERVIDOR> 5000 6000
     ```
   - Ejemplo real:
     ```
     java -jar client/build/libs/client.jar 192.168.1.23 5000 6000
     ```

5) Abre otra terminal en esa segunda PC (u otra tercera PC) y repite el cliente para tener 2 usuarios conectados.


---

Solución de problemas (LAN)
- El cliente ahora muestra: "Conectando a <host>:<puerto>..." y corta a los ~5s si no puede llegar. Si ves tiempo de espera agotado, casi siempre es el firewall o la IP equivocada.
- Verifica que el servidor imprime las IPs locales y usa exactamente una de esa lista en el cliente.
- Prueba conectividad básica desde el cliente:
  - ping <IP_DEL_SERVIDOR>
  - Testea el puerto TCP 5000 si puedes (por ejemplo con `Test-NetConnection -ComputerName <IP> -Port 5000` en PowerShell).
- En Windows, crea reglas de firewall (en la PC del servidor):
  - netsh advfirewall firewall add rule name="ChatProyecto TCP 5000" dir=in action=allow protocol=TCP localport=5000 profile=any
  - netsh advfirewall firewall add rule name="ChatProyecto UDP 6000" dir=in action=allow protocol=UDP localport=6000 profile=any
- Evita redes de invitados o aislamiento AP: si el router bloquea tráfico entre clientes, dos PCs en la misma Wi‑Fi no podrán verse.
- Asegúrate de que ambos usen los mismos puertos: TCP 5000 y UDP 6000, o cambia ambos lados con los mismos valores.
- Si corres el cliente sin argumentos, intentará localhost. Para otra PC debes pasar la IP: `... client.jar 192.168.1.23 5000 6000`.
