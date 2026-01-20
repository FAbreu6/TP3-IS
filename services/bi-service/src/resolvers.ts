/**
 * Resolvers GraphQL para o BI Service
 */

import { XMLServiceClient, XPathQuery, AggregateQuery } from './grpc-client';

const xmlServiceClient = new XMLServiceClient(
  process.env.XML_SERVICE_URL || 'http://xml-service:5000'
);

export const resolvers = {
  Query: {
    /**
     * Consulta 1: Obter todos os tickers de criptomoedas (apenas do último XML)
     */
    getAllTickers: async (_: any, args: { startDate?: string; endDate?: string }) => {
      try {
        // Buscar todos os ativos do último XML criado
        const response = await xmlServiceClient.getAllAtivosFromLatestXml();
        
        if (!response.success) {
          return {
            success: false,
            count: 0,
            results: [],
            errorMessage: response.error_message || 'Failed to fetch latest ativos'
          };
        }
        
        // Extrair apenas os tickers únicos do último XML
        const uniqueTickers = new Map<string, any>();
        for (const ativo of response.ativos) {
          const ticker = ativo.ticker;
          if (ticker && !uniqueTickers.has(ticker)) {
            uniqueTickers.set(ticker, {
              id: 0, // Não temos ID individual para cada ticker
              result: ticker,
              requestId: ativo.request_id,
              dataCriacao: ativo.data_criacao
            });
          }
        }
        
        const results = Array.from(uniqueTickers.values());
        
        return {
          success: true,
          count: results.length,
          results: results,
          errorMessage: undefined
        };
      } catch (error) {
        return {
          success: false,
          count: 0,
          results: [],
          errorMessage: error instanceof Error ? error.message : String(error)
        };
      }
    },
    
    /**
     * Consulta 2: Obter preços agregados por categoria
     * XPath: //Ativo[@Tipo='{category}']/Detalhenegociacao/PrecoAtual
     */
    getPricesByCategory: async (_: any, args: { category: string }) => {
      try {
        const query: AggregateQuery = {
          xpath_query: `//Ativo[@Tipo='${args.category}']/Detalhenegociacao/PrecoAtual`,
          aggregate_func: 'avg'
        };
        
        const response = await xmlServiceClient.aggregateXPath(query);
        return {
          success: response.success,
          result: response.result,
          aggregateFunc: response.aggregate_func,
          errorMessage: response.error_message
        };
      } catch (error) {
        return {
          success: false,
          result: '0',
          aggregateFunc: 'avg',
          errorMessage: error instanceof Error ? error.message : String(error)
        };
      }
    },
    
    /**
     * Consulta 3: Obter top N ativos por market cap
     * XPath: //Ativo/HistoricoAPI/MarketCap (ordenado)
     */
    getTopAssetsByMarketCap: async (_: any, args: { limit: number; startDate?: string }) => {
      try {
        const query: XPathQuery = {
          xpath_query: '//Ativo/HistoricoAPI/MarketCap',
          start_date: args.startDate,
          status: 'OK'
        };
        
        const response = await xmlServiceClient.queryXPath(query);
        
        // Ordenar por valor (desc) e limitar
        const sortedResults = response.results
          .sort((a, b) => parseFloat(b.result || '0') - parseFloat(a.result || '0'))
          .slice(0, args.limit);
        
        return {
          success: response.success,
          count: sortedResults.length,
          results: sortedResults.map(r => ({
            id: r.id,
            result: r.result,
            requestId: r.request_id,
            dataCriacao: r.data_criacao
          })),
          errorMessage: response.error_message
        };
      } catch (error) {
        return {
          success: false,
          count: 0,
          results: [],
          errorMessage: error instanceof Error ? error.message : String(error)
        };
      }
    },
    
    /**
     * Consulta XPath genérica
     */
    queryXPath: async (_: any, args: { xpathQuery: string; startDate?: string; endDate?: string; status?: string }) => {
      try {
        // Remover barra final se existir
        let xmlServiceUrl = (process.env.XML_SERVICE_URL || 'http://xml-service:5000').replace(/\/$/, '');
        const url = new URL(`${xmlServiceUrl}/api/xpath/query`);
        url.searchParams.append('xpath_query', args.xpathQuery);
        if (args.startDate) url.searchParams.append('start_date', args.startDate);
        if (args.endDate) url.searchParams.append('end_date', args.endDate);
        url.searchParams.append('status', args.status || 'OK');
        
        console.log(`[queryXPath] Calling: ${url.toString()}`);
        const response = await fetch(url.toString());
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[queryXPath] HTTP ${response.status}: ${errorText}`);
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json() as any;
        return {
          success: data.success !== false,
          count: data.count || 0,
          results: (data.results || []).map((r: any) => ({
            id: r.id || 0,
            result: r.result || '',
            requestId: r.request_id || '',
            dataCriacao: r.data_criacao || ''
          })),
          errorMessage: data.error || data.errorMessage
        };
      } catch (error) {
        console.error('Error in queryXPath resolver:', error);
        return {
          success: false,
          count: 0,
          results: [],
          errorMessage: error instanceof Error ? error.message : String(error)
        };
      }
    },
    
    /**
     * Agregação XPath genérica
     */
    aggregateXPath: async (_: any, args: { xpathQuery: string; aggregateFunc?: string }) => {
      try {
        // Remover barra final se existir
        let xmlServiceUrl = (process.env.XML_SERVICE_URL || 'http://xml-service:5000').replace(/\/$/, '');
        const url = new URL(`${xmlServiceUrl}/api/xpath/aggregate`);
        url.searchParams.append('xpath_query', args.xpathQuery);
        url.searchParams.append('aggregate_func', args.aggregateFunc || 'count');
        
        console.log(`[aggregateXPath] Calling: ${url.toString()}`);
        const response = await fetch(url.toString());
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[aggregateXPath] HTTP ${response.status}: ${errorText}`);
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json() as any;
        return {
          success: data.success !== false,
          result: data.result || '0',
          aggregateFunc: data.aggregate_func || args.aggregateFunc || 'count',
          errorMessage: data.error || data.errorMessage
        };
      } catch (error) {
        console.error('Error in aggregateXPath resolver:', error);
        return {
          success: false,
          result: '0',
          aggregateFunc: args.aggregateFunc || 'count',
          errorMessage: error instanceof Error ? error.message : String(error)
        };
      }
    },
    
    /**
     * Top N ativos por market cap (estruturado)
     * Consome: GET /api/query/top-marketcap?limit=...&tipo=...
     */
    topMarketCap: async (_: any, args: { limit?: number; tipo?: string }) => {
      try {
        const limit = args.limit || 10;
        const tipo = args.tipo;
        
        // Remover barra final se existir
        let xmlServiceUrl = (process.env.XML_SERVICE_URL || 'http://xml-service:5000').replace(/\/$/, '');
        let url = `${xmlServiceUrl}/api/query/top-marketcap?limit=${limit}`;
        if (tipo) {
          url += `&tipo=${encodeURIComponent(tipo)}`;
        }
        
        console.log(`[topMarketCap] Calling: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[topMarketCap] HTTP ${response.status}: ${errorText}`);
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json() as any;
        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch top market cap');
        }
        
        // Mapping snake_case -> camelCase
        return (data.data || []).map((item: any) => ({
          ticker: item.ticker,
          nome: item.nome,
          tipo: item.tipo,
          marketCap: item.market_cap ? parseFloat(item.market_cap) : null
        }));
      } catch (error) {
        console.error('Error in topMarketCap resolver:', error);
        throw error; // Propagar erro para GraphQL
      }
    },
    
    /**
     * Estatísticas agregadas por tipo de ativo
     * Consome: GET /api/query/stats-by-tipo
     */
    statsByTipo: async () => {
      try {
        const xmlServiceUrl = process.env.XML_SERVICE_URL || 'http://xml-service:5000';
        const url = `${xmlServiceUrl}/api/query/stats-by-tipo`;
        
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json() as any;
        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch stats by tipo');
        }
        
        // Mapping snake_case -> camelCase
        return (data.data || []).map((item: any) => ({
          tipo: item.tipo,
          totalAtivos: item.total_ativos || 0,
          avgPreco: item.avg_preco ? parseFloat(item.avg_preco) : null,
          totalVolume: item.total_volume ? parseFloat(item.total_volume) : null,
          avgVariacaoPct: item.avg_variacao_pct ? parseFloat(item.avg_variacao_pct) : null
        }));
      } catch (error) {
        console.error('Error in statsByTipo resolver:', error);
        return [];
      }
    },
    
    /**
     * Top gainers ou losers
     * Consome: GET /api/query/movers?limit=...&direction=...
     */
    movers: async (_: any, args: { limit?: number; direction: string }) => {
      try {
        const limit = args.limit || 10;
        const direction = args.direction || 'up';
        
        if (direction !== 'up' && direction !== 'down') {
          throw new Error("direction must be 'up' or 'down'");
        }
        
        // Remover barra final se existir
        let xmlServiceUrl = (process.env.XML_SERVICE_URL || 'http://xml-service:5000').replace(/\/$/, '');
        const url = `${xmlServiceUrl}/api/query/movers?limit=${limit}&direction=${direction}`;
        
        console.log(`[movers] Calling: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[movers] HTTP ${response.status}: ${errorText}`);
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json() as any;
        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch movers');
        }
        
        // Mapping snake_case -> camelCase
        return (data.data || []).map((item: any) => ({
          ticker: item.ticker,
          nome: item.nome,
          precoAtual: item.preco_atual ? parseFloat(item.preco_atual) : null,
          variacaoPct: item.variacao_pct ? parseFloat(item.variacao_pct) : null
        }));
      } catch (error) {
        console.error('Error in movers resolver:', error);
        throw error; // Propagar erro para GraphQL
      }
    }
  }
};
