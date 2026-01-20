/**
 * BI Service - Servidor GraphQL e REST
 */

import * as dotenv from 'dotenv';
import fastify from 'fastify';
import cors from '@fastify/cors';
import { ApolloServer } from '@apollo/server';
import { fastifyApolloDrainPlugin, fastifyApolloHandler } from '@as-integrations/fastify';
import typeDefs from './graphql-schema';
import { resolvers } from './resolvers';
import { XMLServiceClient } from './grpc-client';

// Carregar variáveis de ambiente
dotenv.config();

const PORT = parseInt(process.env.PORT || '4000', 10);
const XML_SERVICE_URL = process.env.XML_SERVICE_URL || 'http://xml-service:5000';

// Inicializar cliente XML Service
const xmlServiceClient = new XMLServiceClient(XML_SERVICE_URL);

// Criar servidor Fastify
const app = fastify({ logger: true });

// Registrar CORS
app.register(cors, {
  origin: true, // Permitir todas as origens (em produção, especificar domínios)
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

// Criar servidor Apollo GraphQL (será inicializado depois)
let apollo: ApolloServer;

// Endpoint de health check
app.get('/health', async (request, reply) => {
  return { status: 'healthy', service: 'bi-service' };
});

// Endpoint REST para consulta de tickers (apenas do último XML)
app.get('/api/tickers', async (request, reply) => {
  try {
    // Buscar todos os ativos do último XML
    const response = await fetch(`${XML_SERVICE_URL}/api/latest/ativos`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json() as any;
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch latest ativos');
    }
    
    // Retornar apenas os tickers únicos
    const uniqueTickers = [...new Set(data.ativos.map((a: any) => a.ticker))];
    
    return {
      success: true,
      count: uniqueTickers.length,
      tickers: uniqueTickers,
      error: null
    };
  } catch (error) {
    reply.code(500);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

// Endpoint REST para obter todas as informações das moedas do último XML
app.get('/api/latest/coins', async (request, reply) => {
  try {
    const response = await fetch(`${XML_SERVICE_URL}/api/latest/ativos`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json() as any;
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch latest ativos');
    }
    
    return {
      success: true,
      count: data.count,
      coins: data.ativos,
      error: null
    };
  } catch (error) {
    reply.code(500);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

// Endpoint REST para preços por categoria
app.get('/api/prices/category/:category', async (request, reply) => {
  try {
    const { category } = request.params as { category: string };
    
    const query = {
      xpath_query: `//Ativo[@Tipo='${category}']/Detalhenegociacao/PrecoAtual`,
      aggregate_func: 'avg' as const
    };
    
    const response = await xmlServiceClient.aggregateXPath(query);
    
    return {
      success: response.success,
      category,
      averagePrice: response.result,
      error: response.error_message
    };
  } catch (error) {
    reply.code(500);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

// Endpoint REST para obter último XML válido
app.get('/api/latest/xml', async (request, reply) => {
  try {
    // Remover barra final se existir
    const xmlServiceUrl = XML_SERVICE_URL.replace(/\/$/, '');
    const url = `${xmlServiceUrl}/api/latest/xml`;
    
    console.log(`[latest/xml] Calling: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[latest/xml] HTTP ${response.status}: ${errorText}`);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json() as any;
    return data;
  } catch (error) {
    console.error('Error fetching latest XML:', error);
    reply.code(500);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

// Endpoint REST para top assets por market cap
app.get('/api/assets/top/:limit', async (request, reply) => {
  try {
    const { limit } = request.params as { limit: string };
    const { start_date } = request.query as { start_date?: string };
    
    const query = {
      xpath_query: '//Ativo/HistoricoAPI/MarketCap',
      start_date: start_date,
      status: 'OK'
    };
    
    const response = await xmlServiceClient.queryXPath(query);
    
    // Ordenar por valor (desc) e limitar
    const sortedResults = response.results
      .sort((a, b) => parseFloat(b.result || '0') - parseFloat(a.result || '0'))
      .slice(0, parseInt(limit, 10));
    
    return {
      success: response.success,
      limit: parseInt(limit, 10),
      count: sortedResults.length,
      assets: sortedResults.map(r => ({
        id: r.id,
        marketCap: r.result,
        requestId: r.request_id,
        dataCriacao: r.data_criacao
      })),
      error: response.error_message
    };
  } catch (error) {
    reply.code(500);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

// Handler GraphQL será registrado no start()

// Inicializar servidor
async function start() {
  try {
    // Inicializar Apollo Server
    apollo = new ApolloServer({
      typeDefs,
      resolvers,
      plugins: [fastifyApolloDrainPlugin(app)]
    });
    await apollo.start();
    
    // Criar handler GraphQL
    const graphqlHandler = fastifyApolloHandler(apollo);
    
    // Registrar handler GraphQL
    app.post('/graphql', graphqlHandler);
    app.get('/graphql', graphqlHandler);
    
    console.log('='.repeat(60));
    console.log('BI Service starting...');
    console.log('='.repeat(60));
    console.log(`Port: ${PORT}`);
    console.log(`XML Service URL: ${XML_SERVICE_URL}`);
    console.log(`GraphQL endpoint: http://localhost:${PORT}/graphql`);
    console.log(`REST endpoints:`);
    console.log(`  - GET /api/tickers`);
    console.log(`  - GET /api/prices/category/:category`);
    console.log(`  - GET /api/assets/top/:limit`);
    console.log('='.repeat(60));
    
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n✓ BI Service started on port ${PORT}`);
  } catch (error) {
    console.error('Error starting BI Service:', error);
    process.exit(1);
  }
}

start();
