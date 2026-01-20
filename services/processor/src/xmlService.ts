/**
 * XML Service Module
 * Envia CSV transformado para o XML Service via multipart/form-data
 * A confirmação será recebida via webhook posteriormente
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import FormData from 'form-data';

export interface XMLServiceConfig {
  xmlServiceUrl: string;
  webhookUrl: string;
  timeout?: number;
  retries?: number;
}

export interface XMLServiceResponse {
  success: boolean;
  requestId: string;
  message?: string;
  accepted?: boolean; // Indica que o XML Service aceitou a requisição para processamento
}

/**
 * Gera um mapper padrão que mapeia os campos do CSV transformado para XML
 */
function generateDefaultMapper(): string {
  const mapper = {
    ticker: 'ticker',
    preco_atual_usd: 'preco_atual_usd',
    variacao_24h_pct: 'variacao_24h_pct',
    variacao_24h_usd: 'variacao_24h_usd',
    data_observacao_utc: 'data_observacao_utc',
    nome: 'nome',
    rank: 'rank',
    market_cap_usd: 'market_cap_usd',
    circulating_supply: 'circulating_supply',
    total_volume_24h_usd: 'total_volume_24h_usd',
    categoria: 'categoria'
  };
  return JSON.stringify(mapper);
}

/**
 * Envia CSV para o XML Service usando multipart/form-data
 */
export async function sendCSVToXMLService(
  csvFilePath: string,
  config: XMLServiceConfig
): Promise<XMLServiceResponse> {
  const requestId = randomUUID();
  const mapper = generateDefaultMapper();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('Sending CSV to XML Service...');
  console.log('='.repeat(60));
  console.log(`Request ID: ${requestId}`);
  console.log(`XML Service URL: ${config.xmlServiceUrl}`);
  console.log(`Webhook URL: ${config.webhookUrl}`);
  console.log(`CSV File: ${csvFilePath}`);
  
  try {
    // Ler o arquivo CSV
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found: ${csvFilePath}`);
    }
    
    const csvBuffer = fs.readFileSync(csvFilePath);
    const csvFilename = path.basename(csvFilePath);
    
    // Criar FormData
    const formData = new FormData();
    
    // Adicionar campos ao FormData
    formData.append('requestId', requestId);
    formData.append('mapper', mapper);
    formData.append('webhookUrl', config.webhookUrl);
    formData.append('csv', csvBuffer, {
      filename: csvFilename,
      contentType: 'text/csv'
    });
    
    // Fazer requisição HTTP usando node-fetch ou fetch nativo (Node.js 18+)
    const timeout = config.timeout || 30000; // 30 segundos padrão
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      // Garantir que a URL tem o endpoint /api/upload
      const url = config.xmlServiceUrl.endsWith('/api/upload') 
        ? config.xmlServiceUrl 
        : `${config.xmlServiceUrl.replace(/\/$/, '')}/api/upload`;
      
      const response = await fetch(url, {
        method: 'POST',
        body: formData as any,
        signal: controller.signal,
        headers: formData.getHeaders()
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `XML Service request failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }
      
      const responseData = await response.json() as any;
      
      console.log('XML Service response received:');
      console.log(JSON.stringify(responseData, null, 2));
      
      // O XML Service apenas confirma que recebeu a requisição
      // A confirmação de sucesso/erro virá via webhook posteriormente
      const accepted = responseData.accepted === true || 
                       responseData.success === true ||
                       responseData.status === 'accepted' ||
                       response.status === 200 || response.status === 202;
      
      if (!accepted) {
        throw new Error('XML Service did not accept the request');
      }
      
      console.log('✓ XML Service accepted request for processing');
      console.log('  Waiting for webhook notification with final status...');
      
      return {
        success: true,
        requestId,
        accepted: true,
        message: responseData.message || 'Request accepted by XML Service'
      };
      
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      
      throw error;
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('✗ Failed to send CSV to XML Service:', errorMessage);
    
    return {
      success: false,
      requestId,
      accepted: false,
      message: errorMessage
    };
  }
}

/**
 * Envia CSV para o XML Service com retry automático
 */
export async function sendCSVToXMLServiceWithRetry(
  csvFilePath: string,
  config: XMLServiceConfig
): Promise<XMLServiceResponse> {
  const maxRetries = config.retries || 3;
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`\nAttempt ${attempt}/${maxRetries} to send CSV to XML Service...`);
    
    try {
      const result = await sendCSVToXMLService(csvFilePath, config);
      
      if (result.success && result.accepted) {
        return result;
      }
      
      // Se falhou, tentar novamente
      lastError = new Error(result.message || 'XML Service did not accept the request');
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    
    // Se não foi a última tentativa, esperar antes de tentar novamente
    if (attempt < maxRetries) {
      const delay = 1000 * attempt; // Backoff exponencial: 1s, 2s, 3s...
      console.log(`Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // Todas as tentativas falharam
  throw lastError || new Error('Failed to send CSV to XML Service after all retries');
}

/**
 * Apaga arquivos CSV da pasta downloads
 */
export function deleteCSVFiles(filenames: string[]): void {
  const downloadsDir = path.join(__dirname, '..', 'downloads');
  
  if (!fs.existsSync(downloadsDir)) {
    console.warn(`Downloads directory not found: ${downloadsDir}`);
    return;
  }
  
  let deletedCount = 0;
  const errors: string[] = [];
  
  for (const filename of filenames) {
    const filePath = path.join(downloadsDir, filename);
    
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deletedCount++;
        console.log(`Deleted CSV file: ${filename}`);
      } else {
        console.warn(`CSV file not found (may have been deleted already): ${filename}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`${filename}: ${errorMessage}`);
      console.error(`Failed to delete ${filename}:`, errorMessage);
    }
  }
  
  if (deletedCount > 0) {
    console.log(`\n✓ Successfully deleted ${deletedCount} CSV file(s)`);
  }
  
  if (errors.length > 0) {
    console.warn(` Failed to delete ${errors.length} file(s):`);
    errors.forEach(err => console.warn(`  - ${err}`));
  }
}
