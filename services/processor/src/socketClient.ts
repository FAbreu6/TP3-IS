import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface SocketConfig {
  xmlServiceHost: string;
  xmlServicePort: number;
  webhookUrl: string;
  timeout?: number;
}

export interface SocketResponse {
  success: boolean;
  requestId: string;
  message?: string;
  accepted?: boolean;
}

// Compatibilidade com XMLServiceResponse
export type XMLServiceResponse = SocketResponse;

/**
 * Envia CSV para o XML Service via TCP Socket (NÃO HTTP)
 */
export async function sendCSVToXMLServiceViaSocket(
  csvFilePath: string,
  config: SocketConfig
): Promise<SocketResponse> {
  const requestId = randomUUID();
  
  // Gerar mapper padrão
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
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('Sending CSV to XML Service via TCP Socket (NON-HTTP)...');
  console.log('='.repeat(60));
  console.log(`Request ID: ${requestId}`);
  console.log(`XML Service Socket: ${config.xmlServiceHost}:${config.xmlServicePort}`);
  console.log(`Webhook URL: ${config.webhookUrl}`);
  console.log(`CSV File: ${csvFilePath}`);
  console.log(`Protocol: TCP Socket (NOT HTTP)`);
  
  return new Promise((resolve, reject) => {
    try {
      // Ler arquivo CSV
      if (!fs.existsSync(csvFilePath)) {
        throw new Error(`CSV file not found: ${csvFilePath}`);
      }
      
      const csvBuffer = fs.readFileSync(csvFilePath);
      const csvContent = csvBuffer.toString('utf-8');
      
      // Log para debug: contar linhas do CSV
      const csvLines = csvContent.split('\n').filter(line => line.trim().length > 0);
      const csvRowCount = csvLines.length - 1; // -1 para header
      console.log(`  CSV file read: ${csvRowCount} data rows (${csvLines.length} total lines including header)`);
      console.log(`  CSV content size: ${csvContent.length} characters`);
      
      // Criar header JSON
      const header = {
        requestId: requestId,
        mapper: mapper,
        webhookUrl: config.webhookUrl
      };
      
      const headerJson = JSON.stringify(header);
      const headerBytes = Buffer.from(headerJson, 'utf-8');
      
      // Criar mensagem: [header_size (4 bytes)] + [header_json] + [csv_content]
      const headerSize = Buffer.alloc(4);
      headerSize.writeUInt32BE(headerBytes.length, 0);
      
      const message = Buffer.concat([
        headerSize,
        headerBytes,
        Buffer.from(csvContent, 'utf-8')
      ]);
      
      // Criar socket TCP
      const client = new net.Socket();
      const timeout = config.timeout || 30000;
      
      // Configurar timeout
      client.setTimeout(timeout);
      
      // Handler de conexão
      client.on('connect', () => {
        console.log(`✓ Connected to XML Service via TCP Socket`);
        console.log(`  Sending ${message.length} bytes...`);
        
        // Enviar mensagem
        client.write(message);
      });
      
      // Handler de dados recebidos
      let receivedData = Buffer.alloc(0);
      client.on('data', (data: Buffer) => {
        receivedData = Buffer.concat([receivedData, data]);
        
        // Tentar parse quando tivermos dados suficientes
        if (receivedData.length >= 4) {
          try {
            // Ler tamanho da resposta
            const responseSize = receivedData.readUInt32BE(0);
            
            if (receivedData.length >= 4 + responseSize) {
              // Ler resposta JSON
              const responseJson = receivedData.slice(4, 4 + responseSize).toString('utf-8');
              const response = JSON.parse(responseJson);
              
              console.log('✓ XML Service response received via socket:');
              console.log(JSON.stringify(response, null, 2));
              
              client.destroy();
              
              resolve({
                success: response.accepted === true || response.success === true,
                requestId: requestId,
                accepted: response.accepted === true || response.success === true,
                message: response.message || 'Request accepted by XML Service'
              });
            }
          } catch (error) {
            console.error('Error parsing socket response:', error);
            client.destroy();
            reject(new Error(`Failed to parse response: ${error}`));
          }
        }
      });
      
      // Handler de erros
      client.on('error', (error: Error) => {
        console.error('✗ Socket error:', error);
        client.destroy();
        reject(error);
      });
      
      client.on('timeout', () => {
        console.error('✗ Socket timeout');
        client.destroy();
        reject(new Error(`Socket timeout after ${timeout}ms`));
      });
      
      client.on('close', () => {
        console.log('✓ Socket connection closed');
      });
      
      // Conectar ao servidor
      console.log(`Connecting to ${config.xmlServiceHost}:${config.xmlServicePort}...`);
      client.connect(config.xmlServicePort, config.xmlServiceHost);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('✗ Failed to send CSV via socket:', errorMessage);
      
      resolve({
        success: false,
        requestId,
        accepted: false,
        message: errorMessage
      });
    }
  });
}
