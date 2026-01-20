/**
 * Schema GraphQL para o BI Service
 */

export const typeDefs = `
  type XPathResult {
    id: Int!
    result: String!
    requestId: String!
    dataCriacao: String!
  }
  
  type XPathQueryResponse {
    success: Boolean!
    count: Int!
    results: [XPathResult!]!
    errorMessage: String
  }
  
  type AggregateResponse {
    success: Boolean!
    result: String!
    aggregateFunc: String!
    errorMessage: String
  }
  
  type AssetMarketCap {
    ticker: String!
    nome: String
    tipo: String
    marketCap: Float
  }
  
  type TipoStats {
    tipo: String!
    totalAtivos: Int!
    avgPreco: Float
    totalVolume: Float
    avgVariacaoPct: Float
  }
  
  type Mover {
    ticker: String!
    nome: String
    precoAtual: Float
    variacaoPct: Float
  }
  
  type Query {
    # Consulta 1: Obter todos os tickers de criptomoedas
    getAllTickers(startDate: String, endDate: String): XPathQueryResponse!
    
    # Consulta 2: Obter preços agregados por categoria
    getPricesByCategory(category: String!): AggregateResponse!
    
    # Consulta 3: Obter top N ativos por market cap
    getTopAssetsByMarketCap(limit: Int!, startDate: String): XPathQueryResponse!
    
    # Consulta XPath genérica
    queryXPath(xpathQuery: String!, startDate: String, endDate: String, status: String): XPathQueryResponse!
    
    # Agregação XPath genérica
    aggregateXPath(xpathQuery: String!, aggregateFunc: String): AggregateResponse!
    
    # Novas queries estruturadas para BI/Visualization
    topMarketCap(limit: Int = 10, tipo: String): [AssetMarketCap!]!
    statsByTipo: [TipoStats!]!
    movers(limit: Int = 10, direction: String!): [Mover!]!
  }
`;

export default typeDefs;
