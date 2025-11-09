package ui;

import client.*;

public class Main {
    public static void main(String[] args) {
        String host = "localhost";
        int tcpPort = 5000;
        int udpPort = 6000;
        if (args.length >= 1) host = args[0];
        if (args.length >= 2) tcpPort = Integer.parseInt(args[1]);
        if (args.length >= 3) udpPort = Integer.parseInt(args[2]);

        System.out.println("Cliente apuntando a " + host + ":" + tcpPort + " (UDP " + udpPort + ")");
        try (ChatClient client = new ChatClient(host, tcpPort, udpPort)) {
            client.connect();
            client.runMenu();
        } catch (Exception e) {
            System.err.println("No se pudo conectar al servidor " + host + ":" + tcpPort + ". Posibles causas:");
            System.err.println("- El servidor no está en ejecución o usa otros puertos.");
            System.err.println("- La IP no es correcta. Usa una de las que imprime el servidor al iniciar.");
            System.err.println("- El Firewall de Windows bloquea el puerto. Abre TCP " + tcpPort + " y UDP " + udpPort + ".");
            System.err.println("Detalle: " + e.getMessage());
            System.err.println("Uso: <host> [tcpPort] [udpPort]  Ej.: 192.168.1.23 5000 6000");
        }
    }
}
