package com.tp3.crawler;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import okhttp3.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/**
 * Cliente para interagir com Supabase Storage API.
 */
public class SupabaseStorageClient {
    private static final Logger logger = LoggerFactory.getLogger(SupabaseStorageClient.class);
    
    private final String supabaseUrl;
    private final String serviceRoleKey;
    private final OkHttpClient httpClient;
    private final Gson gson;
    
    public SupabaseStorageClient(String supabaseUrl, String serviceRoleKey) {
        this.supabaseUrl = supabaseUrl.endsWith("/") ? supabaseUrl.substring(0, supabaseUrl.length() - 1) : supabaseUrl;
        this.serviceRoleKey = serviceRoleKey;
        this.httpClient = new OkHttpClient();
        this.gson = new Gson();
    }
    
    /**
     * Faz upload de um arquivo para o Supabase Storage.
     */
    public boolean uploadFile(String bucketName, String filePath, byte[] fileContent) {
        try {
            // API do Supabase Storage: POST /storage/v1/object/{bucket}/{path}
            String url = String.format("%s/storage/v1/object/%s/%s", supabaseUrl, bucketName, filePath);
            
            // Extrair nome do arquivo do path
            String fileName = filePath.contains("/") ? filePath.substring(filePath.lastIndexOf("/") + 1) : filePath;
            
            RequestBody requestBody = new MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart("file", fileName, 
                        RequestBody.create(fileContent, MediaType.parse("text/csv")))
                    .build();
            
            Request request = new Request.Builder()
                    .url(url)
                    .post(requestBody)
                    .addHeader("Authorization", "Bearer " + serviceRoleKey)
                    .addHeader("apikey", serviceRoleKey)
                    .addHeader("x-upsert", "true") // Para substituir se já existir
                    .addHeader("Content-Type", "multipart/form-data")
                    .build();
            
            try (Response response = httpClient.newCall(request).execute()) {
                if (response.isSuccessful()) {
                    return true;
                } else {
                    String errorBody = response.body() != null ? response.body().string() : "";
                    logger.error("Erro no upload: HTTP {} - {}", response.code(), errorBody);
                    return false;
                }
            }
        } catch (IOException e) {
            logger.error("Erro ao fazer upload: {}", e.getMessage(), e);
            return false;
        }
    }
    
    /**
     * Lista arquivos em um bucket/prefixo.
     */
    public List<FileInfo> listFiles(String bucketName, String prefix) {
        List<FileInfo> files = new ArrayList<>();
        
        try {
            // API do Supabase Storage: POST /storage/v1/object/list/{bucket}
            String url = String.format("%s/storage/v1/object/list/%s", supabaseUrl, bucketName);
            
            // Criar JSON body para a requisicao
            JsonObject jsonBody = new JsonObject();
            jsonBody.addProperty("prefix", prefix);
            jsonBody.addProperty("limit", 1000);
            // sortBy deve ser um objeto, nao uma string
            JsonObject sortByObj = new JsonObject();
            sortByObj.addProperty("column", "created_at");
            sortByObj.addProperty("order", "asc");
            jsonBody.add("sortBy", sortByObj);
            
            RequestBody requestBody = RequestBody.create(
                    jsonBody.toString(), 
                    MediaType.parse("application/json")
            );
            
            Request request = new Request.Builder()
                    .url(url)
                    .post(requestBody)
                    .addHeader("Authorization", "Bearer " + serviceRoleKey)
                    .addHeader("apikey", serviceRoleKey)
                    .addHeader("Content-Type", "application/json")
                    .build();
            
            try (Response response = httpClient.newCall(request).execute()) {
                if (response.isSuccessful() && response.body() != null) {
                    String responseBody = response.body().string();
                    
                    // A resposta pode ser um array ou um objeto com uma propriedade
                    if (responseBody.trim().startsWith("[")) {
                        JsonArray jsonArray = gson.fromJson(responseBody, JsonArray.class);
                        
                        for (int i = 0; i < jsonArray.size(); i++) {
                            JsonObject fileObj = jsonArray.get(i).getAsJsonObject();
                            String name = fileObj.has("name") ? fileObj.get("name").getAsString() : null;
                            String createdAt = fileObj.has("created_at") ? fileObj.get("created_at").getAsString() : null;
                            
                            if (name != null) {
                                long timestamp = parseTimestamp(createdAt, name);
                                files.add(new FileInfo(name, timestamp));
                            }
                        }
                    } else {
                        // Tentar como objeto
                        JsonObject jsonObj = gson.fromJson(responseBody, JsonObject.class);
                        if (jsonObj.has("data")) {
                            JsonArray jsonArray = jsonObj.getAsJsonArray("data");
                            for (int i = 0; i < jsonArray.size(); i++) {
                                JsonObject fileObj = jsonArray.get(i).getAsJsonObject();
                                String name = fileObj.has("name") ? fileObj.get("name").getAsString() : null;
                                String createdAt = fileObj.has("created_at") ? fileObj.get("created_at").getAsString() : null;
                                
                                if (name != null) {
                                    long timestamp = parseTimestamp(createdAt, name);
                                    files.add(new FileInfo(name, timestamp));
                                }
                            }
                        }
                    }
                } else {
                    String errorBody = response.body() != null ? response.body().string() : "";
                    logger.warn("Erro ao listar arquivos: HTTP {} - {}", response.code(), errorBody);
                }
            }
        } catch (IOException e) {
            logger.error("Erro ao listar arquivos: {}", e.getMessage(), e);
        }
        
        return files;
    }
    
    /**
     * Deleta um arquivo do bucket.
     */
    public boolean deleteFile(String bucketName, String filePath) {
        try {
            String url = String.format("%s/storage/v1/object/%s/%s", supabaseUrl, bucketName, filePath);
            
            Request request = new Request.Builder()
                    .url(url)
                    .delete()
                    .addHeader("Authorization", "Bearer " + serviceRoleKey)
                    .addHeader("apikey", serviceRoleKey)
                    .build();
            
            try (Response response = httpClient.newCall(request).execute()) {
                return response.isSuccessful();
            }
        } catch (IOException e) {
            logger.error("Erro ao deletar arquivo: {}", e.getMessage(), e);
            return false;
        }
    }
    
    /**
     * Parse timestamp do arquivo (do created_at ou do nome do arquivo).
     */
    private long parseTimestamp(String createdAt, String fileName) {
        // Tentar usar created_at primeiro
        if (createdAt != null && !createdAt.isEmpty()) {
            try {
                return Instant.parse(createdAt.replace("Z", "+00:00")).getEpochSecond();
            } catch (Exception e) {
                // Ignorar e tentar do nome
            }
        }
        
        // Fallback: extrair do nome do arquivo
        // Formato: crypto_scrape_YYYYMMDDTHHMMSSZ.csv
        if (fileName.contains("crypto_scrape_")) {
            try {
                String timestampStr = fileName.replace("crypto_scrape_", "").replace(".csv", "");
                Instant instant = Instant.from(DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'")
                        .withZone(java.time.ZoneOffset.UTC)
                        .parse(timestampStr));
                return instant.getEpochSecond();
            } catch (Exception e) {
                // Ignorar
            }
        }
        
        return 0;
    }
}
