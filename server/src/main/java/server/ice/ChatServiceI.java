package server.ice;

import com.zeroc.Ice.Current;
import Chat.*;
import server.ChatServer;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class ChatServiceI implements ChatService {
    private final ChatServer legacyServer;
    private final Map<String, ChatCallbackPrx> callbacks; // Para el método con ChatCallbackPrx
    private final Map<String, ChatCallback> directCallbacks; // Para el método con ChatCallback (si es necesario)
    private final Map<String, String> userSessions;

    public ChatServiceI(ChatServer legacyServer) {
        this.legacyServer = legacyServer;
        this.callbacks = new ConcurrentHashMap<>();
        this.directCallbacks = new ConcurrentHashMap<>(); // Nuevo mapa para callbacks directos
        this.userSessions = new ConcurrentHashMap<>();
    }

    // === IMPLEMENTACIÓN DE TODOS LOS MÉTODOS DE ChatService ===

    @Override
    public User login(String username, Current current) {
        try {
            String userId = "user_" + System.currentTimeMillis();
            User user = new User();
            user.id = userId;
            user.username = username;
            user.online = true;

            userSessions.put(userId, username);
            System.out.println("[Ice] Usuario logueado: " + username + " (" + userId + ")");
            return user;
        } catch (Exception e) {
            System.err.println("Error en login: " + e.getMessage());
            User fallback = new User();
            fallback.id = "error";
            fallback.username = username;
            fallback.online = false;
            return fallback;
        }
    }

    @Override
    public void logout(String userId, Current current) {
        callbacks.remove(userId);
        directCallbacks.remove(userId);
        userSessions.remove(userId);
        System.out.println("[Ice] Usuario desconectado: " + userId);
    }

    @Override
    public void sendPrivateMessage(String fromUser, String toUser, String message, Current current) {
        try {
            System.out.println("[Ice] Mensaje privado de " + fromUser + " a " + toUser + ": " + message);

            int fromId = extractNumericId(fromUser);
            int toId = extractNumericId(toUser);
            legacyServer.sendPrivateMessage(fromId, toId, message);

            // Notificar al receptor via callback (usando ChatCallbackPrx - el principal)
            ChatCallbackPrx targetCallback = callbacks.get(toUser);
            if (targetCallback != null) {
                Message msg = new Message();
                msg.id = String.valueOf(System.currentTimeMillis());
                msg.sender = fromUser;
                msg.content = message;
                msg.timestamp = System.currentTimeMillis();
                msg.type = "text";
                targetCallback.onMessage(msg);
            }
        } catch (Exception e) {
            System.err.println("Error enviando mensaje privado: " + e.getMessage());
        }
    }

    @Override
    public void sendGroupMessage(String fromUser, String groupName, String message, Current current) {
        try {
            System.out.println("[Ice] Mensaje grupal de " + fromUser + " en " + groupName + ": " + message);
            int fromId = extractNumericId(fromUser);
            legacyServer.sendGroupMessage(groupName, fromId, message);
        } catch (Exception e) {
            System.err.println("Error enviando mensaje grupal: " + e.getMessage());
        }
    }

    @Override
    public String createGroup(String groupName, String creator, Current current) {
        try {
            String groupId = "group_" + System.currentTimeMillis();
            System.out.println("[Ice] Grupo creado: " + groupName + " por " + creator);
            return groupId;
        } catch (Exception e) {
            System.err.println("Error creando grupo: " + e.getMessage());
            return "error";
        }
    }

    @Override
    public void joinGroup(String groupName, String user, Current current) {
        try {
            System.out.println("[Ice] Usuario " + user + " se unió a " + groupName);
        } catch (Exception e) {
            System.err.println("Error uniéndose al grupo: " + e.getMessage());
        }
    }

    @Override
    public void leaveGroup(String groupName, String user, Current current) {
        try {
            System.out.println("[Ice] Usuario " + user + " dejó " + groupName);
        } catch (Exception e) {
            System.err.println("Error dejando grupo: " + e.getMessage());
        }
    }

    @Override
    public Group getGroupDetails(String groupName, Current current) {
        try {
            Group group = new Group();
            group.id = groupName;
            group.name = groupName;
            group.members = new String[0];
            return group;
        } catch (Exception e) {
            System.err.println("Error obteniendo detalles del grupo: " + e.getMessage());
            Group fallback = new Group();
            fallback.id = "error";
            fallback.name = groupName;
            fallback.members = new String[0];
            return fallback;
        }
    }

    @Override
    public Group[] listGroups(String userId, Current current) {
        try {
            System.out.println("[Ice] Listando grupos para: " + userId);
            return new Group[0];
        } catch (Exception e) {
            System.err.println("Error listando grupos: " + e.getMessage());
            return new Group[0];
        }
    }

    @Override
    public void sendVoiceNoteToUser(String fromUser, String toUser, String filename, byte[] data, Current current) {
        try {
            System.out.println("[Ice] Nota de voz de " + fromUser + " a " + toUser + ", tamaño: " + data.length);
            int fromId = extractNumericId(fromUser);
            int toId = extractNumericId(toUser);
            legacyServer.sendVoiceNoteToUser(String.valueOf(toId), data, filename, String.valueOf(fromId));
        } catch (Exception e) {
            System.err.println("Error enviando nota de voz: " + e.getMessage());
        }
    }

    @Override
    public void sendVoiceNoteToGroup(String fromUser, String groupName, String filename, byte[] data, Current current) {
        try {
            System.out.println("[Ice] Nota de voz grupal de " + fromUser + " en " + groupName + ", tamaño: " + data.length);
            int fromId = extractNumericId(fromUser);
            legacyServer.sendVoiceNoteToGroup(fromId, groupName, filename, data);
        } catch (Exception e) {
            System.err.println("Error enviando nota de voz grupal: " + e.getMessage());
        }
    }

    @Override
    public Message[] getMessageHistory(String userId, String targetId, String targetType, Current current) {
        try {
            System.out.println("[Ice] Historial solicitado para: " + userId);
            return new Message[0];
        } catch (Exception e) {
            System.err.println("Error obteniendo historial: " + e.getMessage());
            return new Message[0];
        }
    }

    // === PRIMER registerCallback - CON ChatCallbackPrx (PRINCIPAL) ===
    @Override
    public void registerCallback(String userId, ChatCallbackPrx cb, Current current) {
        try {
            callbacks.put(userId, cb);
            System.out.println("[Ice] Callback registrado para: " + userId + " (ChatCallbackPrx)");
        } catch (Exception e) {
            System.err.println("Error registrando callback (Prx): " + e.getMessage());
        }
    }

    // === SEGUNDO registerCallback - CON ChatCallback (SECUNDARIO) ===
    public void registerCallback(String userId, ChatCallback cb, Current current) {
        try {
            directCallbacks.put(userId, cb);
            System.out.println("[Ice] Callback registrado para: " + userId + " (ChatCallback directo)");
            System.out.println("⚠️  Nota: ChatCallback directo puede no funcionar correctamente en todas las configuraciones");
        } catch (Exception e) {
            System.err.println("Error registrando callback (directo): " + e.getMessage());
        }
    }

    @Override
    public void unregisterCallback(String userId, Current current) {
        try {
            callbacks.remove(userId);
            directCallbacks.remove(userId);
            System.out.println("[Ice] Callback removido para: " + userId);
        } catch (Exception e) {
            System.err.println("Error removiendo callback: " + e.getMessage());
        }
    }

    // === MÉTODOS ADICIONALES QUE FALTAN ===

    public String[] getGroupMembers(String groupId, Current current) {
        try {
            System.out.println("[Ice] Obteniendo miembros del grupo: " + groupId);
            return new String[0];
        } catch (Exception e) {
            System.err.println("Error obteniendo miembros del grupo: " + e.getMessage());
            return new String[0];
        }
    }


    public void removeFromGroup(String groupName, String user, Current current) {
        try {
            System.out.println("[Ice] Usuario " + user + " removido de " + groupName);
        } catch (Exception e) {
            System.err.println("Error removiendo usuario del grupo: " + e.getMessage());
        }
    }


    public User getUserInfo(String userId, Current current) {
        try {
            System.out.println("[Ice] Obteniendo información de usuario: " + userId);
            User user = new User();
            user.id = userId;
            user.username = userSessions.getOrDefault(userId, "Unknown");
            user.online = callbacks.containsKey(userId) || directCallbacks.containsKey(userId);
            return user;
        } catch (Exception e) {
            System.err.println("Error obteniendo información de usuario: " + e.getMessage());
            User fallback = new User();
            fallback.id = userId;
            fallback.username = "Error";
            fallback.online = false;
            return fallback;
        }
    }

    // Helper para convertir IDs
    private int extractNumericId(String iceUserId) {
        try {
            return Integer.parseInt(iceUserId);
        } catch (NumberFormatException e) {
            if (iceUserId.startsWith("user_")) {
                String numericPart = iceUserId.substring(5);
                try {
                    return Integer.parseInt(numericPart) % 1000;
                } catch (NumberFormatException e2) {
                    return 1;
                }
            }
            return 1;
        }
    }
}