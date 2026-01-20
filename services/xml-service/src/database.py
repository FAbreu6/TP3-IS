"""Módulo de acesso ao banco de dados PostgreSQL"""

import os
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Optional, List, Dict
from datetime import datetime
from urllib.parse import urlparse
from models import XMLDocument
from lxml import etree


class Database:
    """Classe para gerenciar conexões e operações no PostgreSQL"""
    
    def __init__(self):
        self.conn = None
        self.cursor = None
        
    def connect(self):
        """Conecta ao banco de dados"""
        database_url = os.getenv('DATABASE_URL')
        if not database_url:
            # Fallback para variáveis individuais
            database_url = (
                f"postgresql://{os.getenv('DB_USER', 'postgres')}:"
                f"{os.getenv('DB_PASSWORD', 'postgres')}@"
                f"{os.getenv('DB_HOST', 'postgres')}:"
                f"{os.getenv('DB_PORT', '5432')}/"
                f"{os.getenv('DB_NAME', 'tp3_xml')}"
            )
        
        try:
            # Para Supabase, usar parâmetros explícitos
            # Detectar tanto conexão direta (db.*.supabase.co) quanto pooler (*.pooler.supabase.com)
            if 'supabase.co' in database_url or 'pooler.supabase.com' in database_url:
                # Parse da URL (decodificar %21 de volta para !)
                parsed = urlparse(database_url.replace('%21', '!'))
                
                # Extrair componentes da URL
                hostname = parsed.hostname
                port = parsed.port or 5432
                user = parsed.username
                password = parsed.password
                database = parsed.path.lstrip('/')
                
                print(f"Connecting to Supabase PostgreSQL: {hostname}:{port}/{database}")
                print(f"User: {user}, Database: {database}")
                
                # Supabase requer SSL e pode ter problemas com IPv6
                # Tentar conectar com SSL obrigatório
                try:
                    self.conn = psycopg2.connect(
                        host=hostname,
                        port=port,
                        user=user,
                        password=password,
                        database=database,
                        connect_timeout=15,
                        sslmode='require'  # SSL obrigatório para Supabase
                    )
                except Exception as first_error:
                    print(f"⚠ Connection with SSL failed: {first_error}")
                    print("⚠ IMPORTANT: Supabase direct connection uses IPv6 by default")
                    print("⚠ Solution: Use Supabase Session Pooler (IPv4) instead")
                    print("⚠ Get it from: Supabase Dashboard → Settings → Database → Connection Pooling")
                    print("⚠ Format: postgresql://postgres:[PASSWORD]@[PROJECT-REF].pooler.supabase.com:5432/postgres")
                    raise first_error
            else:
                # Conexão normal para PostgreSQL local
                self.conn = psycopg2.connect(database_url)
            
            self.cursor = self.conn.cursor(cursor_factory=RealDictCursor)
            self.conn.autocommit = False
            print("✓ Connected to PostgreSQL database")
        except Exception as e:
            print(f"✗ Error connecting to database: {e}")
            raise
    
    def close(self):
        """Fecha a conexão com o banco de dados"""
        if self.cursor:
            self.cursor.close()
        if self.conn:
            self.conn.close()
    def _ensure_clean_transaction(self):
        """Garante que não há transações em erro pendentes"""
        try:
            if self.conn.status != 0:  # STATUS_READY = 0
                self.conn.rollback()
        except:
            try:
                self.conn.rollback()
            except:
                pass

    
    def init_schema(self):
        """Inicializa o schema do banco de dados"""
        create_table_sql = """
        CREATE TABLE IF NOT EXISTS xml_documents (
            id SERIAL PRIMARY KEY,
            xml_documento XML NOT NULL,
            data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            mapper_version VARCHAR(50),
            request_id VARCHAR(255) UNIQUE,
            status VARCHAR(50)
        );
        
        CREATE INDEX IF NOT EXISTS idx_request_id ON xml_documents(request_id);
        CREATE INDEX IF NOT EXISTS idx_data_criacao ON xml_documents(data_criacao);
        """
        
        try:
            self.cursor.execute(create_table_sql)
            self.conn.commit()
            print("✓ Database schema initialized")
        except Exception as e:
            self.conn.rollback()
            print(f"✗ Error initializing schema: {e}")
            raise
    
    def insert_xml_document(
        self,
        xml_content: str,
        mapper_version: str,
        request_id: str,
        status: str = 'OK'
    ) -> int:
        """Insere um documento XML no banco de dados"""
        insert_sql = """
        INSERT INTO xml_documents (xml_documento, mapper_version, request_id, status)
        VALUES (%s, %s, %s, %s)
        RETURNING id;
        """
        
        try:
            self.cursor.execute(insert_sql, (xml_content, mapper_version, request_id, status))
            result = self.cursor.fetchone()
            self.conn.commit()
            document_id = result['id']
            print(f"✓ XML document inserted with ID: {document_id}")
            return document_id
        except Exception as e:
            self.conn.rollback()
            print(f"✗ Error inserting XML document: {e}")
            raise
    
    def get_xml_document_by_id(self, document_id: int) -> Optional[XMLDocument]:
        """Obtém um documento XML por ID"""
        select_sql = """
        SELECT id, xml_documento::text as xml_documento, data_criacao, 
               mapper_version, request_id, status
        FROM xml_documents
        WHERE id = %s;
        """
        
        try:
            self.cursor.execute(select_sql, (document_id,))
            result = self.cursor.fetchone()
            if result:
                return XMLDocument(
                    id=result['id'],
                    xml_documento=result['xml_documento'],
                    data_criacao=result['data_criacao'],
                    mapper_version=result['mapper_version'],
                    request_id=result['request_id'],
                    status=result['status']
                )
            return None
        except Exception as e:
            print(f"✗ Error getting XML document: {e}")
            raise
    
    def get_latest_xml_document(self) -> Optional[XMLDocument]:
        """Obtém o documento XML mais recente (último criado)"""
        select_sql = """
        SELECT id, xml_documento::text as xml_documento, data_criacao, 
               mapper_version, request_id, status
        FROM xml_documents
        WHERE status = 'OK'
        ORDER BY data_criacao DESC
        LIMIT 1;
        """
        
        try:
            self._ensure_clean_transaction()

            self.cursor.execute(select_sql)
            result = self.cursor.fetchone()
            self.conn.commit()
            if result:
                return XMLDocument(
                    id=result['id'],
                    xml_documento=result['xml_documento'],
                    data_criacao=result['data_criacao'],
                    mapper_version=result['mapper_version'],
                    request_id=result['request_id'],
                    status=result['status']
                )
            return None
        except Exception as e:
            try:
                self.conn.rollback()
            except:
                pass

            print(f"✗ Error getting latest XML document: {e}")
            raise
    
    def get_all_ativos_from_latest_xml(self) -> List[Dict]:
        """Obtém todos os ativos do último documento XML com todas as informações"""
        latest_doc = self.get_latest_xml_document()
        if not latest_doc:
            return []
        
        try:
            # Usar XPath para extrair todos os ativos usando generate_series para indexar
            # Isso garante que todos os arrays sejam alinhados corretamente
            query = """
            WITH latest_xml AS (
                SELECT xml_documento, id, request_id, data_criacao
                FROM xml_documents
                WHERE id = %s
            ),
            ativos_array AS (
                SELECT 
                    xpath('//Ativo/@Ticker', xml_documento) as tickers,
                    xpath('//Ativo/@Tipo', xml_documento) as tipos,
                    xpath('//Ativo/Detalhenegociacao/PrecoAtual/text()', xml_documento) as precos,
                    xpath('//Ativo/Detalhenegociacao/Volume/text()', xml_documento) as volumes,
                    xpath('//Ativo/Detalhenegociacao/Variacao24h/@Pct', xml_documento) as variacoes_pct,
                    xpath('//Ativo/Detalhenegociacao/Variacao24h/@USD', xml_documento) as variacoes_usd,
                    xpath('//Ativo/HistoricoAPI/Nome/text()', xml_documento) as nomes,
                    xpath('//Ativo/HistoricoAPI/Rank/text()', xml_documento) as ranks,
                    xpath('//Ativo/HistoricoAPI/MarketCap/text()', xml_documento) as market_caps,
                    xpath('//Ativo/HistoricoAPI/Supply/text()', xml_documento) as supplies,
                    xpath('//Ativo/HistoricoAPI/DataObservacao/text()', xml_documento) as datas_obs,
                    request_id,
                    data_criacao
                FROM latest_xml
            )
            SELECT 
                (tickers[i])::text as ticker,
                (tipos[i])::text as tipo,
                (precos[i])::text as preco_atual,
                (volumes[i])::text as volume,
                (variacoes_pct[i])::text as variacao_pct,
                (variacoes_usd[i])::text as variacao_usd,
                (nomes[i])::text as nome,
                (ranks[i])::text as rank,
                (market_caps[i])::text as market_cap,
                (supplies[i])::text as supply,
                (datas_obs[i])::text as data_observacao,
                request_id,
                data_criacao
            FROM ativos_array,
            generate_series(1, array_length(tickers, 1)) as i;
            """
            
            self._ensure_clean_transaction()
            self.cursor.execute(query, (latest_doc.id,))
            results = self.cursor.fetchall()
            self.conn.commit()
            
            # Processar resultados e limpar valores
            ativos = []
            for row in results:
                # Limpar valores (remover aspas, espaços, etc)
                def clean_value(val):
                    if not val:
                        return ''
                    val = str(val).strip()
                    if val.startswith('"') and val.endswith('"'):
                        val = val[1:-1]
                    elif val.startswith("'") and val.endswith("'"):
                        val = val[1:-1]
                    return val
                
                ativo = {
                    'ticker': clean_value(row.get('ticker', '')),
                    'tipo': clean_value(row.get('tipo', 'Cryptocurrency')),
                    'preco_atual': clean_value(row.get('preco_atual', '0')),
                    'volume': clean_value(row.get('volume', '0')),
                    'variacao_24h_pct': clean_value(row.get('variacao_pct', '0')),
                    'variacao_24h_usd': clean_value(row.get('variacao_usd', '0')),
                    'nome': clean_value(row.get('nome', '')),
                    'rank': clean_value(row.get('rank', '0')),
                    'market_cap': clean_value(row.get('market_cap', '0')),
                    'supply': clean_value(row.get('supply', '0')),
                    'data_observacao': clean_value(row.get('data_observacao', '')),
                    'request_id': row.get('request_id', latest_doc.request_id),
                    'data_criacao': row.get('data_criacao').isoformat() if row.get('data_criacao') else (latest_doc.data_criacao.isoformat() if latest_doc.data_criacao else '')
                }
                
                # Só adicionar se tiver ticker
                if ativo['ticker']:
                    ativos.append(ativo)
            
            return ativos
        except Exception as e:
            try:
                self.conn.rollback()
            except:
                pass

            print(f"✗ Error getting all ativos from latest XML: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    def query_xpath(self, xpath_query: str, filters: Optional[Dict] = None) -> List[Dict]:
        """
        Consulta XML usando XPath
        Retorna resultados como lista de dicionários
        Usa unnest para retornar TODOS os resultados, não apenas o primeiro
        """
        # Construir query SQL com XPath
        # PostgreSQL suporta xpath() para consultas XML
        # Usamos unnest para expandir todos os resultados de cada documento
        base_query = """
        SELECT 
            doc.id,
            unnest(xpath(%s, doc.xml_documento))::text as result,
            doc.data_criacao,
            doc.request_id
        FROM xml_documents doc
        WHERE 1=1
        """
        
        params = [xpath_query]
        
        # Adicionar filtros se fornecidos
        if filters:
            if 'start_date' in filters and filters['start_date']:
                # Converter string de data para timestamp (início do dia)
                base_query += " AND doc.data_criacao >= %s::timestamp"
                start_date_str = filters['start_date']
                # Se for apenas data (YYYY-MM-DD), adicionar hora 00:00:00
                if len(start_date_str) == 10:
                    start_date_str += ' 00:00:00'
                params.append(start_date_str)
            if 'end_date' in filters and filters['end_date']:
                # Converter string de data para timestamp (fim do dia)
                base_query += " AND doc.data_criacao <= %s::timestamp"
                end_date_str = filters['end_date']
                # Se for apenas data (YYYY-MM-DD), adicionar hora 23:59:59
                if len(end_date_str) == 10:
                    end_date_str += ' 23:59:59'
                params.append(end_date_str)
            if 'status' in filters:
                base_query += " AND doc.status = %s"
                params.append(filters['status'])
        
        base_query += " ORDER BY doc.data_criacao DESC;"
        
        try:
            self._ensure_clean_transaction()

            self.cursor.execute(base_query, params)
            results = self.cursor.fetchall()
            self.conn.commit()
            # Filtrar resultados vazios e limpar strings XML
            cleaned_results = []
            for row in results:
                result_text = row.get('result', '')
                if result_text:
                    # Remover tags XML se houver e limpar espaços
                    result_text = result_text.strip()
                    # Se for um atributo, pode vir como "ticker" ou 'ticker', remover aspas
                    if result_text.startswith('"') and result_text.endswith('"'):
                        result_text = result_text[1:-1]
                    elif result_text.startswith("'") and result_text.endswith("'"):
                        result_text = result_text[1:-1]
                    cleaned_results.append({
                        'id': row.get('id', 0),
                        'result': result_text,
                        'request_id': row.get('request_id', ''),
                        'data_criacao': row.get('data_criacao')
                    })
            return cleaned_results
        except Exception as e:
            try:
                self.conn.rollback()
            except:
                pass

            print(f"✗ Error executing XPath query: {e}")
            raise
    
    def aggregate_xpath(self, xpath_query: str, aggregate_func: str = 'count') -> Dict:
        """
        Agrega resultados de uma consulta XPath (apenas do último XML)
        aggregate_func pode ser: count, sum, avg, min, max
        
        Nota: Se o XPath não terminar com /text() ou @, adiciona automaticamente /text() para extrair apenas o texto
        """
        # Se o XPath não terminar com /text() ou @ (atributo), adicionar /text() para extrair apenas o texto
        normalized_query = xpath_query.strip()
        if not normalized_query.endswith('/text()') and '@' not in normalized_query.split('/')[-1]:
            # Adicionar /text() no final para extrair apenas o texto do elemento
            normalized_query = normalized_query + '/text()'
        
        # Usar apenas o último XML (como getAllTickers)
        query = f"""
        WITH latest_xml AS (
            SELECT xml_documento, id
            FROM xml_documents
            WHERE status = 'OK'
            ORDER BY data_criacao DESC
            LIMIT 1
        )
        SELECT 
            {aggregate_func}((unnest(xpath(%s, xml_documento))::text)::numeric) as result
        FROM latest_xml;
        """
        
        try:
            self._ensure_clean_transaction()

            self.cursor.execute(query, (normalized_query,))
            result = self.cursor.fetchone()
            self.conn.commit()
            if result and result.get('result') is not None:
                return {'result': str(result.get('result'))}
            else:
                return {'result': '0'}
        except Exception as e:
            try:
                self.conn.rollback()
            except:
                pass

            print(f"✗ Error executing aggregate XPath query: {e}")
            print(f"  XPath query: {normalized_query}")
            print(f"  Aggregate func: {aggregate_func}")
            import traceback
            traceback.print_exc()
            # Retornar 0 em caso de erro em vez de lançar exceção
            return {'result': '0'}
    
    def get_top_marketcap_latest(self, limit: int = 10, tipo: Optional[str] = None) -> List[Dict]:
        """
        Obtém os top N ativos por market cap do último XML válido usando XPath puro.
        Retorna dados estruturados: { ticker, nome, tipo, market_cap }
        Ordenado por market_cap DESC.
        """
        # Obter o último XML válido
        latest_doc = self.get_latest_xml_document()
        if not latest_doc:
            return []
        
        try:
            # Parse do XML usando lxml
            root = etree.fromstring(latest_doc.xml_documento.encode('utf-8'))
            
            # XPath para selecionar todos os ativos
            ativos_xpath = '/RelatorioConformidade/Ativos/Ativo'
            ativos_nodes = root.xpath(ativos_xpath)
            
            # Extrair dados de cada ativo usando XPath relativo
            ativos = []
            for ativo_node in ativos_nodes:
                # XPath relativo a partir do nó Ativo
                ticker = ativo_node.get('Ticker', '').strip()
                tipo_ativo = ativo_node.get('Tipo', 'Cryptocurrency').strip() or 'Cryptocurrency'
                
                # Filtrar por tipo se especificado
                if tipo and tipo_ativo != tipo:
                    continue
                
                # XPath relativo para extrair nome
                nome_nodes = ativo_node.xpath('HistoricoAPI/Nome/text()')
                nome = nome_nodes[0].strip() if nome_nodes else ''
                
                # XPath relativo para extrair market cap
                market_cap_nodes = ativo_node.xpath('HistoricoAPI/MarketCap/text()')
                market_cap_str = market_cap_nodes[0].strip() if market_cap_nodes else '0'
                
                # Validar que tem ticker e market cap
                if not ticker or not market_cap_str:
                    continue
                
                # Converter market cap para float
                try:
                    market_cap = float(market_cap_str)
                except (ValueError, TypeError):
                    market_cap = 0.0
                
                ativo = {
                    'ticker': ticker,
                    'nome': nome,
                    'tipo': tipo_ativo,
                    'market_cap': market_cap
                }
                ativos.append(ativo)
            
            # Ordenar por market cap DESC e limitar
            ativos.sort(key=lambda x: x['market_cap'], reverse=True)
            return ativos[:limit]
        except Exception as e:
            print(f"✗ Error getting top marketcap: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    def get_stats_by_tipo_latest(self) -> List[Dict]:
        """
        Obtém estatísticas agregadas por tipo de ativo do último XML válido usando XPath puro.
        Retorna: { tipo, total_ativos, avg_preco, total_volume, avg_variacao_pct }
        """
        # Obter o último XML válido
        latest_doc = self.get_latest_xml_document()
        if not latest_doc:
            return []
        
        try:
            # Parse do XML usando lxml
            root = etree.fromstring(latest_doc.xml_documento.encode('utf-8'))
            
            # XPath para selecionar todos os ativos
            ativos_xpath = '/RelatorioConformidade/Ativos/Ativo'
            ativos_nodes = root.xpath(ativos_xpath)
            
            # Agrupar dados por tipo
            stats_by_tipo = {}
            
            for ativo_node in ativos_nodes:
                # XPath relativo para extrair tipo
                tipo = ativo_node.get('Tipo', 'Cryptocurrency').strip() or 'Cryptocurrency'
                
                # Inicializar contador para este tipo se não existir
                if tipo not in stats_by_tipo:
                    stats_by_tipo[tipo] = {
                        'count': 0,
                        'precos': [],
                        'volumes': [],
                        'variacoes_pct': []
                    }
                stats_by_tipo[tipo]['count'] += 1
                
                # XPath relativo para extrair preço atual
                preco_nodes = ativo_node.xpath('Detalhenegociacao/PrecoAtual/text()')
                if preco_nodes:
                    try:
                        preco = float(preco_nodes[0].strip())
                        stats_by_tipo[tipo]['precos'].append(preco)
                    except (ValueError, TypeError):
                        pass
                
                # XPath relativo para extrair volume
                volume_nodes = ativo_node.xpath('Detalhenegociacao/Volume/@Negociado')
                if volume_nodes:
                    try:
                        volume = float(volume_nodes[0].strip())
                        stats_by_tipo[tipo]['volumes'].append(volume)
                    except (ValueError, TypeError):
                        pass
                
                # XPath relativo para extrair variação percentual
                variacao_nodes = ativo_node.xpath('Detalhenegociacao/Variacao24h/@Pct')
                if variacao_nodes:
                    try:
                        variacao = float(variacao_nodes[0].strip())
                        stats_by_tipo[tipo]['variacoes_pct'].append(variacao)
                    except (ValueError, TypeError):
                        pass
            
            # Calcular estatísticas agregadas por tipo
            stats = []
            for tipo, dados in stats_by_tipo.items():
                total_ativos = dados.get('count', 0)
                
                avg_preco = sum(dados['precos']) / len(dados['precos']) if dados['precos'] else 0.0
                total_volume = sum(dados['volumes']) if dados['volumes'] else 0.0
                avg_variacao_pct = sum(dados['variacoes_pct']) / len(dados['variacoes_pct']) if dados['variacoes_pct'] else 0.0
                
                stat = {
                    'tipo': tipo,
                    'total_ativos': total_ativos,
                    'avg_preco': avg_preco,
                    'total_volume': total_volume,
                    'avg_variacao_pct': avg_variacao_pct
                }
                stats.append(stat)
            
            # Ordenar por total_ativos DESC
            stats.sort(key=lambda x: x['total_ativos'], reverse=True)
            return stats
        except Exception as e:
            print(f"✗ Error getting stats by tipo: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    def get_movers_latest(self, limit: int = 10, direction: str = 'up') -> List[Dict]:
        """
        Obtém top gainers (direction='up') ou losers (direction='down') do último XML válido usando XPath puro.
        Retorna: { ticker, nome, preco_atual, variacao_pct }
        """
        if direction not in ['up', 'down']:
            direction = 'up'
        
        # Obter o último XML válido
        latest_doc = self.get_latest_xml_document()
        if not latest_doc:
            return []
        
        try:
            # Parse do XML usando lxml
            root = etree.fromstring(latest_doc.xml_documento.encode('utf-8'))
            
            # XPath para selecionar ativos com variação disponível
            # Filtra apenas ativos que têm Detalhenegociacao/Variacao24h/@Pct
            ativos_xpath = '/RelatorioConformidade/Ativos/Ativo[Detalhenegociacao/Variacao24h/@Pct]'
            ativos_nodes = root.xpath(ativos_xpath)
            
            # Extrair dados de cada ativo usando XPath relativo
            movers = []
            for ativo_node in ativos_nodes:
                # XPath relativo para extrair ticker
                ticker = ativo_node.get('Ticker', '').strip()
                if not ticker:
                    continue
                
                # XPath relativo para extrair nome
                nome_nodes = ativo_node.xpath('HistoricoAPI/Nome/text()')
                nome = nome_nodes[0].strip() if nome_nodes else ''
                
                # XPath relativo para extrair preço atual
                preco_nodes = ativo_node.xpath('Detalhenegociacao/PrecoAtual/text()')
                preco_str = preco_nodes[0].strip() if preco_nodes else '0'
                try:
                    preco = float(preco_str)
                except (ValueError, TypeError):
                    preco = 0.0
                
                # XPath relativo para extrair variação percentual
                variacao_nodes = ativo_node.xpath('Detalhenegociacao/Variacao24h/@Pct')
                if not variacao_nodes:
                    continue
                
                variacao_str = variacao_nodes[0].strip() if variacao_nodes else '0'
                try:
                    variacao = float(variacao_str)
                except (ValueError, TypeError):
                    continue
                
                mover = {
                    'ticker': ticker,
                    'nome': nome,
                    'preco_atual': preco,
                    'variacao_pct': variacao
                }
                movers.append(mover)
            
            # Ordenar por variação
            # DESC para gainers (maior variação primeiro)
            # ASC para losers (menor variação primeiro)
            reverse = (direction == 'up')
            movers.sort(key=lambda x: x['variacao_pct'], reverse=reverse)
            
            return movers[:limit]
        except Exception as e:
            print(f"✗ Error getting movers: {e}")
            import traceback
            traceback.print_exc()
            raise