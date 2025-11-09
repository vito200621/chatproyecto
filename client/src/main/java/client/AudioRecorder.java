package client;

import javax.sound.sampled.*;
import java.io.*;

public class AudioRecorder {

    public static byte[] recordAudioUntilEnter() throws IOException, LineUnavailableException {
        AudioFormat format = new AudioFormat(16000, 16, 1, true, true);
        DataLine.Info info = new DataLine.Info(TargetDataLine.class, format);

        if (!AudioSystem.isLineSupported(info)) {
            throw new LineUnavailableException("Microphone not supported");
        }

        TargetDataLine microphone = (TargetDataLine) AudioSystem.getLine(info);
        microphone.open(format);
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        System.out.println(" Recording... Press ENTER to stop.");
        microphone.start();

        Thread captureThread = new Thread(() -> {
            byte[] buffer = new byte[4096];
            while (!Thread.currentThread().isInterrupted()) {
                int bytesRead = microphone.read(buffer, 0, buffer.length);
                if (bytesRead > 0) {
                    out.write(buffer, 0, bytesRead);
                }
            }
        });

        captureThread.start();
        System.in.read(); // espera ENTER
        captureThread.interrupt();
        microphone.stop();
        microphone.close();
        System.out.println(" Recording stopped.");

        return out.toByteArray();
    }
}
