package com.tp3.crawler;

import io.github.cdimascio.dotenv.Dotenv;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.Locale;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Crawler de Criptomoedas - Step 1
 * Faz web scraping do CoinGecko, gera CSV e faz upload para Supabase Storage.
 */
public class Crawler {
    private static final Logger logger = LoggerFactory.getLogger(Crawler.class);
    
    // DecimalFormat com locale US para garantir ponto decimal
    private static final DecimalFormat decimalFormat;
    static {
        DecimalFormatSymbols symbols = new DecimalFormatSymbols(Locale.US);
        decimalFormat = new DecimalFormat("#.00", symbols);
    }
    
    // Configurações
    private static String supabaseUrl;
    private static String supabaseServiceRoleKey;
    private static String bucketName;
    private static int crawlerInterval;
    private static int maxCoins;
    private static final String COINGECKO_URL = "https://www.coingecko.com/?items=300";
    private static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    
    // Flag para evitar execuções simultâneas
    private static volatile boolean isRunning = false;
    
    // Padrões regex para extração
    private static final Pattern SYMBOL_PATTERN_1 = Pattern.compile("[a-z]([A-Z]{2,5})$");
    private static final Pattern SYMBOL_PATTERN_2 = Pattern.compile("([A-Z]{2,5})$");
    
    /**
     * Carrega variáveis de ambiente do arquivo .env
     */
    private static void loadEnvironmentVariables() {
        Dotenv dotenv = null;
        
        // Obter diretório de trabalho atual
        String currentDir = System.getProperty("user.dir");
        Path currentDirPath = Paths.get(currentDir);
        
        // Tentar diferentes locais para o .env
        Path[] envPaths = {
            currentDirPath.resolve(".env"),                    // Diretório atual
            currentDirPath.resolve("..").resolve(".env"),      // Um nível acima
            currentDirPath.resolve("../..").resolve(".env"),  // Dois níveis acima
            currentDirPath.resolve("../../..").resolve(".env") // Três níveis acima (raiz do projeto)
        };
        
        for (Path envPath : envPaths) {
            if (Files.exists(envPath)) {
                try {
                    dotenv = Dotenv.configure()
                            .directory(envPath.getParent().toString())
                            .filename(".env")
                            .load();
                    logger.debug("Carregado .env de: {}", envPath);
                    break;
                } catch (Exception e) {
                    logger.debug("Erro ao carregar .env de {}: {}", envPath, e.getMessage());
                }
            }
        }
        
        // Fallback: tentar carregar do diretório atual (ignorar se não existir)
        if (dotenv == null) {
            dotenv = Dotenv.configure()
                    .ignoreIfMissing()
                    .load();
        }
        
        // Carregar variáveis (com fallback para variáveis do sistema)
        supabaseUrl = dotenv != null && dotenv.get("SUPABASE_URL") != null 
                ? dotenv.get("SUPABASE_URL") 
                : System.getenv("SUPABASE_URL");
        supabaseServiceRoleKey = dotenv != null && dotenv.get("SUPABASE_SERVICE_ROLE_KEY") != null
                ? dotenv.get("SUPABASE_SERVICE_ROLE_KEY")
                : System.getenv("SUPABASE_SERVICE_ROLE_KEY");
        bucketName = dotenv != null && dotenv.get("BUCKET_NAME") != null
                ? dotenv.get("BUCKET_NAME", "tp3-csv")
                : System.getenv().getOrDefault("BUCKET_NAME", "tp3-csv");
        crawlerInterval = Integer.parseInt(
                dotenv != null && dotenv.get("CRAWLER_INTERVAL") != null
                        ? dotenv.get("CRAWLER_INTERVAL", "120")
                        : System.getenv().getOrDefault("CRAWLER_INTERVAL", "120"));
        maxCoins = Integer.parseInt(
                dotenv != null && dotenv.get("MAX_COINS") != null
                        ? dotenv.get("MAX_COINS", "100")
                        : System.getenv().getOrDefault("MAX_COINS", "100"));
    }
    
    /**
     * Faz web scraping do CoinGecko para extrair criptomoedas da primeira página.
     * 
     * @return Lista de mapas com dados das criptomoedas (symbol, source_price, change_24h)
     */
    private static List<Map<String, String>> scrapeCoinGecko() {
        int maxRetries = 3;
        int retryDelay = 5000; // 5 segundos
        
        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 1) {
                    logger.info("Tentativa {}/{} de fazer requisicao para {}", attempt, maxRetries, COINGECKO_URL);
                    Thread.sleep(retryDelay);
                } else {
                    logger.info("Fazendo requisicao para {}", COINGECKO_URL);
                }
                
                // Headers completos para parecer um browser real e evitar bloqueio 403
                Document doc = Jsoup.connect(COINGECKO_URL)
                        .userAgent(USER_AGENT)
                        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
                        .header("Accept-Language", "en-US,en;q=0.5")
                        .timeout(30000)
                        .get();
                
                List<Map<String, String>> cryptoData = new ArrayList<>();
                Set<String> seenSymbols = new HashSet<>();
            
                // Método 1: Procurar pela tabela principal
                Element table = doc.selectFirst("table");
                Elements rows;
                
                if (table == null) {
                    Element tbody = doc.selectFirst("tbody");
                    if (tbody != null) {
                        rows = tbody.select("tr");
                    } else {
                        rows = doc.select("tbody tr");
                    }
                } else {
                    rows = table.select("tr");
                }
                
                // Processar linhas da tabela
                for (Element row : rows) {
                    if (cryptoData.size() >= maxCoins) {
                        break;
                    }
                    
                    try {
                        Elements cells = row.select("td");
                        if (cells.size() < 5) {
                            continue;
                        }
                        
                        // Extrair símbolo
                        String symbol = extractSymbol(cells);
                        
                        // Extrair preço
                        Double price = extractPrice(cells);
                        
                        // Extrair mudança 24h
                        Double change24h = extractChange24h(cells);
                        
                        // Validar e adicionar
                        if (symbol != null && price != null && change24h != null) {
                            if (symbol.length() >= 2 && symbol.length() <= 5 && !seenSymbols.contains(symbol)) {
                                Map<String, String> crypto = new HashMap<>();
                                crypto.put("symbol", symbol);
                                crypto.put("source_price", decimalFormat.format(price));
                                crypto.put("change_24h", decimalFormat.format(change24h));
                                cryptoData.add(crypto);
                                seenSymbols.add(symbol);
                                logger.debug("Extraido: {} - ${} - {}%", symbol, price, change24h);
                            }
                        }
                    } catch (Exception e) {
                        logger.debug("Erro ao processar linha da tabela: {}", e.getMessage());
                        continue;
                    }
                }
            
                // Método 2: Tentar seletores alternativos
                if (cryptoData.size() < maxCoins) {
                    logger.info("Metodo 1 encontrou {} moedas. Tentando seletores alternativos...", cryptoData.size());
                    
                    String[] selectors = {
                        "table tbody tr",
                        "[data-target='coins-table'] tbody tr",
                        ".table tbody tr",
                        "tbody tr[data-coin-id]"
                    };
                    
                    for (String selector : selectors) {
                        if (cryptoData.size() >= maxCoins) {
                            break;
                        }
                        
                        try {
                            Elements altRows = doc.select(selector);
                            if (altRows.isEmpty()) {
                                continue;
                            }
                            
                            logger.info("Encontrou {} linhas com seletor: {}", altRows.size(), selector);
                            
                            for (Element row : altRows) {
                                if (cryptoData.size() >= maxCoins) {
                                    break;
                                }
                                
                                try {
                                    Elements cells = row.select("td, th");
                                    if (cells.size() < 3) {
                                        continue;
                                    }
                                    
                                    String symbol = extractSymbol(cells);
                                    Double price = extractPrice(cells);
                                    Double change24h = extractChange24h(cells);
                                    
                                    if (symbol != null && price != null && change24h != null 
                                        && symbol.length() >= 2 && symbol.length() <= 5 
                                        && !seenSymbols.contains(symbol)) {
                                        Map<String, String> crypto = new HashMap<>();
                                        crypto.put("symbol", symbol);
                                        crypto.put("source_price", decimalFormat.format(price));
                                        crypto.put("change_24h", decimalFormat.format(change24h));
                                        cryptoData.add(crypto);
                                        seenSymbols.add(symbol);
                                    }
                                } catch (Exception e) {
                                    continue;
                                }
                            }
                        } catch (Exception e) {
                            logger.debug("Erro com seletor {}: {}", selector, e.getMessage());
                            continue;
                        }
                    }
                }
                
                if (cryptoData.size() < maxCoins) {
                    logger.warn("Apenas {} de {} criptomoedas foram extraidas. Estrutura HTML pode ter mudado.", 
                        cryptoData.size(), maxCoins);
                }
            
                logger.info("Extraidas {} criptomoedas da primeira pagina", cryptoData.size());
                
                return cryptoData.stream().limit(maxCoins).collect(Collectors.toList());
                
            } catch (IOException e) {
                String errorMsg = e.getMessage();
                boolean is403 = errorMsg != null && errorMsg.contains("403");
                
                if (attempt < maxRetries) {
                    if (is403) {
                        logger.warn("Erro 403 (Forbidden) na tentativa {}/{}. Aguardando {} segundos antes de tentar novamente...", 
                            attempt, maxRetries, retryDelay / 1000);
                    } else {
                        logger.warn("Erro ao fazer requisicao HTTP na tentativa {}/{}: {}. Aguardando {} segundos...", 
                            attempt, maxRetries, e.getMessage(), retryDelay / 1000);
                    }
                    // Continuar para próxima tentativa
                } else {
                    logger.error("Erro ao fazer requisicao HTTP apos {} tentativas: {}", maxRetries, e.getMessage());
                    if (is403) {
                        logger.error("CoinGecko esta bloqueando requisoes (403 Forbidden). Verifique se o site esta acessivel.");
                    }
                    return new ArrayList<>();
                }
            } catch (InterruptedException e) {
                logger.warn("Scraping interrompido pelo usuario");
                Thread.currentThread().interrupt();
                return new ArrayList<>();
            } catch (Exception e) {
                logger.error("Erro durante scraping: {}", e.getMessage(), e);
                return new ArrayList<>();
            }
        }
        
        return new ArrayList<>();
    }
    
    /**
     * Extrai símbolo da criptomoeda das células da tabela.
     */
    private static String extractSymbol(Elements cells) {
        if (cells.size() <= 2) {
            return null;
        }
        
        String nameCellText = cells.get(2).text().trim();
        
        // Tentar encontrar símbolo separado por espaço
        String[] parts = nameCellText.split("\\s+");
        if (parts.length > 1) {
            String lastPart = parts[parts.length - 1];
            if (lastPart.length() >= 2 && lastPart.length() <= 5 
                && lastPart.chars().allMatch(Character::isUpperCase)
                && lastPart.chars().allMatch(Character::isLetter)) {
                return lastPart;
            }
        }
        
        // Tentar padrão regex 1: [a-z]([A-Z]{2,5})$
        java.util.regex.Matcher matcher = SYMBOL_PATTERN_1.matcher(nameCellText);
        if (matcher.find()) {
            return matcher.group(1);
        }
        
        // Tentar padrão regex 2: ([A-Z]{2,5})$
        matcher = SYMBOL_PATTERN_2.matcher(nameCellText);
        if (matcher.find()) {
            String candidate = matcher.group(1);
            if (nameCellText.length() > candidate.length()) {
                char charBefore = nameCellText.charAt(nameCellText.length() - candidate.length() - 1);
                if (Character.isLowerCase(charBefore) || !Character.isLetter(charBefore)) {
                    return candidate;
                }
            }
        }
        
        return null;
    }
    
    /**
     * Extrai preço da criptomoeda das células da tabela.
     */
    private static Double extractPrice(Elements cells) {
        if (cells.size() <= 4) {
            return null;
        }
        
        String priceText = cells.get(4).text().trim();
        if (!priceText.contains("$")) {
            return null;
        }
        
        try {
            String priceClean = priceText.replace("$", "")
                    .replace(",", "")
                    .replace(" ", "")
                    .replaceAll("[^0-9.]", "");
            
            if (!priceClean.isEmpty()) {
                return Double.parseDouble(priceClean);
            }
        } catch (NumberFormatException e) {
            // Ignorar
        }
        
        return null;
    }
    
    /**
     * Extrai mudança 24h da criptomoeda das células da tabela.
     */
    private static Double extractChange24h(Elements cells) {
        // Tentar célula 6 primeiro (mudança 24h), depois célula 5 (mudança 1h)
        for (int cellIdx : new int[]{6, 5}) {
            if (cells.size() <= cellIdx) {
                continue;
            }
            
            String changeText = cells.get(cellIdx).text().trim();
            if (!changeText.contains("%")) {
                continue;
            }
            
            try {
                String changeClean = changeText.replace("%", "")
                        .replace("+", "")
                        .trim()
                        .replaceAll("[^0-9.-]", "");
                
                if (!changeClean.isEmpty()) {
                    return Double.parseDouble(changeClean);
                }
            } catch (NumberFormatException e) {
                continue;
            }
        }
        
        return null;
    }
    
    /**
     * Gera nome do ficheiro CSV com timestamp no formato YYYYMMDDTHHMMSSSSSZ (inclui milissegundos).
     */
    private static String generateCsvFilename() {
        Instant now = Instant.now();
        String timestamp = now.atZone(ZoneOffset.UTC)
                .format(DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss"));
        // Adicionar milissegundos para garantir unicidade
        long millis = now.toEpochMilli() % 1000;
        return "crypto_scrape_" + timestamp + String.format("%03d", millis) + "Z.csv";
    }
    
    /**
     * Cria ficheiro CSV com os dados das criptomoedas.
     * 
     * @param cryptoData Lista de mapas com dados das criptomoedas
     * @param filename Nome do ficheiro CSV
     * @return Caminho completo do ficheiro CSV criado
     */
    private static String createCsvFile(List<Map<String, String>> cryptoData, String filename) throws IOException {
        String timestampIso = Instant.now().atZone(ZoneOffset.UTC)
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'"));
        
        Path csvPath = Paths.get(filename);
        
        // Forçar locale US para garantir ponto decimal
        Locale.setDefault(Locale.US);
        
        try (PrintWriter writer = new PrintWriter(new FileWriter(csvPath.toFile(), false))) {
            // Escrever header
            writer.println("symbol,source_price,change_24h,timestamp");
            
            // Escrever dados - usar Locale.US para garantir ponto decimal
            for (Map<String, String> crypto : cryptoData) {
                String symbol = crypto.get("symbol");
                String sourcePrice = crypto.get("source_price");
                String change24h = crypto.get("change_24h");
                
                // Garantir que os valores já estão com ponto decimal (devem estar, mas vamos garantir)
                // Se por algum motivo ainda tiver vírgula, substituir
                if (sourcePrice != null && sourcePrice.contains(",")) {
                    sourcePrice = sourcePrice.replace(",", ".");
                }
                if (change24h != null && change24h.contains(",")) {
                    change24h = change24h.replace(",", ".");
                }
                
                // Usar String.format com Locale.US para garantir ponto decimal
                String line = String.format(Locale.US, "%s,%s,%s,%s", symbol, sourcePrice, change24h, timestampIso);
                writer.println(line);
            }
        }
        
        logger.info("CSV criado: {}", csvPath);
        return csvPath.toString();
    }
    
    /**
     * Faz upload do CSV para o Supabase Storage.
     * 
     * @param csvPath Caminho local do ficheiro CSV
     * @param filename Nome do ficheiro no bucket
     * @return true se upload foi bem-sucedido, false caso contrário
     */
    private static boolean uploadToSupabase(String csvPath, String filename) {
        try {
            if (supabaseUrl == null || supabaseServiceRoleKey == null) {
                logger.error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configurados");
                return false;
            }
            
            // Usar SupabaseStorageClient para upload
            SupabaseStorageClient storageClient = new SupabaseStorageClient(supabaseUrl, supabaseServiceRoleKey);
            String storagePath = "raw/" + filename;
            
            logger.info("Fazendo upload para {}/{}", bucketName, storagePath);
            
            byte[] csvContent = Files.readAllBytes(Paths.get(csvPath));
            boolean success = storageClient.uploadFile(bucketName, storagePath, csvContent);
            
            if (success) {
                logger.info("Upload bem-sucedido: {}", storagePath);
            } else {
                logger.error("Falha no upload: {}", storagePath);
            }
            
            return success;
            
        } catch (Exception e) {
            logger.error("Erro ao fazer upload para Supabase: {}", e.getMessage(), e);
            return false;
        }
    }
    
    /**
     * Remove ficheiro CSV local após upload.
     */
    private static void cleanupLocalFile(String csvPath) {
        try {
            Path path = Paths.get(csvPath);
            if (Files.exists(path)) {
                Files.delete(path);
                logger.info("Ficheiro local removido: {}", csvPath);
            }
        } catch (IOException e) {
            logger.warn("Erro ao remover ficheiro local: {}", e.getMessage());
        }
    }
    
    /**
     * Aplica política de retenção: mantém apenas os MAX_FILES mais recentes no bucket raw/.
     */
    private static void applyRetentionPolicy(int maxFiles) {
        try {
            if (supabaseUrl == null || supabaseServiceRoleKey == null) {
                logger.error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configurados");
                return;
            }
            
            SupabaseStorageClient storageClient = new SupabaseStorageClient(supabaseUrl, supabaseServiceRoleKey);
            List<FileInfo> csvFiles = storageClient.listFiles(bucketName, "raw");
            
            // Filtrar apenas CSVs
            csvFiles = csvFiles.stream()
                    .filter(f -> f.getName().endsWith(".csv"))
                    .collect(Collectors.toList());
            
            if (csvFiles.size() <= maxFiles) {
                logger.debug("Retencao: {} ficheiros no bucket (limite: {}). Nenhuma acao necessaria.", 
                    csvFiles.size(), maxFiles);
                return;
            }
            
            // Ordenar por timestamp (mais antigo primeiro)
            csvFiles.sort(Comparator.comparing(FileInfo::getTimestamp));
            
            // Calcular quantos ficheiros apagar
            int filesToDelete = csvFiles.size() - maxFiles;
            int deletedCount = 0;
            
            for (int i = 0; i < filesToDelete; i++) {
                FileInfo fileInfo = csvFiles.get(i);
                String filePath = "raw/" + fileInfo.getName();
                
                if (storageClient.deleteFile(bucketName, filePath)) {
                    deletedCount++;
                    logger.debug("Apagado: {}", filePath);
                } else {
                    logger.warn("Erro ao apagar: {}", filePath);
                }
            }
            
            if (deletedCount > 0) {
                logger.info("Retencao: deletados {} ficheiros antigos de raw/", deletedCount);
            }
            
        } catch (Exception e) {
            logger.warn("Erro ao aplicar politica de retencao: {}", e.getMessage());
        }
    }
    
    /**
     * Helper para repetir string (Java não tem String.repeat() antes do Java 11)
     */
    private static String repeat(String str, int count) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < count; i++) {
            sb.append(str);
        }
        return sb.toString();
    }
    
    /**
     * Executa uma iteração do crawler: scraping, geração CSV e upload.
     */
    private static void runCrawler() {
        // Verificar se já está em execução
        if (isRunning) {
            logger.warn("Crawler ja esta em execucao. Pulando esta iteracao.");
            return;
        }
        
        isRunning = true;
        String runId = String.valueOf(System.currentTimeMillis());
        logger.info(repeat("=", 60));
        logger.info("Iniciando crawler de criptomoedas [Run ID: {}]", runId);
        logger.info(repeat("=", 60));
        
        try {
            // 1. Fazer scraping
            List<Map<String, String>> cryptoData = scrapeCoinGecko();
            
            if (cryptoData.isEmpty()) {
                logger.error("Nenhum dado foi extraido. Pulando esta iteracao.");
                return;
            }
            
            logger.info("Extraidas {} criptomoedas", cryptoData.size());
            for (Map<String, String> crypto : cryptoData) {
                logger.info("  - {}: ${} ({}%)", 
                    crypto.get("symbol"), 
                    crypto.get("source_price"), 
                    crypto.get("change_24h"));
            }
            
            // 2. Gerar CSV
            try {
                String csvFilename = generateCsvFilename();
                logger.info("Gerando CSV: {}", csvFilename);
                String csvPath = createCsvFile(cryptoData, csvFilename);
                logger.info("CSV criado localmente: {}", csvPath);
                
                // 3. Upload para Supabase
                logger.info("Iniciando upload para Supabase...");
                if (uploadToSupabase(csvPath, csvFilename)) {
                    // 4. Aplicar política de retenção
                    applyRetentionPolicy(10);
                    
                    // 5. Limpar ficheiro local
                    cleanupLocalFile(csvPath);
                    logger.info("Iteracao do crawler concluida com sucesso");
                } else {
                    logger.error("Falha no upload. Ficheiro CSV mantido localmente.");
                }
            } catch (IOException e) {
                logger.error("Erro ao criar CSV: {}", e.getMessage(), e);
            }
        } finally {
            isRunning = false;
        }
        
        logger.info(repeat("=", 60));
    }
    
    /**
     * Função principal: executa o crawler em loop com intervalo configurável.
     */
    public static void main(String[] args) {
        loadEnvironmentVariables();
        
        if (supabaseUrl == null || supabaseServiceRoleKey == null) {
            logger.error("ERRO: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem ser configurados no .env");
            return;
        }
        
        logger.info("Configuracao:");
        logger.info("  - Intervalo: {} segundos", crawlerInterval);
        logger.info("  - Maximo de moedas: {}", maxCoins);
        logger.info("  - Bucket: {}", bucketName);
        logger.info("  - URL Supabase: {}...", supabaseUrl.length() > 30 ? supabaseUrl.substring(0, 30) : supabaseUrl);
        
        try {
            while (true) {
                runCrawler();
                logger.info("Aguardando {} segundos ate proxima execucao...", crawlerInterval);
                Thread.sleep(crawlerInterval * 1000L);
            }
        } catch (InterruptedException e) {
            logger.info("Crawler interrompido pelo usuario");
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            logger.error("Erro fatal no crawler: {}", e.getMessage(), e);
            System.exit(1);
        }
    }
}
