"""Módulo para gerar XML a partir do CSV transformado"""

import csv
import io
import re
from datetime import datetime
from typing import Dict, List, Optional
from lxml import etree


def safe_str(value: Optional[str], default: str = '') -> str:
    """Garante que o valor é uma string válida (nunca None)"""
    if value is None:
        return default
    return str(value).strip() or default


def safe_decimal(value: Optional[str], default: str = '0') -> str:
    """Converte valor para decimal válido XML (xs:decimal)
    
    Aceita:
    - Números inteiros: "123"
    - Decimais: "123.45"
    - Notação científica: "1.23e-4" ou "1.23E-4"
    - Números negativos: "-123.45"
    - Notação científica mal formatada: "1.23-4" (corrige para "1.23e-4")
    
    Retorna sempre um decimal válido conforme XML Schema xs:decimal (sem notação científica)
    """
    if value is None:
        return default
    s_val = str(value).strip()
    if not s_val:
        return default
    
    # Corrigir notação científica mal formatada (ex: "2.33-7" -> "2.33e-7")
    # Padrão: número seguido de hífen e dígitos no final = notação científica
    # Detectar padrões como "1.23-4" ou "1.23-04" (notação científica sem 'e')
    sci_pattern = r'^([+-]?\d+\.?\d*)-(\d+)$'
    match = re.match(sci_pattern, s_val)
    if match:
        # Corrigir para notação científica válida
        base = match.group(1)
        exp = match.group(2)
        s_val = f"{base}e-{exp}"
    
    # Tentar converter para float primeiro (aceita notação científica)
    try:
        # Converter para float (aceita notação científica como "1.23e-4")
        float_val = float(s_val)
        
        # Converter de volta para string SEM notação científica
        # XML Schema xs:decimal não aceita notação científica
        
        # Para valores muito pequenos ou muito grandes, usar formatação adequada
        if float_val == 0:
            return '0'
        
        # Formatar sem notação científica
        # Usar formatação com limite de casas decimais mas expandir se necessário
        if abs(float_val) < 1e-6 or abs(float_val) >= 1e15:
            # Para valores muito pequenos ou grandes, usar mais precisão
            # Mas ainda em formato decimal (não científico)
            formatted = f"{float_val:.20f}".rstrip('0').rstrip('.')
        else:
            # Para valores normais, formatar como decimal
            formatted = f"{float_val:.15f}".rstrip('0').rstrip('.')
        
        # Se ficou vazio ou só "-", retornar default
        if not formatted or formatted == '-':
            return default
        
        # Garantir que é um número válido (contém pelo menos um dígito)
        if not re.match(r'^-?\d', formatted):
            return default
        
        return formatted
        
    except (ValueError, OverflowError):
        # Se falhar a conversão, tentar limpar e extrair números
        # Remove tudo exceto dígitos, ponto, sinal negativo e e/E (notação científica)
        cleaned = ''.join(c for c in s_val if c.isdigit() or c in '.-+eE')
        # Se não há dígitos, retornar default
        if not any(c.isdigit() for c in cleaned):
            return default
        
        # Tentar converter novamente
        try:
            float_val = float(cleaned)
            formatted = f"{float_val:.15f}".rstrip('0').rstrip('.')
            if not formatted or formatted == '-':
                return default
            if not re.match(r'^-?\d', formatted):
                return default
            return formatted
        except (ValueError, OverflowError):
            return default


def safe_integer(value: Optional[str], default: str = '0') -> str:
    """Converte valor para integer válido"""
    if value is None:
        return default
    s_val = str(value).strip()
    if not s_val:
        return default
    # Remove tudo exceto dígitos e sinal negativo
    cleaned = ''.join(c for c in s_val if c.isdigit() or c == '-')
    # Remove sinal negativo se não estiver no início
    if cleaned.startswith('-'):
        cleaned = '-' + ''.join(c for c in cleaned[1:] if c.isdigit())
    else:
        cleaned = ''.join(c for c in cleaned if c.isdigit())
    return cleaned if cleaned else default


def generate_xml_from_csv(csv_content: str, mapper: Dict, request_id: str) -> str:
    """
    Gera XML estruturado a partir do CSV transformado
    
    Args:
        csv_content: Conteúdo do CSV como string
        mapper: Dicionário com mapeamento de campos
        request_id: ID da requisição
        
    Returns:
        String XML formatada
    """
    # Validar entrada
    if not csv_content or not isinstance(csv_content, str):
        raise ValueError(f"CSV content must be a non-empty string, got: {type(csv_content)}")
    
    if not mapper or not isinstance(mapper, dict):
        raise ValueError(f"Mapper must be a non-empty dictionary, got: {type(mapper)}")
    
    # Log detalhado ANTES de parsear
    csv_lines_raw = csv_content.split('\n')
    csv_lines_non_empty = [line for line in csv_lines_raw if line.strip()]
    print(f"📊 CSV Analysis BEFORE parsing:")
    print(f"  - Total lines (with empty): {len(csv_lines_raw)}")
    print(f"  - Non-empty lines: {len(csv_lines_non_empty)}")
    print(f"  - CSV content length: {len(csv_content)} characters")
    print(f"  - First 300 chars: {repr(csv_content[:300])}")
    print(f"  - Last 300 chars: {repr(csv_content[-300:])}")
    
    # Parse CSV - FORÇAR leitura de TODAS as linhas, mesmo com erros
    # Usar modo mais permissivo para não parar em linhas problemáticas
    rows = []
    csv_io = io.StringIO(csv_content)
    csv_reader = csv.DictReader(csv_io)
    
    # Ler TODAS as linhas, mesmo que algumas tenham problemas
    row_count = 0
    for row in csv_reader:
        rows.append(row)
        row_count += 1
    
    # Se ainda não tiver todas as linhas, tentar parse manual linha por linha
    if len(rows) < len(csv_lines_non_empty) - 1:
        print(f"⚠ WARNING: csv.DictReader only read {len(rows)} rows, expected {len(csv_lines_non_empty) - 1}")
        print(f"  Attempting manual parsing of remaining lines...")
        
        # Parse manual das linhas restantes
        header = csv_lines_non_empty[0].split(',')
        header = [h.strip().strip('"') for h in header]  # Limpar header
        
        for line_idx, line in enumerate(csv_lines_non_empty[1:], start=2):
            if line_idx > len(rows) + 1:  # +1 porque rows começa depois do header
                try:
                    # Parse manual da linha
                    values = []
                    current_value = ""
                    in_quotes = False
                    
                    for char in line:
                        if char == '"':
                            in_quotes = not in_quotes
                        elif char == ',' and not in_quotes:
                            values.append(current_value.strip())
                            current_value = ""
                        else:
                            current_value += char
                    values.append(current_value.strip())  # Último valor
                    
                    # Criar dict manualmente
                    if len(values) >= len(header):
                        row_dict = {}
                        for i, key in enumerate(header):
                            if i < len(values):
                                row_dict[key] = values[i].strip('"')
                            else:
                                row_dict[key] = ''
                        rows.append(row_dict)
                        print(f"  ✓ Manually parsed row {line_idx}")
                    else:
                        print(f"  ⚠ Row {line_idx} has {len(values)} values, expected {len(header)}")
                except Exception as e:
                    print(f"  ✗ Error parsing row {line_idx} manually: {e}")
                    # Criar linha com valores padrão
                    row_dict = {key: '' for key in header}
                    if len(line.split(',')) > 0:
                        row_dict[header[0]] = line.split(',')[0].strip('"')
                    rows.append(row_dict)
    
    if not rows:
        raise ValueError("CSV has no rows or invalid format")
    
    # Log final
    print(f"✓ CSV parsed: {len(rows)} rows found (final count)")
    if len(rows) != len(csv_lines_non_empty) - 1:
        print(f"⚠ FINAL DISCREPANCY: Expected {len(csv_lines_non_empty) - 1} rows, got {len(rows)}")
    else:
        print(f"✓ All {len(rows)} rows successfully parsed!")
    
    # Criar elemento raiz com hierarquia (conforme exemplo do enunciado)
    root = etree.Element(
        "RelatorioConformidade",
        DataGeracao=datetime.utcnow().strftime("%Y-%m-%d"),
        Versao="1.0"
    )
    
    # Configuração
    config = etree.SubElement(root, "Configuracao")
    config.set("ValidadoPor", f"XML_Service_{request_id[:8]}")
    config.set("Requisitante", f"Processador_{request_id[:8]}")
    
    regulador = etree.SubElement(config, "Regulador")
    regulador.set("Nome", "SEC")
    regulador.set("DataUltimaAtualizacao", datetime.utcnow().strftime("%Y-%m-%d"))
    
    # Ativos
    ativos = etree.SubElement(root, "Ativos")
    
    # Processar cada linha do CSV - PROCESSAR TODAS AS LINHAS SEM FILTROS
    print(f"Processing {len(rows)} rows from CSV to generate XML...")
    processed_count = 0
    
    for idx, row in enumerate(rows):
        # Obter ticker (usar valor padrão se não existir, mas NUNCA pular a linha)
        ticker_key = mapper.get('ticker', 'ticker')
        ticker_val = safe_str(row.get(ticker_key), f'UNKNOWN_{idx + 1}')
        
        ativo_id = f"CSV_{chr(65 + (idx % 26))}{idx + 1:03d}"  # CSV_A001, CSV_B002, etc.
        
        ativo = etree.SubElement(ativos, "Ativo")
        processed_count += 1
        ativo.set("IDInterno", ativo_id)
        
        # Obter valores com fallback seguro (evitar None)
        ticker_key = mapper.get('ticker', 'ticker')
        categoria_key = mapper.get('categoria', 'categoria')
        
        ticker_val = safe_str(row.get(ticker_key), '')
        categoria_val = safe_str(row.get(categoria_key), 'Cryptocurrency')
        
        ativo.set("Ticker", ticker_val)
        ativo.set("Tipo", categoria_val if categoria_val else 'Cryptocurrency')
        
        # Detalhes de negociação (nível hierárquico 1)
        detalhe_negociacao = etree.SubElement(ativo, "Detalhenegociacao")
        
        # PrecoAtual: xs:decimal com atributos Fonte e Moeda
        preco_atual = etree.SubElement(detalhe_negociacao, "PrecoAtual")
        preco_atual.set("Fonte", "CSV")
        preco_atual.set("Moeda", "USD")
        preco_val = safe_decimal(row.get(mapper.get('preco_atual_usd', 'preco_atual_usd'), '0'), '0')
        preco_atual.text = preco_val
        
        # Volume: xs:decimal com atributos Negociado (decimal) e Unidade (string)
        volume = etree.SubElement(detalhe_negociacao, "Volume")
        volume_negociado = safe_decimal(row.get(mapper.get('total_volume_24h_usd', 'total_volume_24h_usd'), '0'), '0')
        volume.set("Negociado", volume_negociado)
        volume.set("Unidade", "USD")
        volume.text = volume_negociado
        
        # Variacao24h: apenas atributos Pct e USD (decimal), sem conteúdo de texto
        variacao = etree.SubElement(detalhe_negociacao, "Variacao24h")
        variacao_pct = safe_decimal(row.get(mapper.get('variacao_24h_pct', 'variacao_24h_pct'), '0'), '0')
        variacao_usd = safe_decimal(row.get(mapper.get('variacao_24h_usd', 'variacao_24h_usd'), '0'), '0')
        variacao.set("Pct", variacao_pct)
        variacao.set("USD", variacao_usd)
        # Não definir texto para Variacao24h (conforme XSD)
        
        # Histórico API (nível hierárquico 1 - dados enriquecidos)
        historico_api = etree.SubElement(ativo, "HistoricoAPI")
        
        nome = etree.SubElement(historico_api, "Nome")
        nome_key = mapper.get('nome', 'nome')
        nome_val = safe_str(row.get(nome_key)) or safe_str(row.get(mapper.get('ticker', 'ticker')))
        nome.text = nome_val
        
        # Rank: xs:integer
        rank = etree.SubElement(historico_api, "Rank")
        rank_val = safe_integer(row.get(mapper.get('rank', 'rank'), '0'), '0')
        rank.text = rank_val
        
        # MarketCap: xs:decimal com atributo Moeda
        market_cap = etree.SubElement(historico_api, "MarketCap")
        market_cap.set("Moeda", "USD")
        market_cap_val = safe_decimal(row.get(mapper.get('market_cap_usd', 'market_cap_usd'), '0'), '0')
        market_cap.text = market_cap_val
        
        # Supply: xs:decimal
        supply = etree.SubElement(historico_api, "Supply")
        supply_val = safe_decimal(row.get(mapper.get('circulating_supply', 'circulating_supply'), '0'), '0')
        supply.text = supply_val
        
        data_observacao = etree.SubElement(historico_api, "DataObservacao")
        data_obs_val = safe_str(row.get(mapper.get('data_observacao_utc', 'data_observacao_utc'), ''), '')
        data_observacao.text = data_obs_val
    
    # Log final
    print(f"✓ XML generation complete: {processed_count} ativos processed from {len(rows)} CSV rows")
    
    # Gerar XML como string formatada
    try:
        # Usar encoding UTF-8 (bytes) para poder incluir XML declaration
        xml_bytes = etree.tostring(
            root,
            encoding='UTF-8',
            pretty_print=True,
            xml_declaration=True
        )
        
        if not xml_bytes:
            raise ValueError("etree.tostring returned empty value")
        
        # Converter bytes para string UTF-8
        xml_string = xml_bytes.decode('utf-8')
        
        if not xml_string or not isinstance(xml_string, str):
            raise ValueError(f"Failed to decode XML: {type(xml_string)}")
        
        return xml_string
    except Exception as e:
        print(f"✗ Error in etree.tostring: {e}")
        import traceback
        traceback.print_exc()
        raise ValueError(f"Failed to convert XML tree to string: {str(e)}") from e


def get_mapper_version(mapper: Dict) -> str:
    """Obtém versão do mapper"""
    # Versão baseada no número de campos mapeados
    return f"v1.0-{len(mapper)}fields"
