import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import { EnrichedData } from './enrichment';

export interface CSVRow {
  symbol: string;
  source_price: string;
  change_24h: string;
  timestamp: string;
}

export interface TransformedCSVRow {
  ticker: string;
  preco_atual_usd: string;
  variacao_24h_pct: string;
  variacao_24h_usd: string;
  data_observacao_utc: string;
  nome: string;
  rank: string;
  market_cap_usd: string;
  circulating_supply: string;
  total_volume_24h_usd: string;
  categoria: string;
}

const REQUIRED_HEADERS = ['symbol', 'source_price', 'change_24h', 'timestamp'];

/**
 * Valida se o cabeçalho do CSV contém exatamente os campos esperados
 */
export function validateHeader(headers: string[]): boolean {
  if (headers.length !== REQUIRED_HEADERS.length) {
    return false;
  }

  return REQUIRED_HEADERS.every(header => headers.includes(header));
}

/**
 * Faz parse do CSV e valida o formato
 */
export function parseCSV(csvContent: string): {
  headers: string[];
  rows: CSVRow[];
  dataRowCount: number;
} {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  if (records.length === 0) {
    throw new Error('CSV file is empty or has no data rows');
  }

  // Obter cabeçalhos do primeiro registro (csv-parse usa as chaves do primeiro objeto)
  const headers = Object.keys(records[0]);

  // Validar cabeçalho
  if (!validateHeader(headers)) {
    throw new Error(
      `Invalid CSV header. Expected: ${REQUIRED_HEADERS.join(', ')}, Got: ${headers.join(', ')}`
    );
  }

  // Converter para formato tipado
  const rows: CSVRow[] = records.map((record: any) => ({
    symbol: record.symbol || '',
    source_price: record.source_price || '',
    change_24h: record.change_24h || '',
    timestamp: record.timestamp || ''
  }));

  return {
    headers,
    rows,
    dataRowCount: rows.length
  };
}

/**
 * Salva o ficheiro CSV baixado na pasta downloads
 */
export function saveDownloadedFile(filename: string, content: Buffer): string {
  const downloadsDir = path.join(__dirname, '..', 'downloads');
  
  // Criar pasta downloads se não existir
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  const filePath = path.join(downloadsDir, filename);
  fs.writeFileSync(filePath, content, 'binary');
  
  return filePath;
}

/**
 * Obtém preview das primeiras N linhas
 */
export function getPreview(rows: CSVRow[], count: number = 5): CSVRow[] {
  return rows.slice(0, Math.min(count, rows.length));
}

/**
 * Escapa valores CSV (adiciona aspas se necessário)
 */
function escapeCSVValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Gera CSV transformado a partir dos dados originais e enriquecidos
 */
export function generateTransformedCSV(
  rows: CSVRow[],
  enrichedDataMap: Map<string, EnrichedData>
): string {
  const headers = [
    'ticker',
    'preco_atual_usd',
    'variacao_24h_pct',
    'variacao_24h_usd',
    'data_observacao_utc',
    'nome',
    'rank',
    'market_cap_usd',
    'circulating_supply',
    'total_volume_24h_usd',
    'categoria'
  ];
  
  // Linha de cabeçalho
  const csvLines: string[] = [headers.join(',')];
  
  // Linhas de dados
  for (const row of rows) {
    const enriched = enrichedDataMap.get(row.symbol);
    
    // Se não houver dados enriquecidos, usar valores padrão
    const transformedRow: TransformedCSVRow = {
      ticker: escapeCSVValue(row.symbol),
      preco_atual_usd: escapeCSVValue(row.source_price),
      variacao_24h_pct: escapeCSVValue(row.change_24h),
      variacao_24h_usd: escapeCSVValue(enriched?.variacao_24h_usd || '0'),
      data_observacao_utc: escapeCSVValue(row.timestamp),
      nome: escapeCSVValue(enriched?.nome || row.symbol),
      rank: escapeCSVValue(enriched?.rank || '0'),
      market_cap_usd: escapeCSVValue(enriched?.market_cap_usd || '0'),
      circulating_supply: escapeCSVValue(enriched?.circulating_supply || '0'),
      total_volume_24h_usd: escapeCSVValue(enriched?.total_volume_24h_usd || '0'),
      categoria: escapeCSVValue(enriched?.categoria || 'Cryptocurrency')
    };
    
    csvLines.push([
      transformedRow.ticker,
      transformedRow.preco_atual_usd,
      transformedRow.variacao_24h_pct,
      transformedRow.variacao_24h_usd,
      transformedRow.data_observacao_utc,
      transformedRow.nome,
      transformedRow.rank,
      transformedRow.market_cap_usd,
      transformedRow.circulating_supply,
      transformedRow.total_volume_24h_usd,
      transformedRow.categoria
    ].join(','));
  }
  
  return csvLines.join('\n');
}

/**
 * Salva CSV transformado na pasta downloads
 */
export function saveTransformedCSV(originalFilename: string, csvContent: string): string {
  const downloadsDir = path.join(__dirname, '..', 'downloads');
  
  // Criar pasta downloads se não existir
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }
  
  // Gerar nome do ficheiro transformado
  const baseName = originalFilename.replace(/\.csv$/i, '');
  const transformedFilename = `transformed_${baseName}.csv`;
  const filePath = path.join(downloadsDir, transformedFilename);
  
  fs.writeFileSync(filePath, csvContent, 'utf-8');
  
  return filePath;
}

/**
 * Aplica política de retenção local: mantém apenas os 10 ficheiros mais recentes em downloads/
 * Apaga os mais antigos se existirem mais de 10.
 * 
 * @param maxFiles Número máximo de ficheiros a manter (padrão: 10)
 * @param excludeFiles Lista de nomes de ficheiros a excluir da limpeza (ex: ficheiro recém-criado)
 */
export function applyLocalRetention(maxFiles: number = 10, excludeFiles: string[] = []): void {
  try {
    const downloadsDir = path.join(__dirname, '..', 'downloads');
    
    if (!fs.existsSync(downloadsDir)) {
      return;
    }
    
    // Listar todos os ficheiros CSV (raw_*.csv e transformed_*.csv)
    const files = fs.readdirSync(downloadsDir)
      .filter(file => file.endsWith('.csv'))
      .map(file => {
        const filePath = path.join(downloadsDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          mtime: stats.mtime.getTime()
        };
      })
      .filter(file => !excludeFiles.includes(file.name)); // Excluir ficheiros especificados
    
    if (files.length <= maxFiles) {
      return; // Não há necessidade de limpar
    }
    
    // Ordenar por data de modificação (mais antigo primeiro)
    files.sort((a, b) => a.mtime - b.mtime);
    
    // Calcular quantos ficheiros apagar
    const filesToDelete = files.slice(0, files.length - maxFiles);
    let deletedCount = 0;
    
    for (const file of filesToDelete) {
      try {
        fs.unlinkSync(file.path);
        deletedCount++;
      } catch (error) {
        console.warn(`Erro ao apagar ficheiro local ${file.name}: ${error}`);
      }
    }
    
    if (deletedCount > 0) {
      console.log(`cleanup: removed ${deletedCount} old local files from downloads/`);
    }
  } catch (error) {
    console.warn(`Erro ao aplicar política de retenção local: ${error}`);
  }
}
