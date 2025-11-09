package server;

import java.io.Closeable;
import java.io.IOException;
import java.net.*;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * UDPRelay listens for incoming audio datagrams from either client and forwards
 * them to the other client. It learns endpoints from the packet sources.
 */
public class UDPRelay implements Closeable {

    private final int port;
    private DatagramSocket socket;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private final Set<SocketAddress> endpoints = ConcurrentHashMap.newKeySet();

    public UDPRelay(int port) {
        this.port = port;
    }

    public int getPort() { return port; }

    public void start() throws SocketException {
        socket = new DatagramSocket(port);
        executor.submit(this::loop);
        System.out.println("[Server] UDP relay listening on port " + port);
    }

    private void loop() {
        byte[] buf = new byte[10240];
        while (!socket.isClosed()) {
            try {
                DatagramPacket packet = new DatagramPacket(buf, buf.length);
                socket.receive(packet);

                SocketAddress src = packet.getSocketAddress();
                if (endpoints.add(src)) {
                    System.out.println("[UDPRelay] Learned endpoint " + src);
                }

                // broadcast to all other endpoints
                for (SocketAddress dst : endpoints) {
                    if (!dst.equals(src)) {
                        DatagramPacket out = new DatagramPacket(packet.getData(), packet.getLength());
                        out.setSocketAddress(dst);
                        socket.send(out);
                    }
                }
            } catch (IOException e) {
                if (!socket.isClosed()) {
                    System.err.println("[UDPRelay] Error: " + e.getMessage());
                }
            }
        }
    }

    @Override
    public void close() {
        if (socket != null && !socket.isClosed()) socket.close();
        executor.shutdownNow();
    }
}
