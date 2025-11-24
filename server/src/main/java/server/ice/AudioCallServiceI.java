package server.ice;

import com.zeroc.Ice.Current;
import Chat.*;
import server.ChatServer;

public class AudioCallServiceI implements AudioCallService {
    private final ChatServer legacyServer;

    public AudioCallServiceI(ChatServer legacyServer) {
        this.legacyServer = legacyServer;
    }

    @Override
    public void startCall(String fromUser, String toUser, Current current) {
        System.out.println("[Ice Audio] Llamada iniciada de " + fromUser + " a " + toUser);
    }

    @Override
    public void streamCallAudio(String fromUser, byte[] audioData, Current current) {
        System.out.println("[Ice Audio] Audio recibido de " + fromUser + " (" + audioData.length + " bytes)");
    }

    @Override
    public void endCall(String fromUser, String toUser, Current current) {
        System.out.println("[Ice Audio] Llamada finalizada de " + fromUser + " a " + toUser);
    }
}