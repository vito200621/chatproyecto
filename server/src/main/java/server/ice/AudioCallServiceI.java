package server.ice;

import com.zeroc.Ice.Current;
import Chat.*;
import java.util.*;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Implementación de AudioCallService usando ZeroC ICE
 * Maneja llamadas en tiempo real y streaming de audio entre usuarios
 */
public class AudioCallServiceI implements AudioCallService {
    private final Object legacyServer;
    
    // Registro de llamadas activas: "fromUser->toUser" -> ChatCallbackPrx[]
    private final Map<String, ChatCallbackPrx[]> activeCalls = new ConcurrentHashMap<>();
    
    // Mapeo de callbacks registrados: userId -> ChatCallbackPrx
    private final Map<String, ChatCallbackPrx> userCallbacks = new ConcurrentHashMap<>();

    public AudioCallServiceI(Object legacyServer) {
        this.legacyServer = legacyServer;
    }
    @Override
    public void startCall(String fromUser, String toUser, Current current) throws UserNotFound {
        System.out.println("[Ice Audio] Llamada iniciada de " + fromUser + " a " + toUser);
        
        // Verificar que ambos usuarios existan (en un sistema real)
        if (fromUser == null || fromUser.isEmpty() || toUser == null || toUser.isEmpty()) {
            throw new UserNotFound("Usuario inválido");
        }
        
        // Registrar la llamada activa
        String callKey = fromUser + "->" + toUser;
        ChatCallbackPrx[] participants = new ChatCallbackPrx[2];
        participants[0] = userCallbacks.get(fromUser);
        participants[1] = userCallbacks.get(toUser);
        
        activeCalls.put(callKey, participants);
        System.out.println("[Ice Audio] Llamada registrada: " + callKey);
        
        // Notificar al usuario receptor (si tiene callback)
        if (participants[1] != null) {
            try {
                // Enviar notificación de entrada de llamada (como un mensaje especial)
                Message callMsg = new Message();
                callMsg.id = UUID.randomUUID().toString();
                callMsg.sender = fromUser;
                callMsg.content = "[CALL_INCOMING]";
                callMsg.timestamp = System.currentTimeMillis();
                callMsg.type = "call";
                participants[1].onMessage(callMsg);
            } catch (Exception e) {
                System.err.println("[Ice Audio] Error notificando al usuario " + toUser + ": " + e.getMessage());
            }
        }
    }

    @Override
    public void streamCallAudio(String fromUser, byte[] audioData, Current current) {
        if (audioData == null || audioData.length == 0) return;
        
        System.out.println("[Ice Audio] Audio recibido de " + fromUser + " (" + audioData.length + " bytes)");
        
        // Buscar todas las llamadas activas de este usuario y reenviar audio a los receptores
        for (Map.Entry<String, ChatCallbackPrx[]> entry : activeCalls.entrySet()) {
            String callKey = entry.getKey();
            ChatCallbackPrx[] participants = entry.getValue();
            
            if (callKey.startsWith(fromUser + "->")) {
                // Es la llamada de este usuario, reenviar audio al receptor
                ChatCallbackPrx receptor = participants[1];
                if (receptor != null) {
                    try {
                        // Enviar audio como una "nota de voz" especial
                        receptor.onVoiceNote(fromUser, "call_audio_" + System.currentTimeMillis() + ".wav", audioData);
                    } catch (Exception e) {
                        System.err.println("[Ice Audio] Error reenviando audio: " + e.getMessage());
                    }
                }
            }
        }
    }

    @Override
    public void endCall(String fromUser, String toUser, Current current) {
        System.out.println("[Ice Audio] Llamada finalizada de " + fromUser + " a " + toUser);
        
        String callKey = fromUser + "->" + toUser;
        activeCalls.remove(callKey);
        
        // Notificar al usuario receptor
        ChatCallbackPrx receptor = userCallbacks.get(toUser);
        if (receptor != null) {
            try {
                Message endMsg = new Message();
                endMsg.id = UUID.randomUUID().toString();
                endMsg.sender = fromUser;
                endMsg.content = "[CALL_ENDED]";
                endMsg.timestamp = System.currentTimeMillis();
                endMsg.type = "call";
                receptor.onMessage(endMsg);
            } catch (Exception e) {
                System.err.println("[Ice Audio] Error notificando fin de llamada: " + e.getMessage());
            }
        }
    }
    
    /**
     * Registrar callback para un usuario (usado por ChatServiceI)
     */
    public void registerUserCallback(String userId, ChatCallbackPrx callback) {
        userCallbacks.put(userId, callback);
        System.out.println("[Ice Audio] Callback registrado para usuario " + userId);
    }
    
    /**
     * Desregistrar callback
     */
    public void unregisterUserCallback(String userId) {
        userCallbacks.remove(userId);
        System.out.println("[Ice Audio] Callback desregistrado para usuario " + userId);
    }
}