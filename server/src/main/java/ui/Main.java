package ui;

import server.ChatServer;

public class Main {
    public static void main(String[] args) {
        int tcpPort = 5000;
        int udpPort = 6000;
        int poolSize = 8;
        if (args.length >= 1) tcpPort = Integer.parseInt(args[0]);
        if (args.length >= 2) udpPort = Integer.parseInt(args[1]);
        if (args.length >= 3) poolSize = Integer.parseInt(args[2]);
        try (ChatServer server = new ChatServer(tcpPort, udpPort, poolSize)) {
            server.start();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
