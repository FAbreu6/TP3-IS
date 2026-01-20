package com.tp3.crawler;

/**
 * Classe para representar informações de um arquivo no Supabase Storage.
 */
public class FileInfo {
    private final String name;
    private final long timestamp;
    
    public FileInfo(String name, long timestamp) {
        this.name = name;
        this.timestamp = timestamp;
    }
    
    public String getName() {
        return name;
    }
    
    public long getTimestamp() {
        return timestamp;
    }
}
