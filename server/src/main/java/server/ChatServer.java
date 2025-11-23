package server;

import java.io.IOException;
import java.net.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;

public class ChatServer implements AutoCloseable {

    private final Map<Integer, ClientHandler> clients = new ConcurrentHashMap<>();
    private final Map<String, List<ClientHandler>> groups = new HashMap<>();
    private final int tcpPort;
    private final int udpPort;
    private final ExecutorService pool;
    private final Semaphore messageSemaphore;
    private ServerSocket serverSocket;

    private final HistoryService history = new HistoryService(new java.io.File("history"));

    private final UDPRelay udpRelay;

    public ChatServer(int tcpPort, int udpPort, int poolSize) {
        this.tcpPort = tcpPort;
        this.udpPort = udpPort;
        this.pool = Executors.newFixedThreadPool(poolSize);
        this.messageSemaphore = new Semaphore(1, true); // fair semaphore
        this.udpRelay = new UDPRelay(udpPort);
    }

    public void start() throws IOException {
        udpRelay.start();
        serverSocket = new ServerSocket(tcpPort);
        // Mostrar IPs locales para facilitar conexión desde otra PC
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            List<String> ips = new ArrayList<>();
            while (ifaces.hasMoreElements()) {
                NetworkInterface ni = ifaces.nextElement();
                if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) {
                        ips.add(a.getHostAddress());
                    }
                }
            }
            if (!ips.isEmpty()) {
                System.out.println("[Servidor] IPs locales: " + String.join(", ", ips) + " (usa una desde otro PC)");
            }
        } catch (Exception ignored) {}

        System.out.println("[Servidor] TCP escuchando en el puerto " + tcpPort + ", UDP escuchando en el puerto " + udpPort);
        System.out.println("[Servidor] Si otro equipo no conecta: verifica el firewall y abre TCP " + tcpPort + " y UDP " + udpPort + ".");

        int nextId = 1;

        while (!serverSocket.isClosed()) {
            Socket socket = serverSocket.accept();
            final int clientId = nextId++;
            ClientHandler handler = new ClientHandler(clientId, socket, this);
            clients.put(clientId, handler);
            pool.submit(handler);
            System.out.println("[Servidor] Cliente " + clientId + " conectado: " + socket.getRemoteSocketAddress());
        }
    }

    void onClientMessage(int fromId, String message) {
        try {
            messageSemaphore.acquire();
            int toId = fromId == 1 ? 2 : 1;
            ClientHandler other = clients.get(toId);
            if (other != null) {
                other.send("[Usuario " + fromId + "]: " + message);
            } else {
                ClientHandler self = clients.get(fromId);
                if (self != null) self.send("[Servidor]: El otro usuario no está conectado aún.");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            messageSemaphore.release();
        }
    }

    void onClientClose(int clientId) {
        clients.remove(clientId);
        System.out.println("[Servidor] Cliente " + clientId + " desconectado.");
    }

    public UDPRelay getUdpRelay() {
        return udpRelay;
    }

    @Override
    public void close() throws IOException {
        try {
            if (serverSocket != null) serverSocket.close();
        } finally {
            pool.shutdownNow();
            udpRelay.close();
        }
    }


    public void createGroup(String groupName, ClientHandler creator) {
        if (groups.containsKey(groupName)) {
            creator.send("El grupo '" + groupName + "' ya existe.");
        } else {
            List<ClientHandler> members = new ArrayList<>();
            members.add(creator);
            groups.put(groupName, members);
            creator.send("✓ Grupo '" + groupName + "' creado exitosamente.");
            creator.send("Otros usuarios pueden unirse con: /joinGroup " + groupName);
            System.out.println("[Servidor] Grupo creado: " + groupName + " por usuario " + creator.getId());
        }
    }

    public synchronized void sendPrivateMessage(int fromId, int toId, String message) {
        ClientHandler target = clients.get(toId);
        if (target != null) {
            target.send("[Privado] de " + fromId + ": " + message);
            history.logPrivateText(fromId, toId, message);
        } else {
            ClientHandler from = clients.get(fromId);
            if (from != null) from.send("User with ID " + toId + " not found.");
        }
    }

    public synchronized void sendGroupMessage(String groupName, int fromId, String message) {
        List<ClientHandler> members = groups.get(groupName);
        if (members == null) {
            clients.get(fromId).send("Group '" + groupName + "' does not exist.");
            return;
        }
        if (members.isEmpty()) {
            clients.get(fromId).send("Group '" + groupName + "' has no members.");
            return;
        }

        history.logGroupText(groupName, fromId, message);
        for (ClientHandler member : members) {
            if (member.getId() != fromId) {
                member.send("[" + groupName + "] Usuario " + fromId + ": " + message);
            }
        }
    }

    public synchronized void addUserToGroup(String groupName, ClientHandler user) {
        List<ClientHandler> members = groups.get(groupName);
        if (members == null) {
            user.send(" El grupo '" + groupName + "' no existe.");
            return;
        }
        if (!members.contains(user)) {
            members.add(user);
            user.send(" Te has unido al grupo '" + groupName + "'.");

            // Notificar a otros miembros
            for (ClientHandler member : members) {
                if (member != user) {
                    member.send("[Sistema] El usuario " + user.getId() + " se ha unido al grupo");
                }
            }
            System.out.println("[Servidor] Usuario " + user.getId() + " se unió al grupo " + groupName);
        } else {
            user.send("ℹ Ya estás en el grupo '" + groupName + "'.");
        }
    }

    public void sendVoiceNoteToUser(String targetId, byte[] data, String filename, String fromId) {
        try {
            int target = Integer.parseInt(targetId);
            int from = Integer.parseInt(fromId);
            ClientHandler targetHandler = clients.get(target);
            if (targetHandler != null) {
                targetHandler.sendVoiceNote(filename, data, fromId);
                history.logPrivateVoice(from, target, filename, data);
                System.out.println("Nota de voz enviada de " + fromId + " a usuario " + targetId);
            } else {
                System.out.println("Usuario destino no encontrado: " + targetId);
            }
        } catch (NumberFormatException e) {
            System.out.println("ID de usuario inválido: " + targetId);
        }
    }

    public void sendVoiceNoteToGroup(int fromId, String groupName, String filename, byte[] data) {
        List<ClientHandler> groupList = groups.get(groupName);

        if (groupList == null || groupList.isEmpty()) {
            System.out.println(" Grupo no encontrado o vacío: " + groupName);
            return;
        }

        history.logGroupVoice(groupName, fromId, filename, data);
        for (ClientHandler member : groupList) {
            if (member.getId() != fromId) { // no se reenvía al emisor
                member.sendVoiceNote(filename, data, "Grupo:" + groupName + " de " + fromId);
            }
        }

        System.out.println("Nota de voz enviada al grupo " + groupName + " por usuario " + fromId);
    }

    public synchronized void listGroups(ClientHandler client) {
        if (groups.isEmpty()) {
            client.send("No hay grupos existentes. Crea uno con /createGroup <nombre>");
            return;
        }

        StringBuilder sb = new StringBuilder("--- GRUPOS DISPONIBLES ---\n");
        for (String groupName : groups.keySet()) {
            List<ClientHandler> members = groups.get(groupName);
            sb.append("- ").append(groupName)
                    .append(" (").append(members.size()).append(" miembros)\n");
        }
        sb.append("Únete con: /joinGroup <nombre>");
        client.send(sb.toString());
    }

    private ClientHandler findClientById(int clientId) {
        return clients.get(clientId);
    }


}
