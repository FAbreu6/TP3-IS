/**
 * Cliente gRPC REAL para consultar XML Service
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';

// Caminho para o arquivo .proto
const PROTO_PATH = path.join(__dirname, '../proto/xml_service.proto');

export interface XPathQuery {
  xpath_query: string;
  start_date?: string;
  end_date?: string;
  status?: string;
}

export interface XPathResult {
  id: number;
  result: string;
  request_id: string;
  data_criacao: string;
}

export interface XPathQueryResponse {
  success: boolean;
  count: number;
  results: XPathResult[];
  error_message?: string;
}

export interface AggregateQuery {
  xpath_query: string;
  aggregate_func?: string; // count, sum, avg, min, max
}

export interface AggregateQueryResponse {
  success: boolean;
  result: string;
  aggregate_func: string;
  error_message?: string;
}

export interface AtivoDetail {
  ticker: string;
  tipo: string;
  preco_atual: string;
  volume: string;
  variacao_24h_pct: string;
  variacao_24h_usd: string;
  nome: string;
  rank: string;
  market_cap: string;
  supply: string;
  data_observacao: string;
  request_id: string;
  data_criacao: string;
}

export interface LatestAtivosResponse {
  success: boolean;
  count: number;
  ativos: AtivoDetail[];
  error_message?: string;
}

/**
 * Cliente gRPC REAL para XML Service
 */
export class XMLServiceClient {
  private grpcClient: any;
  private xmlServiceGrpcUrl: string;
  private xmlServiceRestUrl: string;
  private useGrpc: boolean = false;
  
  constructor(xmlServiceUrl: string) {
    // xmlServiceUrl pode ser URL REST, extrair host/porta para gRPC
    try {
      const url = new URL(xmlServiceUrl);
      this.xmlServiceRestUrl = xmlServiceUrl;
      // gRPC geralmente usa porta 50051
      this.xmlServiceGrpcUrl = `${url.hostname}:50051`;
      
      // Inicializar cliente gRPC REAL
      this.initGrpcClient();
    } catch (error) {
      console.warn('⚠ Error parsing XML Service URL:', error);
      this.xmlServiceRestUrl = xmlServiceUrl;
      this.xmlServiceGrpcUrl = 'xml-service:50051';
    }
  }
  
  private initGrpcClient(): void {
    try {
      // Carregar package definition do .proto
      const packageDefinition = protoLoader.loadSync(
        PROTO_PATH,
        {
          keepCase: true,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true
        }
      );
      
      // Carregar serviço gRPC
      const xmlServiceProto = grpc.loadPackageDefinition(packageDefinition) as any;
      
      // Criar cliente gRPC REAL
      this.grpcClient = new xmlServiceProto.xmlservice.XmlQueryService(
        this.xmlServiceGrpcUrl,
        grpc.credentials.createInsecure()
      );
      
      this.useGrpc = true;
      console.log('✓ gRPC client initialized (REAL)');
      console.log(`  gRPC URL: ${this.xmlServiceGrpcUrl}`);
    } catch (error) {
      console.warn('⚠ gRPC client initialization failed, will use REST fallback:', error);
      this.useGrpc = false;
      this.grpcClient = null;
    }
  }
  
  /**
   * Consulta XPath via gRPC REAL
   */
  async queryXPath(query: XPathQuery): Promise<XPathQueryResponse> {
    if (this.useGrpc && this.grpcClient) {
      return this.queryXPathGrpc(query);
    } else {
      // Fallback para REST se gRPC não estiver disponível
      return this.queryXPathREST(query);
    }
  }
  
  /**
   * Consulta XPath via gRPC REAL
   */
  private queryXPathGrpc(query: XPathQuery): Promise<XPathQueryResponse> {
    return new Promise((resolve, reject) => {
      try {
        const request = {
          xpath_query: query.xpath_query,
          start_date: query.start_date || '',
          end_date: query.end_date || '',
          status: query.status || 'OK'
        };
        
        this.grpcClient.ExecuteXPath(request, (error: any, response: any) => {
          if (error) {
            console.error('gRPC ExecuteXPath error:', error);
            // Fallback para REST em caso de erro
            this.queryXPathREST(query).then(resolve).catch(reject);
            return;
          }
          
          // Converter resposta gRPC para formato interno
          const result: XPathQueryResponse = {
            success: response.success,
            count: response.count,
            results: response.results.map((r: any) => ({
              id: r.id,
              result: r.result,
              request_id: r.request_id,
              data_criacao: r.data_criacao
            })),
            error_message: response.error_message || undefined
          };
          
          resolve(result);
        });
      } catch (error) {
        console.error('gRPC query error:', error);
        // Fallback para REST
        this.queryXPathREST(query).then(resolve).catch(reject);
      }
    });
  }
  
  /**
   * Consulta XPath via REST (fallback)
   */
  private async queryXPathREST(query: XPathQuery): Promise<XPathQueryResponse> {
    try {
      const url = new URL(`${this.xmlServiceRestUrl}/api/xpath/query`);
      
      const params = new URLSearchParams();
      params.append('xpath_query', query.xpath_query);
      if (query.start_date) params.append('start_date', query.start_date);
      if (query.end_date) params.append('end_date', query.end_date);
      if (query.status) params.append('status', query.status);
      
      const response = await fetch(`${url.toString()}?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json() as any;
      return {
        success: data.success || true,
        count: data.count || 0,
        results: data.results || [],
        error_message: data.error
      };
    } catch (error) {
      console.error('Error querying XPath via REST:', error);
      return {
        success: false,
        count: 0,
        results: [],
        error_message: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Agregação XPath via gRPC REAL
   */
  async aggregateXPath(query: AggregateQuery): Promise<AggregateQueryResponse> {
    if (this.useGrpc && this.grpcClient) {
      return this.aggregateXPathGrpc(query);
    } else {
      return this.aggregateXPathREST(query);
    }
  }
  
  /**
   * Agregação XPath via gRPC REAL
   */
  private aggregateXPathGrpc(query: AggregateQuery): Promise<AggregateQueryResponse> {
    return new Promise((resolve, reject) => {
      try {
        const request = {
          xpath_query: query.xpath_query,
          aggregate_func: query.aggregate_func || 'count'
        };
        
        this.grpcClient.ExecuteAggregate(request, (error: any, response: any) => {
          if (error) {
            console.error('gRPC ExecuteAggregate error:', error);
            // Fallback para REST
            this.aggregateXPathREST(query).then(resolve).catch(reject);
            return;
          }
          
          const result: AggregateQueryResponse = {
            success: response.success,
            result: response.result,
            aggregate_func: response.aggregate_func,
            error_message: response.error_message || undefined
          };
          
          resolve(result);
        });
      } catch (error) {
        console.error('gRPC aggregate error:', error);
        this.aggregateXPathREST(query).then(resolve).catch(reject);
      }
    });
  }
  
  /**
   * Agregação XPath via REST (fallback)
   */
  private async aggregateXPathREST(query: AggregateQuery): Promise<AggregateQueryResponse> {
    try {
      const url = new URL(`${this.xmlServiceRestUrl}/api/xpath/aggregate`);
      
      const params = new URLSearchParams();
      params.append('xpath_query', query.xpath_query);
      if (query.aggregate_func) params.append('aggregate_func', query.aggregate_func);
      
      const response = await fetch(`${url.toString()}?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json() as any;
      return {
        success: data.success || true,
        result: data.result || '0',
        aggregate_func: query.aggregate_func || 'count',
        error_message: data.error
      };
    } catch (error) {
      console.error('Error aggregating XPath via REST:', error);
      return {
        success: false,
        result: '0',
        aggregate_func: query.aggregate_func || 'count',
        error_message: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Obtém todos os ativos do último documento XML
   */
  async getAllAtivosFromLatestXml(): Promise<LatestAtivosResponse> {
    if (this.useGrpc && this.grpcClient) {
      return this.getAllAtivosFromLatestXmlGrpc();
    } else {
      return this.getAllAtivosFromLatestXmlREST();
    }
  }
  
  /**
   * Obtém todos os ativos do último XML via gRPC
   */
  private getAllAtivosFromLatestXmlGrpc(): Promise<LatestAtivosResponse> {
    return new Promise((resolve, reject) => {
      try {
        this.grpcClient.GetLatestAtivos({}, (error: any, response: any) => {
          if (error) {
            console.error('gRPC GetLatestAtivos error:', error);
            // Fallback para REST
            this.getAllAtivosFromLatestXmlREST().then(resolve).catch(reject);
            return;
          }
          
          const result: LatestAtivosResponse = {
            success: response.success,
            count: response.count,
            ativos: response.ativos.map((a: any) => ({
              ticker: a.ticker,
              tipo: a.tipo,
              preco_atual: a.preco_atual,
              volume: a.volume,
              variacao_24h_pct: a.variacao_24h_pct,
              variacao_24h_usd: a.variacao_24h_usd,
              nome: a.nome,
              rank: a.rank,
              market_cap: a.market_cap,
              supply: a.supply,
              data_observacao: a.data_observacao,
              request_id: a.request_id,
              data_criacao: a.data_criacao
            })),
            error_message: response.error_message || undefined
          };
          
          resolve(result);
        });
      } catch (error) {
        console.error('gRPC GetLatestAtivos error:', error);
        this.getAllAtivosFromLatestXmlREST().then(resolve).catch(reject);
      }
    });
  }
  
  /**
   * Obtém todos os ativos do último XML via REST (fallback)
   */
  private async getAllAtivosFromLatestXmlREST(): Promise<LatestAtivosResponse> {
    try {
      const response = await fetch(`${this.xmlServiceRestUrl}/api/latest/ativos`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json() as any;
      
      return {
        success: data.success || true,
        count: data.count || 0,
        ativos: data.ativos || [],
        error_message: data.error_message || data.error || undefined
      };
    } catch (error) {
      console.error('Error fetching latest ativos via REST:', error);
      return {
        success: false,
        count: 0,
        ativos: [],
        error_message: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
