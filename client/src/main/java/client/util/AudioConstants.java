package client.util;

import javax.sound.sampled.AudioFormat;

public class AudioConstants {
    /**
     * Devuelve el formato de audio estándar para esta aplicación.
     * Es crucial que tanto la grabación como la reproducción usen este mismo objeto.
     * Formato: 16kHz, 16-bit, mono, signed, little-endian.
     * @return el objeto AudioFormat compartido.
     */
    public static AudioFormat getAudioFormat() {
        return new AudioFormat(16000f, 16, 1, true, false);
    }
}
