package ui;

import server.ChatServer;
import server.ice.IceChatServer;

public class Main {
    public static void main(String[] args) {
        int tcpPort = 5000;
        int udpPort = 6000;
        int poolSize = 8;

        System.out.println("Iniciando servidores...");
        System.out.println("TCP: " + tcpPort + ", UDP: " + udpPort + ", Ice WebSocket: 10000");

        try (
                ChatServer server = new ChatServer(tcpPort, udpPort, poolSize);
                IceChatServer iceServer = new IceChatServer(server)
        ) {
            // Iniciar servidor Ice en segundo plano
            Thread iceThread = new Thread(() -> {
                iceServer.start();
            });
            iceThread.setDaemon(true); // Para que se cierre cuando el main termine
            iceThread.start();

            // Pequeña pausa para que Ice se inicie
            Thread.sleep(2000);

            // Iniciar servidor TCP legacy
            System.out.println("Todos los servidores inicializados - Listo para conexiones");
            server.start();

        } catch (Exception e) {
            System.err.println(" Error iniciando servidores: " + e.getMessage());
            e.printStackTrace();
        }
    }
}