package client;

import javax.sound.sampled.*;
import java.io.*;
import java.net.*;

public class AudioIO implements Closeable {

    private final String serverHost;
    private final int serverUdpPort;

    private final AudioFormat format = new AudioFormat(44100, 16, 1, true, true);

    private DatagramSocket socket;
    private TargetDataLine mic;
    private SourceDataLine speaker;

    public AudioIO(String serverHost, int serverUdpPort) {
        this.serverHost = serverHost;
        this.serverUdpPort = serverUdpPort;
    }

    public synchronized void open() throws LineUnavailableException, SocketException, UnknownHostException {
        if (socket != null && !socket.isClosed()) return;
        socket = new DatagramSocket();

        DataLine.Info micInfo = new DataLine.Info(TargetDataLine.class, format);
        mic = (TargetDataLine) AudioSystem.getLine(micInfo);
        mic.open(format);

        DataLine.Info spInfo = new DataLine.Info(SourceDataLine.class, format);
        speaker = (SourceDataLine) AudioSystem.getLine(spInfo);
        speaker.open(format);
    }

    /**
     * Records audio from the microphone and saves it as a .wav file.
     */
    public void recordToFile(String filename, int durationSeconds) throws IOException {
        File wavFile = new File(filename);
        try {
            mic.start();
            AudioInputStream ais = new AudioInputStream(mic);
            System.out.println("[Client] Recording... Speak now.");
            AudioSystem.write(ais, AudioFileFormat.Type.WAVE, wavFile);
            Thread.sleep(durationSeconds * 1000);
            mic.stop();
            mic.flush();
            System.out.println("[Client] Recording saved as " + filename);
        } catch (InterruptedException e) {
            System.out.println("[Client] Recording interrupted.");
        }
    }

    /**
     * Plays a .wav file through the speaker.
     */
    public void playFile(String filename) {
        try (AudioInputStream ais = AudioSystem.getAudioInputStream(new File(filename))) {
            speaker.start();
            byte[] buffer = new byte[4096];
            int bytesRead;
            while ((bytesRead = ais.read(buffer)) != -1) {
                speaker.write(buffer, 0, bytesRead);
            }
            speaker.drain();
            speaker.stop();
            System.out.println("[Client] Finished playing " + filename);
        } catch (Exception e) {
            System.out.println("[Client] Error playing file: " + e.getMessage());
        }
    }

    @Override
    public void close() {
        if (mic != null) mic.close();
        if (speaker != null) speaker.close();
        if (socket != null && !socket.isClosed()) socket.close();
    }
}
