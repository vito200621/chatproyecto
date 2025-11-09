package server;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.SimpleDateFormat;
import java.util.Date;

public class HistoryService {

    private final File baseDir;
    private final SimpleDateFormat ts = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

    public HistoryService(File baseDir) {
        this.baseDir = baseDir;
        if (!baseDir.exists()) baseDir.mkdirs();
    }

    public void logPrivateText(int fromId, int toId, String message) {
        String conv = "user-" + Math.min(fromId, toId) + "_" + Math.max(fromId, toId);
        File f = new File(baseDir, conv + ".log");
        appendLine(f, fmt(fromId) + " -> " + fmt(toId) + " | " + message);
    }

    public void logGroupText(String groupName, int fromId, String message) {
        File f = new File(baseDir, "group-" + groupName + ".log");
        appendLine(f, fmt(fromId) + " @" + groupName + " | " + message);
    }

    public void logPrivateVoice(int fromId, int toId, String filename, byte[] data) {
        String conv = "user-" + Math.min(fromId, toId) + "_" + Math.max(fromId, toId);
        File dir = new File(baseDir, conv + "_voice");
        dir.mkdirs();
        saveVoice(dir, fromId, toId, filename, data);
        File f = new File(baseDir, conv + ".log");
        appendLine(f, fmt(fromId) + " -> " + fmt(toId) + " | [voice] " + filename);
    }

    public void logGroupVoice(String groupName, int fromId, String filename, byte[] data) {
        File dir = new File(baseDir, "group-" + groupName + "_voice");
        dir.mkdirs();
        saveVoice(dir, fromId, -1, filename, data);
        File f = new File(baseDir, "group-" + groupName + ".log");
        appendLine(f, fmt(fromId) + " @" + groupName + " | [voice] " + filename);
    }

    private void saveVoice(File dir, int fromId, int toId, String filename, byte[] data) {
        File out = new File(dir, filename);
        try (FileOutputStream fos = new FileOutputStream(out)) {
            fos.write(data);
        } catch (IOException ignored) {}
    }

    private void appendLine(File file, String line) {
        try {
            Path path = file.toPath();
            try (BufferedWriter bw = Files.newBufferedWriter(path,
                    StandardCharsets.UTF_8,
                    java.nio.file.StandardOpenOption.CREATE,
                    java.nio.file.StandardOpenOption.APPEND)) {
                bw.write("[" + ts.format(new Date()) + "] " + line);
                bw.newLine();
            }
        } catch (IOException ignored) {}
    }

    private String fmt(int id) { return "user-" + id; }
}
