/**
 * Enrichment Module - Step 3
 * Enriquece dados de criptomoedas usando API externa (CryptoCompare)
 */

export interface CryptoCompareData {
  MKTCAP: number;
  SUPPLY: number;
  TOTALVOLUME24H: number;
  CHANGE24HOUR: number;
  HIGH24HOUR: number;
  LOW24HOUR: number;
  OPEN24HOUR: number;
}

interface CryptoCompareResponse {
  RAW: {
    [symbol: string]: {
      USD: {
        MKTCAP?: number;
        SUPPLY?: number;
        TOTALVOLUME24H?: number;
        CHANGE24HOUR?: number;
        HIGH24HOUR?: number;
        LOW24HOUR?: number;
        OPEN24HOUR?: number;
      };
    };
  };
}

export interface EnrichedData {
  nome: string;
  rank: string;
  market_cap_usd: string;
  circulating_supply: string;
  total_volume_24h_usd: string;
  variacao_24h_usd: string;
  categoria: string;
}

// Cache para dados CryptoCompare
const cryptoCompareCache = new Map<string, CryptoCompareData>();

// Rate limiting: máximo 5 req/s por API
class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly timeWindow: number; // em ms

  constructor(maxRequests: number, timeWindowMs: number) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindowMs;
  }

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    
    // Remover requisições antigas (fora da janela de tempo)
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    
    // Se atingiu o limite, esperar
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.timeWindow - (now - oldestRequest);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.waitIfNeeded(); // Verificar novamente após esperar
      }
    }
    
    // Registrar nova requisição
    this.requests.push(now);
  }
}

// Rate limiter: 5 req/s = 5 req/1000ms
const cryptoCompareRateLimiter = new RateLimiter(5, 1000);

/**
 * Retry com backoff exponencial
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('Retry failed');
}

/**
 * Obtém dados do CryptoCompare em batch (máx 20 symbols por vez)
 */
async function getCryptoCompareDataBatch(symbols: string[]): Promise<Map<string, CryptoCompareData>> {
  const result = new Map<string, CryptoCompareData>();
  
  // Filtrar símbolos já em cache
  const symbolsToFetch: string[] = [];
  for (const symbol of symbols) {
    if (cryptoCompareCache.has(symbol)) {
      const cached = cryptoCompareCache.get(symbol);
      if (cached) {
        result.set(symbol, cached);
      }
    } else {
      symbolsToFetch.push(symbol);
    }
  }
  
  if (symbolsToFetch.length === 0) {
    return result;
  }
  
  // Processar em batches de 20
  const batchSize = 20;
  for (let i = 0; i < symbolsToFetch.length; i += batchSize) {
    const batch = symbolsToFetch.slice(i, i + batchSize);
    
    await cryptoCompareRateLimiter.waitIfNeeded();
    
    try {
      const response = await retryWithBackoff(async () => {
        // CryptoCompare usa fsyms (from symbols) e tsyms (to symbols)
        const fsyms = batch.join(',');
        const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${fsyms}&tsyms=USD`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`CryptoCompare API failed: ${res.status} ${res.statusText}`);
        }
        return res;
      });

      const data = await response.json() as CryptoCompareResponse;
      
      if (data.RAW) {
        for (const symbol of batch) {
          const symbolData = data.RAW[symbol]?.USD;
          if (symbolData) {
            const ccData: CryptoCompareData = {
              MKTCAP: symbolData.MKTCAP || 0,
              SUPPLY: symbolData.SUPPLY || 0,
              TOTALVOLUME24H: symbolData.TOTALVOLUME24H || 0,
              CHANGE24HOUR: symbolData.CHANGE24HOUR || 0,
              HIGH24HOUR: symbolData.HIGH24HOUR || 0,
              LOW24HOUR: symbolData.LOW24HOUR || 0,
              OPEN24HOUR: symbolData.OPEN24HOUR || 0
            };
            
            cryptoCompareCache.set(symbol, ccData);
            result.set(symbol, ccData);
          }
        }
      }
    } catch (error) {
      // Erro silencioso - continuar com próximo batch
    }
  }
  
  return result;
}

/**
 * Enriquece dados de uma única criptomoeda
 */
export async function enrichCryptoData(symbol: string): Promise<EnrichedData | null> {
  try {
    // Buscar dados do CryptoCompare
    const cryptoCompareMap = await getCryptoCompareDataBatch([symbol]);
    const cryptoCompareData = cryptoCompareMap.get(symbol);
    
    // Se a API não retornou dados, retornar null
    if (!cryptoCompareData) {
      return null;
    }
    
    // Usar dados do CryptoCompare
    const enriched: EnrichedData = {
      nome: symbol,
      rank: '0',
      market_cap_usd: cryptoCompareData ? String(cryptoCompareData.MKTCAP) : '0',
      circulating_supply: cryptoCompareData ? String(cryptoCompareData.SUPPLY) : '0',
      total_volume_24h_usd: cryptoCompareData ? String(cryptoCompareData.TOTALVOLUME24H) : '0',
      variacao_24h_usd: cryptoCompareData ? String(cryptoCompareData.CHANGE24HOUR) : '0',
      categoria: 'Cryptocurrency'
    };
    
    return enriched;
  } catch (error) {
    // Erro silencioso
    return null;
  }
}

/**
 * Enriquece dados de múltiplas criptomoedas (otimizado com batch)
 */
export async function enrichCryptoDataBatch(symbols: string[]): Promise<Map<string, EnrichedData>> {
  const result = new Map<string, EnrichedData>();
  
  // Buscar todos os dados do CryptoCompare em batch
  const cryptoCompareMap = await getCryptoCompareDataBatch(symbols);
  
  // Processar cada símbolo
  for (const symbol of symbols) {
    const cryptoCompareData = cryptoCompareMap.get(symbol);
    
    if (!cryptoCompareData) {
      console.warn(`WARNING: CryptoCompare API failed for ${symbol}, using default values`);
      // AINDA ASSIM, retornar dados básicos para garantir que a moeda seja incluída no CSV
      const enriched: EnrichedData = {
        nome: symbol,
        rank: '0',
        market_cap_usd: '0',
        circulating_supply: '0',
        total_volume_24h_usd: '0',
        variacao_24h_usd: '0',
        categoria: 'Cryptocurrency'
      };
      result.set(symbol, enriched);
    } else {
      // Usar dados do CryptoCompare
      const enriched: EnrichedData = {
        nome: symbol,
        rank: '0',
        market_cap_usd: String(cryptoCompareData.MKTCAP || 0),
        circulating_supply: String(cryptoCompareData.SUPPLY || 0),
        total_volume_24h_usd: String(cryptoCompareData.TOTALVOLUME24H || 0),
        variacao_24h_usd: String(cryptoCompareData.CHANGE24HOUR || 0),
        categoria: 'Cryptocurrency'
      };
      result.set(symbol, enriched);
    }
  }
  
  console.log(`✓ Enrichment complete: ${result.size} symbols processed (expected: ${symbols.length})`);
  
  return result;
}
