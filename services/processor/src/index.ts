import * as dotenv from 'dotenv';
import { initSupabase, listFiles, downloadFile, uploadFile, FileInfo } from './supabase';
import { loadState, updateState } from './state';
import { parseCSV, saveDownloadedFile, getPreview, generateTransformedCSV, saveTransformedCSV, CSVRow, applyLocalRetention } from './csv';
import { enrichCryptoDataBatch } from './enrichment';
import { sendCSVToXMLServiceWithRetry, XMLServiceResponse } from './xmlService';
import { sendCSVToXMLServiceViaSocket, SocketResponse } from './socketClient';
import { startWebhookServer, registerPendingRequest } from './webhook';

// Import estático para evitar problemas com import dinâmico
import * as path from 'path';

// Carregar variáveis de ambiente
// Tenta primeiro na raiz do projeto, depois na pasta services/
const fs = require('fs');
const rootEnvPath = path.join(__dirname, '..', '..', '..', '.env');
const servicesEnvPath = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else if (fs.existsSync(servicesEnvPath)) {
  dotenv.config({ path: servicesEnvPath });
}
// Também carregar do ambiente (Docker) - sobrescreve arquivos
dotenv.config();

// Configurações
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET_NAME = process.env.BUCKET_NAME || 'tp3-csv';
const RAW_PREFIX = process.env.RAW_PREFIX || 'raw';
const PROCESSED_PREFIX = process.env.PROCESSED_PREFIX || 'processed';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '30', 10);
const UPLOAD_TRANSFORMED = process.env.UPLOAD_TRANSFORMED === 'true';

// XML Service Configuration
const XML_SERVICE_URL = process.env.XML_SERVICE_URL;
const XML_SERVICE_SOCKET_HOST = process.env.XML_SERVICE_SOCKET_HOST || 'xml-service';
const XML_SERVICE_SOCKET_PORT = parseInt(process.env.XML_SERVICE_SOCKET_PORT || '7000', 10);
const USE_SOCKET = process.env.USE_SOCKET === 'true'; // Usar socket TCP em vez de HTTP
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3001', 10);
const XML_SERVICE_TIMEOUT = parseInt(process.env.XML_SERVICE_TIMEOUT || '30000', 10);
const XML_SERVICE_RETRIES = parseInt(process.env.XML_SERVICE_RETRIES || '3', 10);
const ENABLE_XML_SERVICE = (XML_SERVICE_URL || XML_SERVICE_SOCKET_HOST) && WEBHOOK_URL;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

// Inicializar Supabase
initSupabase(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Encontra o ficheiro CSV mais recente baseado em updated_at/created_at ou nome
 */
function findLatestFile(files: FileInfo[]): FileInfo | null {
  if (files.length === 0) {
    return null;
  }

  // Ordenar por updated_at (mais recente primeiro), fallback para created_at, depois por nome
  const sorted = [...files].sort((a, b) => {
    // Tentar usar updated_at primeiro
    const aTime = a.updated_at || a.created_at || '';
    const bTime = b.updated_at || b.created_at || '';
    
    if (aTime && bTime) {
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    }
    
    // Fallback: ordenar por nome (que contém timestamp)
    return b.name.localeCompare(a.name);
  });

  return sorted[0];
}

/**
 * Processa um novo ficheiro CSV
 */
async function processNewFile(filename: string): Promise<void> {
  console.log(`NEW FILE DETECTED: ${filename}`);
  
  try {
    // Fazer download
    const filePath = `${RAW_PREFIX}/${filename}`;
    const fileBuffer = await downloadFile(BUCKET_NAME, filePath);
    
    // Salvar em downloads/
    const savedPath = saveDownloadedFile(filename, fileBuffer);
    console.log(`Downloaded to: ${savedPath}`);
    
    // Converter buffer para string
    const csvContent = fileBuffer.toString('utf-8');
    
    // Parse e validação
    const { headers, rows, dataRowCount } = parseCSV(csvContent);
    
    console.log(`CSV validated successfully`);
    console.log(`Headers: ${headers.join(', ')}`);
    console.log(`Data rows: ${dataRowCount}`);
    
    // Preview das primeiras 5 linhas
    const preview = getPreview(rows, 5);
    console.log('\nPreview (first 5 rows):');
    preview.forEach((row, index) => {
      console.log(
        `  ${index + 1}. ${row.symbol} | $${row.source_price} | ${row.change_24h}% | ${row.timestamp}`
      );
    });
    
    // ===== STEP 3: ENRIQUECIMENTO DE DADOS =====
    console.log('\n' + '='.repeat(60));
    console.log('STEP 3: Enriching data with external APIs...');
    console.log('='.repeat(60));
    
    const startTime = Date.now();
    
    // NÃO REMOVER DUPLICATAS - incluir TODAS as moedas do CSV
    // Extrair símbolos únicos apenas para enriquecimento (evitar chamadas duplicadas às APIs)
    const uniqueSymbolsSet = new Set<string>();
    for (const row of rows) {
      uniqueSymbolsSet.add(row.symbol);
    }
    const uniqueSymbols = Array.from(uniqueSymbolsSet);
    
    console.log(`Total rows in CSV: ${rows.length}`);
    console.log(`Unique symbols for enrichment: ${uniqueSymbols.length} (will enrich once per symbol)`);
    console.log(`Enriching ${uniqueSymbols.length} unique cryptocurrencies...`);
    
    const enrichedDataMap = await enrichCryptoDataBatch(uniqueSymbols);
    
    const enrichedCount = enrichedDataMap.size;
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\nEnrichment completed in ${elapsedTime}s`);
    console.log(`  - Total rows in CSV: ${rows.length}`);
    console.log(`  - Symbols in enrichedDataMap: ${enrichedCount} (expected: ${uniqueSymbols.length})`);
    
    // VERIFICAR se todas as moedas estão no enrichedDataMap
    const missingSymbols = uniqueSymbols.filter(s => !enrichedDataMap.has(s));
    if (missingSymbols.length > 0) {
      console.warn(`  ⚠ WARNING: ${missingSymbols.length} symbols missing from enrichedDataMap:`);
      console.warn(`     ${missingSymbols.slice(0, 10).join(', ')}${missingSymbols.length > 10 ? '...' : ''}`);
    }
    
    // Gerar CSV transformado - INCLUIR TODAS AS LINHAS (mesmo duplicadas)
    console.log('\nGenerating transformed CSV...');
    console.log(`  - Input rows: ${rows.length} (including duplicates)`);
    const transformedCSV = generateTransformedCSV(rows, enrichedDataMap);
    
    // Contar linhas no CSV transformado (excluindo header)
    const transformedLines = transformedCSV.split('\n').filter(line => line.trim().length > 0);
    const transformedRowCount = transformedLines.length - 1; // -1 para header
    console.log(`  - Transformed CSV rows (excluding header): ${transformedRowCount}`);
    
    if (transformedRowCount !== rows.length) {
      console.error(`  ✗ ERROR: Row count mismatch! Expected ${rows.length}, got ${transformedRowCount}`);
    } else {
      console.log(`  ✓ All ${rows.length} rows included in transformed CSV`);
    }
    
    // Salvar CSV transformado localmente
    const transformedPath = saveTransformedCSV(filename, transformedCSV);
    console.log(`Transformed CSV saved to: ${transformedPath}`);
    
    // Aplicar política de retenção local (manter apenas 10 ficheiros mais recentes)
    // Excluir o ficheiro recém-criado e o ficheiro raw recém-baixado da limpeza
    const baseName = filename.replace(/\.csv$/i, '');
    const transformedFilename = `transformed_${baseName}.csv`;
    applyLocalRetention(10, [filename, transformedFilename]);
    
    // Upload opcional para Supabase
    if (UPLOAD_TRANSFORMED) {
      const uploadPath = `${PROCESSED_PREFIX}/${transformedFilename}`;
      
      console.log(`Uploading transformed CSV to Supabase: ${uploadPath}...`);
      const csvBuffer = Buffer.from(transformedCSV, 'utf-8');
      await uploadFile(BUCKET_NAME, uploadPath, csvBuffer);
      console.log(`Upload completed: ${uploadPath}`);
    }
    
    // ===== ENVIO PARA XML SERVICE =====
    if (ENABLE_XML_SERVICE) {
      try {
        console.log('\n' + '='.repeat(60));
        console.log('Sending CSV to XML Service...');
        console.log('='.repeat(60));
        console.log(`USE_SOCKET: ${USE_SOCKET}`);
        console.log(`XML_SERVICE_SOCKET_HOST: ${XML_SERVICE_SOCKET_HOST}`);
        console.log(`XML_SERVICE_SOCKET_PORT: ${XML_SERVICE_SOCKET_PORT}`);
        
        let xmlServiceResult: XMLServiceResponse | SocketResponse;
        
        if (USE_SOCKET) {
          // Usar TCP Socket (NÃO-HTTP)
          console.log('🔌 Using TCP Socket (NON-HTTP) for XML Service communication...');
          xmlServiceResult = await sendCSVToXMLServiceViaSocket(
            transformedPath,
            {
              xmlServiceHost: XML_SERVICE_SOCKET_HOST!,
              xmlServicePort: XML_SERVICE_SOCKET_PORT!,
              webhookUrl: WEBHOOK_URL!,
              timeout: XML_SERVICE_TIMEOUT
            }
          );
        } else {
          // Usar HTTP (multipart/form-data)
          console.log('🌐 Using HTTP (multipart/form-data) for XML Service communication...');
          xmlServiceResult = await sendCSVToXMLServiceWithRetry(
            transformedPath,
            {
              xmlServiceUrl: XML_SERVICE_URL!,
              webhookUrl: WEBHOOK_URL!,
              timeout: XML_SERVICE_TIMEOUT,
              retries: XML_SERVICE_RETRIES
            }
          );
        }
        
        if (xmlServiceResult.success && xmlServiceResult.accepted) {
          console.log('\n✓ XML Service accepted request for processing');
          console.log(`  Request ID: ${xmlServiceResult.requestId}`);
          console.log('  Waiting for webhook notification with final status...');
          
          // Registrar requisição pendente para quando o webhook confirmar
          const rawFilename = filename;
          registerPendingRequest(xmlServiceResult.requestId, [rawFilename, transformedFilename]);
          
          console.log('  CSVs will be deleted when webhook confirms successful XML save.');
        } else {
          console.error('\n✗ XML Service did not accept the request.');
          console.error('  CSVs will NOT be deleted due to XML Service error.');
          throw new Error(xmlServiceResult.message || 'XML Service did not accept the request');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('\n✗ Error sending CSV to XML Service:', errorMessage);
        console.error('  CSVs will NOT be deleted due to XML Service error.');
        // Não lançar erro para não interromper o fluxo - apenas logar
      }
    } else {
      console.log('\n⚠ XML Service is disabled (XML_SERVICE_URL or WEBHOOK_URL not configured)');
    }
    
    // Atualizar estado
    updateState(filename);
    console.log(`\nState updated: last_processed_filename = ${filename}`);
    
  } catch (error) {
    console.error(`Error processing file ${filename}:`, error);
    throw error;
  }
}

/**
 * Loop principal de polling
 */
async function pollForNewFiles(): Promise<void> {
  const state = loadState();
  const lastProcessed = state.last_processed_filename;
  
  console.log(`\n[${new Date().toISOString()}] Polling for new files...`);
  if (lastProcessed) {
    console.log(`Last processed: ${lastProcessed}`);
  } else {
    console.log('No previous file processed');
  }
  
  try {
    // Listar ficheiros no bucket
    const files = await listFiles(BUCKET_NAME, RAW_PREFIX, 500);
    
    if (files.length === 0) {
      console.log('No CSV files found in bucket');
      return;
    }
    
    // Encontrar o mais recente
    const latestFile = findLatestFile(files);
    
    if (!latestFile) {
      console.log('No valid CSV files found');
      return;
    }
    
    // Verificar se é um ficheiro novo
    if (latestFile.name === lastProcessed) {
      console.log('No new file (latest is already processed)');
      return;
    }
    
    // Processar novo ficheiro
    await processNewFile(latestFile.name);
    
  } catch (error) {
    console.error('Error in polling cycle:', error);
  }
}

/**
 * Função principal
 */
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Processor Service - Step 2 + Step 3');
  console.log('='.repeat(60));
  console.log(`Configuration:`);
  console.log(`  - Bucket: ${BUCKET_NAME}`);
  console.log(`  - Raw Prefix: ${RAW_PREFIX}/`);
  console.log(`  - Processed Prefix: ${PROCESSED_PREFIX}/`);
  console.log(`  - Poll Interval: ${POLL_INTERVAL} seconds`);
  console.log(`  - Upload Transformed: ${UPLOAD_TRANSFORMED ? 'Yes' : 'No'}`);
  console.log(`  - Supabase URL: ${SUPABASE_URL?.substring(0, 30)}...`);
  console.log(`  - XML Service: ${ENABLE_XML_SERVICE ? 'Enabled' : 'Disabled'}`);
  if (ENABLE_XML_SERVICE) {
    if (USE_SOCKET) {
      console.log(`    - Protocol: TCP Socket (NON-HTTP)`);
      console.log(`    - Socket Host: ${XML_SERVICE_SOCKET_HOST}`);
      console.log(`    - Socket Port: ${XML_SERVICE_SOCKET_PORT}`);
    } else {
      console.log(`    - Protocol: HTTP (multipart/form-data)`);
      console.log(`    - XML Service URL: ${XML_SERVICE_URL?.substring(0, 40)}...`);
      console.log(`    - Retries: ${XML_SERVICE_RETRIES}`);
    }
    console.log(`    - Webhook URL: ${WEBHOOK_URL?.substring(0, 40)}...`);
    console.log(`    - Webhook Port: ${WEBHOOK_PORT}`);
    console.log(`    - Timeout: ${XML_SERVICE_TIMEOUT}ms`);
  }
  
  const state = loadState();
  if (state.last_processed_filename) {
    console.log(`  - Last processed: ${state.last_processed_filename}`);
  }
  console.log('='.repeat(60));
  
  // Iniciar servidor webhook se XML Service estiver habilitado
  if (ENABLE_XML_SERVICE) {
    startWebhookServer(WEBHOOK_PORT);
  }
  
  // Executar polling imediatamente
  await pollForNewFiles();
  
  // Configurar polling periódico
  setInterval(async () => {
    await pollForNewFiles();
  }, POLL_INTERVAL * 1000);
  
  console.log(`\nPolling started. Checking every ${POLL_INTERVAL} seconds...`);
}

// Iniciar serviço
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
