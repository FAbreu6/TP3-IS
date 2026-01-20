/**
 * Webhook Server Module
 * Recebe notificações do XML Service sobre o status do processamento
 */

import * as http from 'http';
import * as url from 'url';
import { deleteCSVFiles } from './xmlService';

export interface WebhookNotification {
  ID_Requisicao: string;
  Status: 'OK' | 'ERRO_VALIDACAO' | 'ERRO_PERSISTENCIA';
  ID_Documento?: string;
}

export interface PendingRequest {
  requestId: string;
  csvFilenames: string[]; // Arquivos CSV a deletar quando confirmado
  createdAt: Date;
}

// Mapa de requisições pendentes: requestId -> PendingRequest
const pendingRequests = new Map<string, PendingRequest>();

// Timeout para limpar requisições antigas (1 hora)
const REQUEST_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Registra uma requisição pendente aguardando confirmação do XML Service
 */
export function registerPendingRequest(
  requestId: string,
  csvFilenames: string[]
): void {
  pendingRequests.set(requestId, {
    requestId,
    csvFilenames,
    createdAt: new Date()
  });
  
  console.log(`Registered pending request: ${requestId}`);
  console.log(`  - CSV files to delete on confirmation: ${csvFilenames.join(', ')}`);
  
  // Limpar requisições antigas periodicamente
  cleanupOldRequests();
}

/**
 * Remove uma requisição pendente
 */
export function removePendingRequest(requestId: string): void {
  pendingRequests.delete(requestId);
}

/**
 * Obtém uma requisição pendente
 */
export function getPendingRequest(requestId: string): PendingRequest | undefined {
  return pendingRequests.get(requestId);
}

/**
 * Limpa requisições antigas (mais de 1 hora)
 */
function cleanupOldRequests(): void {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [requestId, request] of pendingRequests.entries()) {
    const age = now - request.createdAt.getTime();
    if (age > REQUEST_TIMEOUT_MS) {
      pendingRequests.delete(requestId);
      cleanedCount++;
      console.warn(`Cleaned up old pending request (${Math.floor(age / 1000)}s old): ${requestId}`);
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} old pending request(s)`);
  }
}

/**
 * Processa uma notificação do webhook do XML Service
 */
function processWebhookNotification(notification: WebhookNotification): void {
  const { ID_Requisicao, Status, ID_Documento } = notification;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('Webhook notification received from XML Service');
  console.log('='.repeat(60));
  console.log(`Request ID: ${ID_Requisicao}`);
  console.log(`Status: ${Status}`);
  if (ID_Documento) {
    console.log(`Document ID: ${ID_Documento}`);
  }
  
  const pendingRequest = getPendingRequest(ID_Requisicao);
  
  if (!pendingRequest) {
    console.warn(`⚠ No pending request found for ID: ${ID_Requisicao}`);
    console.warn('  This may indicate the request was already processed or timed out.');
    return;
  }
  
  if (Status === 'OK') {
    console.log('\n✓ XML Service confirmed successful processing');
    console.log('Deleting CSV files...');
    
    deleteCSVFiles(pendingRequest.csvFilenames);
    
    // Remover da lista de pendentes
    removePendingRequest(ID_Requisicao);
    
    console.log(`✓ Request ${ID_Requisicao} completed and cleaned up`);
  } else {
    console.error(`\n✗ XML Service reported error: ${Status}`);
    console.error('CSV files will NOT be deleted due to error.');
    
    // Remover da lista de pendentes mesmo em caso de erro
    // (para não acumular requisições com erro)
    removePendingRequest(ID_Requisicao);
    
    console.warn(`⚠ Request ${ID_Requisicao} failed with status: ${Status}`);
  }
}

/**
 * Cria e inicia o servidor webhook
 */
export function startWebhookServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Lidar com OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    // Apenas aceitar POST no endpoint /webhook
    const parsedUrl = url.parse(req.url || '', true);
    
    if (req.method !== 'POST' || parsedUrl.pathname !== '/webhook') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }
    
    // Ler o corpo da requisição
    let body = '';
    
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        // Parse do JSON
        const notification = JSON.parse(body) as WebhookNotification;
        
        // Validar campos obrigatórios
        if (!notification.ID_Requisicao || !notification.Status) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'Invalid notification: ID_Requisicao and Status are required' 
          }));
          return;
        }
        
        // Validar Status
        if (!['OK', 'ERRO_VALIDACAO', 'ERRO_PERSISTENCIA'].includes(notification.Status)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: `Invalid Status: ${notification.Status}. Must be OK, ERRO_VALIDACAO, or ERRO_PERSISTENCIA` 
          }));
          return;
        }
        
        // Processar notificação
        processWebhookNotification(notification);
        
        // Responder com sucesso
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Notification processed successfully' 
        }));
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error processing webhook notification:', errorMessage);
        console.error('Request body:', body);
        
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Invalid JSON or request format',
          details: errorMessage
        }));
      }
    });
    
    req.on('error', (error) => {
      console.error('Error reading webhook request:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    });
  });
  
  server.listen(port, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log('Webhook Server started');
    console.log('='.repeat(60));
    console.log(`Listening on port ${port}`);
    console.log(`Endpoint: http://0.0.0.0:${port}/webhook`);
    console.log('='.repeat(60));
  });
  
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n✗ Port ${port} is already in use. Please use a different port.`);
      process.exit(1);
    } else {
      console.error('Webhook server error:', error);
    }
  });
  
  // Limpar requisições antigas periodicamente (a cada 30 minutos)
  setInterval(() => {
    cleanupOldRequests();
  }, 30 * 60 * 1000);
  
  return server;
}

/**
 * Obtém estatísticas das requisições pendentes
 */
export function getPendingRequestsStats(): {
  count: number;
  requests: Array<{
    requestId: string;
    ageSeconds: number;
    csvFilenames: string[];
  }>;
} {
  const now = Date.now();
  const requests = Array.from(pendingRequests.values()).map(req => ({
    requestId: req.requestId,
    ageSeconds: Math.floor((now - req.createdAt.getTime()) / 1000),
    csvFilenames: req.csvFilenames
  }));
  
  return {
    count: requests.length,
    requests
  };
}
