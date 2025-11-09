package client;

import client.util.AudioConstants;

import java.io.*;
import java.net.*;
import java.util.Scanner;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.sound.sampled.*;

import static java.lang.System.out;

public class ChatClient implements Closeable {

    private final String host;
    private final int tcpPort;
    private final int udpPort;
    private Socket socket;
    private BufferedReader reader;
    private BufferedWriter writer;
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private boolean recording = false;

    private volatile boolean callActive = false;
    private Thread callSendThread;
    private Thread callRecvThread;
    
    private Listener listener;

    public ChatClient(String host, int tcpPort, int udpPort) {
        this.host = host;
        this.tcpPort = tcpPort;
        this.udpPort = udpPort;
    }

    public void connect() throws IOException {
        out.println("Conectando a " + host + ":" + tcpPort + " ...");
        Socket s = new Socket();
        try {
            s.connect(new InetSocketAddress(host, tcpPort), 5000);
        } catch (SocketTimeoutException e) {
            throw new IOException("Tiempo de espera agotado al conectar con " + host + ":" + tcpPort + ". Verifica que el servidor esté encendido y que el firewall permita el puerto " + tcpPort + ".", e);
        } catch (ConnectException e) {
            throw new IOException("No se pudo establecer conexión con " + host + ":" + tcpPort + " (" + e.getMessage() + "). Asegúrate de usar la IP correcta y que el servidor esté ejecutándose.", e);
        }
        this.socket = s;
        this.reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
        this.writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream()));
        exec.submit(this::readLoop);
        out.println("Conexión TCP establecida.");
    }

    private void readLoop() {
        try {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith("INCOMING_VOICENOTE:")) {
                    String[] parts = line.split(":", 3);
                    String from = parts.length > 1 ? parts[1] : "?";
                    String filename = parts.length > 2 ? parts[2] : ("voice_" + System.currentTimeMillis() + ".wav");
                    String lenLine = reader.readLine();
                    int length = Integer.parseInt(lenLine);
                    byte[] data = readBytesFromSocket(length);
                    File downloads = new File("downloads");
                    downloads.mkdirs();
                    File file = new File(downloads, filename);
                    try (FileOutputStream fos = new FileOutputStream(file)) { fos.write(data); }
                    out.println("[Nota de voz de " + from + "] Guardada en: " + file.getAbsolutePath());
                    playReceivedVoiceNote(data);
                    continue;
                }
                if (listener != null) listener.onMessage(line);
                out.println(line); // mostrar mensajes recibidos
            }
        } catch (IOException ignored) {}
    }

    private byte[] readBytesFromSocket(int length) throws IOException {
        InputStream in = socket.getInputStream();
        byte[] data = new byte[length];
        int bytesRead = 0;
        while (bytesRead < length) {
            int r = in.read(data, bytesRead, length - bytesRead);
            if (r == -1) break;
            bytesRead += r;
        }
        return data;
    }

    private void playReceivedVoiceNote(byte[] wavData) {
        try {
            System.out.println("Intentando reproducir nota de voz recibida...");

            try (AudioInputStream audioInputStream = AudioSystem.getAudioInputStream(new ByteArrayInputStream(wavData))) {

                AudioFormat format = audioInputStream.getFormat();
                DataLine.Info info = new DataLine.Info(SourceDataLine.class, format);

                if (!AudioSystem.isLineSupported(info)) {
                    System.err.println("[Error] El sistema no soporta la reproducción de este formato de audio: " + format);
                    return;
                }

                try (SourceDataLine line = (SourceDataLine) AudioSystem.getLine(info)) {
                    line.open(format);
                    line.start();

                    byte[] buffer = new byte[4096];
                    int bytesRead;

                    while ((bytesRead = audioInputStream.read(buffer)) != -1) {
                        line.write(buffer, 0, bytesRead);
                    }

                    line.drain();
                    System.out.println(" Reproducción finalizada.");
                }
            }
        } catch (UnsupportedAudioFileException e) {
            System.err.println("[Error] El archivo de audio recibido no es un formato soportado: " + e.getMessage());
        } catch (LineUnavailableException e) {
            System.err.println("[Error] La línea de audio (altavoz) no está disponible: " + e.getMessage());
        } catch (IOException e) {
            System.err.println("[Error] Ocurrió un error de E/S al reproducir el audio: " + e.getMessage());
        }
    }

    private synchronized void sendLine(String line) throws IOException {
        writer.write(line);
        writer.newLine();
        writer.flush();
    }

    @Override
    public void close() throws IOException {
        try { if (socket != null) socket.close(); }
        finally { exec.shutdownNow(); }
    }

    public void runMenu() throws IOException {
        Scanner sc = new Scanner(System.in);
        boolean running = true;

        while (running) {
            out.println("\n--- MENU ---");
            out.println("1. Enviar mensaje a usuario");
            out.println("2. Enviar mensaje a grupo");
            out.println("3. Crear grupo");
            out.println("4. Unirse a grupo");
            out.println("5. Enviar nota de voz a usuario (Presiona Enter para detener y enviar");
            out.println("6. Enviar nota de voz a grupo (Presiona Enter para detener y enviar)");
            out.println("7. Iniciar/Detener llamada");
            out.println("8. Salir");
            out.print("Seleccione una opcion: ");
            String option = sc.nextLine().trim();

            switch (option) {
                case "1": // mensaje a usuario
                    out.print("ID del usuario: ");
                    String userId = sc.nextLine().trim();
                    out.print("Mensaje: ");
                    String msgUser = sc.nextLine().trim();
                    sendLine("/msg " + userId + " " + msgUser);
                    break;

                case "2": // mensaje a grupo
                    out.print("Nombre del grupo: ");
                    String group = sc.nextLine().trim();
                    out.print("Mensaje: ");
                    String msgGroup = sc.nextLine().trim();
                    sendLine("/msgGroup " + group + " " + msgGroup);
                    break;

                case "3": // crear grupo
                    out.print("Nombre del grupo a crear: ");
                    String newGroup = sc.nextLine().trim();
                    sendLine("/createGroup " + newGroup);
                    break;

                case "4": // unirse a grupo
                    out.print("Nombre del grupo: ");
                    String joinGroup = sc.nextLine().trim();
                    sendLine("/joinGroup " + joinGroup);
                    break;

                case "5": // nota de voz a usuario
                    out.print("ID del usuario: ");
                    String voiceUser = sc.nextLine().trim();
                    recordAndSendVoiceNote(sc, "user", voiceUser);
                    break;

                case "6": // nota de voz a grupo
                    out.print("Nombre del grupo: ");
                    String voiceGroup = sc.nextLine().trim();
                    recordAndSendVoiceNote(sc, "group", voiceGroup);
                    break;

                case "7": // toggle call
                    if (callActive) {
                        stopCall();
                        out.println("Llamada detenida.");
                    } else {
                        startCall();
                        out.println("Llamada iniciada. Habla por el micrófono.");
                    }
                    break;

                case "8":
                    sendLine("BYE");
                    running = false;
                    break;

                default:
                    out.println("Opción inválida.");
            }
        }
    }

    private void recordAndSendVoiceNote(Scanner sc, String type, String target) {

        AudioFormat format = AudioConstants.getAudioFormat();
        DataLine.Info info = new DataLine.Info(TargetDataLine.class, format);

        TargetDataLine microphone = null;
        try {
            if (!AudioSystem.isLineSupported(info)) {
                // Intentar con 44.1 kHz si 16 kHz no está soportado por el driver
                AudioFormat alt = new AudioFormat(44100f, 16, 1, true, false);
                DataLine.Info altInfo = new DataLine.Info(TargetDataLine.class, alt);
                if (AudioSystem.isLineSupported(altInfo)) {
                    format = alt;
                    info = altInfo;
                } else {
                    out.println("[Audio] El formato del micrófono no es soportado. Dispositivos disponibles:");
                    for (Mixer.Info mi : AudioSystem.getMixerInfo()) {
                        Mixer m = AudioSystem.getMixer(mi);
                        if (m.isLineSupported(info)) {
                            out.println("  - " + mi.getName() + " (soporta TargetDataLine)");
                        } else {
                            out.println("  - " + mi.getName());
                        }
                    }
                    return;
                }
            }

            // Intentar obtener la línea de algún mixer que lo soporte si el default falla
            try {
                microphone = (TargetDataLine) AudioSystem.getLine(info);
            } catch (LineUnavailableException | IllegalArgumentException e) {
                for (Mixer.Info mi : AudioSystem.getMixerInfo()) {
                    Mixer m = AudioSystem.getMixer(mi);
                    if (m.isLineSupported(info)) {
                        try {
                            microphone = (TargetDataLine) m.getLine(info);
                            break;
                        } catch (LineUnavailableException ignored) {}
                    }
                }
                if (microphone == null) throw e;
            }

            microphone.open(format);
            microphone.start();

            out.println("🎙️ Grabando... presiona ENTER para detener.");

            final ByteArrayOutputStream byteOut = new ByteArrayOutputStream();
            recording = true;
            final byte[] buffer = new byte[4096];
            final TargetDataLine micRef = microphone;

            Thread captureThread = new Thread(() -> {
                while (recording) {
                    int bytesRead = micRef.read(buffer, 0, buffer.length);
                    if (bytesRead > 0) {
                        byteOut.write(buffer, 0, bytesRead);
                    }
                }
            }, "voice-capture");
            captureThread.start();

            // Esperar a que el usuario presione ENTER usando el mismo Scanner
            sc.nextLine();
            recording = false;
            microphone.stop();
            captureThread.join();

            // Convertir a formato WAV (PCM LE)
            byte[] audioData = byteOut.toByteArray();
            ByteArrayInputStream bais = new ByteArrayInputStream(audioData);
            AudioInputStream ais = new AudioInputStream(bais, format, audioData.length / format.getFrameSize());

            ByteArrayOutputStream wavOut = new ByteArrayOutputStream();
            AudioSystem.write(ais, AudioFileFormat.Type.WAVE, wavOut);
            byte[] wavData = wavOut.toByteArray();

            String filename = "voice_" + System.currentTimeMillis() + ".wav";

            out.println("Grabación detenida. Enviando nota de voz...");

            if (type.equals("user")) {
                sendVoiceNoteToUser(Integer.parseInt(target), filename, wavData);
                out.println("Nota de voz enviada a usuario " + target);
            } else {
                sendVoiceNoteToGroup(target, filename, wavData);
                out.println("Nota de voz enviada al grupo " + target);
            }

        } catch (Exception e) {
            out.println("[Audio] Error al grabar/enviar la nota de voz: " + e.getMessage());
        } finally {
            if (microphone != null && microphone.isOpen()) {
                microphone.close();
            }
        }
    }

    public synchronized void sendVoiceNoteToUser(int userId, String filename, byte[] data) throws IOException {
        sendLine("voicenoteUser:" + userId + ":" + filename);
        sendLine(String.valueOf(data.length));
        OutputStream out = socket.getOutputStream();
        out.write(data);
        out.flush();
    }

    private synchronized void sendVoiceNoteToGroup(String groupName, String filename, byte[] data) throws IOException {
        sendLine("voicenoteGroup:" + groupName + ":" + filename);
        sendLine(String.valueOf(data.length));
        OutputStream out = socket.getOutputStream();
        out.write(data);
        out.flush();
    }

    private void startCall() {
        if (callActive) return;
        callActive = true;
        try {
            final DatagramSocket udp = new DatagramSocket();
            final InetAddress addr = InetAddress.getByName(host);
            final AudioFormat format = new AudioFormat(16000f, 16, 1, true, false);
            DataLine.Info micInfo = new DataLine.Info(TargetDataLine.class, format);
            TargetDataLine mic = (TargetDataLine) AudioSystem.getLine(micInfo);
            mic.open(format);
            mic.start();

            DataLine.Info spInfo = new DataLine.Info(SourceDataLine.class, format);
            SourceDataLine speaker = (SourceDataLine) AudioSystem.getLine(spInfo);
            speaker.open(format);
            speaker.start();

            callSendThread = new Thread(() -> {
                byte[] buf = new byte[1024];
                while (callActive) {
                    int n = mic.read(buf, 0, buf.length);
                    if (n > 0) {
                        try {
                            DatagramPacket p = new DatagramPacket(buf, n, addr, udpPort);
                            udp.send(p);
                        } catch (IOException ignored) {}
                    }
                }
                mic.stop();
                mic.close();
            }, "call-send");

            callRecvThread = new Thread(() -> {
                byte[] buf = new byte[4096];
                while (callActive) {
                    try {
                        DatagramPacket p = new DatagramPacket(buf, buf.length);
                        udp.receive(p);
                        speaker.write(p.getData(), 0, p.getLength());
                    } catch (IOException e) {
                        if (callActive) out.println("[UDP] Error recibiendo audio: " + e.getMessage());
                    }
                }
                speaker.drain();
                speaker.stop();
                speaker.close();
                udp.close();
            }, "call-recv");

            callSendThread.start();
            callRecvThread.start();
        } catch (Exception e) {
            callActive = false;
            out.println("No se pudo iniciar la llamada: " + e.getMessage());
        }
    }

    private void stopCall() {
        if (!callActive) return;
        callActive = false;
        try {
            if (callSendThread != null) callSendThread.join(300);
            if (callRecvThread != null) callRecvThread.join(300);
        } catch (InterruptedException ignored) {}
    }
    
}
