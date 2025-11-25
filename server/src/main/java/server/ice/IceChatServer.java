package server.ice;

import com.zeroc.Ice.Communicator;
import com.zeroc.Ice.ObjectAdapter;
import com.zeroc.Ice.Util;
import server.ChatServer;

public class IceChatServer implements AutoCloseable {
    private Communicator communicator;
    private final ChatServer legacyServer;

    public IceChatServer(ChatServer legacyServer) {
        this.legacyServer = legacyServer;
    }

    public void start() {
        try {
            System.out.println("Iniciando servidor Ice...");

            // Configuración para WebSockets
            String[] args = new String[] {
                    "--Ice.MessageSizeMax=102400" // 100KB para audio
            };

            communicator = Util.initialize(args);
            
            // Crear adapter con WebSocket
            ObjectAdapter adapter = communicator.createObjectAdapterWithEndpoints(
                    "ChatAdapter",
                    "ws -h localhost -p 10000"
            );

            // Registrar servantes (ChatService)
            ChatServiceI chatService = new ChatServiceI(legacyServer);
            adapter.add(chatService, Util.stringToIdentity("ChatService"));

            // Registrar servantes (AudioCallService)
            AudioCallServiceI audioService = new AudioCallServiceI(legacyServer);
            adapter.add(audioService, Util.stringToIdentity("AudioCallService"));

            // Activar adapter
            adapter.activate();

            System.out.println("Servidor Ice iniciado exitosamente");
            System.out.println("WebSocket endpoint: ws://localhost:10000");
            System.out.println("Servicios disponibles:");
            System.out.println("- ChatService");
            System.out.println("- AudioCallService");

        } catch (Exception e) {
            System.err.println("Error iniciando servidor Ice: " + e.getMessage());
            e.printStackTrace();
        }
    }

    @Override
    public void close() {
        if (communicator != null) {
            try {
                communicator.destroy();
                System.out.println("Servidor Ice cerrado");
            } catch (Exception e) {
                System.err.println("Error cerrando servidor Ice: " + e.getMessage());
            }
        }
    }
}