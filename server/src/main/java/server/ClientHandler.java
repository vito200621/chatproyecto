package server;

import java.io.*;
import java.net.Socket;

public class ClientHandler implements Runnable {

    private final int id;
    private final Socket socket;
    private final ChatServer server;
    private BufferedReader reader;
    private BufferedWriter writer;

    public ClientHandler(int id, Socket socket, ChatServer server) {
        this.id = id;
        this.socket = socket;
        this.server = server;
    }

    @Override
    public void run() {
        try {
            reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
            writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream()));

            send("Conectado al servidor. Tu id es " + id + ".");
            send("Audio UDP puerto servidor: " + server.getUdpRelay().getPort());

            String line;

            while ((line = reader.readLine()) != null) {
                if (line.trim().isEmpty()) continue;

                if (line.startsWith("/createGroup ")) {
                    String groupName = line.substring(13).trim();
                    if (!groupName.isEmpty()) {
                        server.createGroup(groupName, this);
                    } else {
                        send("Usage: /createGroup <groupName>");
                    }
                    continue;
                }


                if (line.startsWith("/joinGroup ")) {
                    String groupName = line.substring(11).trim();
                    server.addUserToGroup(groupName, this);
                    continue;
                }

                if (line.startsWith("/msg ")) {
                    String[] parts = line.split(" ", 3);
                    if (parts.length < 3) {
                        send("Usage: /msg <userId> <message>");
                    } else {
                        try {
                            int targetId = Integer.parseInt(parts[1]);
                            String msg = parts[2];
                            server.sendPrivateMessage(id, targetId, msg);
                        } catch (NumberFormatException e) {
                            send("Invalid user ID format.");
                        }
                    }
                    continue;
                }

                // --- Group message ---
                if (line.startsWith("/msgGroup ")) {
                    String[] parts = line.split(" ", 3);
                    if (parts.length < 3) {
                        send("Usage: /msgGroup <groupName> <message>");
                    } else {
                        String groupName = parts[1];
                        String msg = parts[2];
                        server.sendGroupMessage(groupName, id, msg);
                    }
                    continue;
                }

                if (line.startsWith("voicenoteUser:")) {
                    String[] parts = line.split(":", 3);
                    if (parts.length < 3) {
                        send("Formato inválido. Usa: voicenoteUser:<userId>:<filename>");
                        continue;
                    }
                    String targetId = parts[1];
                    String filename = parts[2];

                    // Leer el tamaño del archivo
                    String header = reader.readLine();
                    if (header == null) continue;
                    int length = Integer.parseInt(header);

                    // Leer los bytes del audio
                    byte[] data = new byte[length];
                    InputStream in = socket.getInputStream();
                    int bytesRead = 0;
                    while (bytesRead < length) {
                        int read = in.read(data, bytesRead, length - bytesRead);
                        if (read == -1) break;
                        bytesRead += read;
                    }

                    server.sendVoiceNoteToUser(targetId, data, filename, String.valueOf(id));
                    continue;
                }

                if (line.startsWith("voicenoteGroup:")) {
                    String[] parts = line.split(":", 3);
                    if (parts.length < 3) {
                        send("Formato inválido. Usa: voicenoteGroup:<groupName>:<filename>");
                        continue;
                    }

                    String groupName = parts[1];
                    String filename = parts[2];

                    String header = reader.readLine();
                    if (header == null) continue;
                    int length = Integer.parseInt(header);

                    byte[] data = new byte[length];
                    InputStream in = socket.getInputStream();
                    int bytesRead = 0;
                    while (bytesRead < length) {
                        int read = in.read(data, bytesRead, length - bytesRead);
                        if (read == -1) break;
                        bytesRead += read;
                    }

                    server.sendVoiceNoteToGroup(id, groupName, filename, data);
                    continue;
                }

            }

        } catch (IOException e) {
            // Client disconnected
        } finally {
            try {
                socket.close();
            } catch (IOException ignored) {}
            server.onClientClose(id);
        }
    }

    public synchronized void send(String msg) {
        try {
            writer.write(msg);
            writer.newLine();
            writer.flush();
        } catch (IOException ignored) {}
    }

    public int getId() {
        return id;
    }

    public synchronized void sendVoiceNote(String filename, byte[] data, String fromId) {
        try {
            writer.write("INCOMING_VOICENOTE:" + fromId + ":" + filename);
            writer.newLine();
            writer.write(String.valueOf(data.length));
            writer.newLine();
            writer.flush();
            OutputStream out = socket.getOutputStream();
            out.write(data);
            out.flush();
        } catch (IOException e) {
            System.err.println("Error sending voice note to client " + id + ": " + e.getMessage());
        }
    }

}
