"""Servidor Flask principal do XML Service"""

import os
import json
import threading
import sys
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from models import ProcessRequest, WebhookNotification
from database import Database
from xml_generator import generate_xml_from_csv, get_mapper_version
from xml_validator import validate_xml
import requests

# Importar módulos de socket e gRPC (tentativa)
try:
    from socket_server import start_socket_server
except ImportError:
    print("⚠ socket_server module not found")
    start_socket_server = None

try:
    from grpc_server import serve as grpc_serve
except ImportError:
    print("⚠ grpc_server module not found (proto files may not be generated)")
    grpc_serve = None

# Carregar variáveis de ambiente
load_dotenv()

app = Flask(__name__)
CORS(app)

# Instância do banco de dados
db = Database()


def process_csv_async(request_data: ProcessRequest):
    """
    Processa CSV de forma assíncrona:
    1. Gera XML
    2. Valida XML
    3. Salva no DB
    4. Envia webhook
    """
    request_id = request_data.request_id
    webhook_url = request_data.webhook_url
    mapper = request_data.mapper
    csv_content = request_data.csv_content
    
    try:
        print(f"\n{'='*60}")
        print(f"Processing request: {request_id}")
        print(f"{'='*60}")
        
        # 1. Gerar XML
        print("Step 1: Generating XML from CSV...")
        xml_content = generate_xml_from_csv(csv_content, mapper, request_id)
        mapper_version = get_mapper_version(mapper)
        
        print(f"✓ XML generated ({len(xml_content)} bytes)")
        print(f"  Mapper version: {mapper_version}")
        
        # 2. Validar XML
        print("\nStep 2: Validating XML...")
        is_valid, error_message = validate_xml(xml_content)
        
        if not is_valid:
            print(f"✗ XML validation failed: {error_message}")
            # Enviar webhook com erro de validação
            send_webhook(webhook_url, request_id, "ERRO_VALIDACAO", None, error_message)
            return
        
        print("✓ XML validation passed")
        
        # 3. Salvar no banco de dados
        print("\nStep 3: Saving XML to database...")
        try:
            document_id = db.insert_xml_document(
                xml_content=xml_content,
                mapper_version=mapper_version,
                request_id=request_id,
                status="OK"
            )
            print(f"✓ XML saved to database (ID: {document_id})")
            
            # 4. Enviar webhook com sucesso
            send_webhook(webhook_url, request_id, "OK", document_id)
            
        except Exception as db_error:
            print(f"✗ Database error: {db_error}")
            # Enviar webhook com erro de persistência
            send_webhook(webhook_url, request_id, "ERRO_PERSISTENCIA", None, str(db_error))
            
    except Exception as e:
        print(f"✗ Processing error: {e}")
        # Enviar webhook com erro geral
        send_webhook(webhook_url, request_id, "ERRO_VALIDACAO", None, str(e))


def send_webhook(webhook_url: str, request_id: str, status: str, document_id: int = None, error_message: str = None):
    """
    Envia notificação webhook para o Processor
    """
    payload = {
        "ID_Requisicao": request_id,
        "Status": status
    }
    
    if document_id:
        payload["ID_Documento"] = document_id
    
    if error_message:
        payload["Mensagem"] = error_message
    
    try:
        print(f"\nSending webhook to: {webhook_url}")
        print(f"Payload: {json.dumps(payload, indent=2)}")
        
        response = requests.post(
            webhook_url,
            json=payload,
            headers={'Content-Type': 'application/json'},
            timeout=10
        )
        
        if response.status_code == 200:
            print("✓ Webhook sent successfully")
        else:
            print(f"⚠ Webhook returned status {response.status_code}: {response.text}")
            
    except Exception as e:
        print(f"✗ Error sending webhook: {e}")
        # Não lançar exceção - webhook é notificação, não deve bloquear


@app.route('/health', methods=['GET'])
def health():
    """Endpoint de health check"""
    return jsonify({"status": "healthy", "service": "xml-service"}), 200


@app.route('/api/upload', methods=['POST'])
def upload_csv():
    """
    Endpoint para receber CSV via multipart/form-data
    Protocolo B: Multipart-Form (binário)
    """
    try:
        # Validar que todos os campos estão presentes
        if 'requestId' not in request.form:
            return jsonify({"error": "requestId is required"}), 400
        
        if 'mapper' not in request.form:
            return jsonify({"error": "mapper is required"}), 400
        
        if 'webhookUrl' not in request.form:
            return jsonify({"error": "webhookUrl is required"}), 400
        
        if 'csv' not in request.files:
            return jsonify({"error": "csv file is required"}), 400
        
        # Extrair dados do form
        request_id = request.form['requestId']
        mapper_json = request.form['mapper']
        webhook_url = request.form['webhookUrl']
        csv_file = request.files['csv']
        
        # Parse mapper JSON
        try:
            mapper = json.loads(mapper_json)
        except json.JSONDecodeError:
            return jsonify({"error": "Invalid mapper JSON"}), 400
        
        # Ler conteúdo do CSV
        csv_content = csv_file.read().decode('utf-8')
        
        # Criar objeto de requisição
        process_request = ProcessRequest(
            request_id=request_id,
            mapper=mapper,
            webhook_url=webhook_url,
            csv_content=csv_content
        )
        
        print(f"\n{'='*60}")
        print("New CSV upload received")
        print(f"{'='*60}")
        print(f"Request ID: {request_id}")
        print(f"Webhook URL: {webhook_url}")
        print(f"CSV size: {len(csv_content)} bytes")
        print(f"Mapper fields: {len(mapper)}")
        
        # Processar de forma assíncrona em thread separada
        thread = threading.Thread(target=process_csv_async, args=(process_request,))
        thread.daemon = True
        thread.start()
        
        # Retornar resposta imediata
        return jsonify({
            "accepted": True,
            "requestId": request_id,
            "message": "Request accepted for processing"
        }), 202  # 202 Accepted
        
    except Exception as e:
        print(f"✗ Error in upload endpoint: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/documents/<int:document_id>', methods=['GET'])
def get_document(document_id: int):
    """Endpoint REST para obter documento XML por ID"""
    try:
        document = db.get_xml_document_by_id(document_id)
        if document:
            return jsonify({
                "id": document.id,
                "request_id": document.request_id,
                "status": document.status,
                "mapper_version": document.mapper_version,
                "data_criacao": document.data_criacao.isoformat(),
                "xml_documento": document.xml_documento
            }), 200
        else:
            return jsonify({"error": "Document not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/latest/ativos', methods=['GET'])
def get_latest_ativos():
    """Endpoint REST para obter todos os ativos do último XML criado com todas as informações"""
    try:
        ativos = db.get_all_ativos_from_latest_xml()
        return jsonify({
            "success": True,
            "count": len(ativos),
            "ativos": ativos
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/latest/xml', methods=['GET'])
def get_latest_xml():
    """Endpoint REST para obter o último documento XML válido completo"""
    try:
        document = db.get_latest_xml_document()
        if document:
            return jsonify({
                "success": True,
                "id": document.id,
                "request_id": document.request_id,
                "status": document.status,
                "mapper_version": document.mapper_version,
                "data_criacao": document.data_criacao.isoformat(),
                "xml_documento": document.xml_documento
            }), 200
        else:
            return jsonify({
                "success": False,
                "error": "No valid XML document found"
            }), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/xpath/query', methods=['GET'])
def query_xpath():
    """Endpoint REST para consultas XPath (para BI Service)"""
    try:
        xpath_query = request.args.get('xpath_query')
        if not xpath_query:
            return jsonify({"error": "xpath_query parameter is required"}), 400
        
        filters = {}
        if request.args.get('start_date'):
            filters['start_date'] = request.args.get('start_date')
        if request.args.get('end_date'):
            filters['end_date'] = request.args.get('end_date')
        if request.args.get('status'):
            filters['status'] = request.args.get('status')
        else:
            filters['status'] = 'OK'  # Padrão
        
        results = db.query_xpath(xpath_query, filters if filters else None)
        
        return jsonify({
            "success": True,
            "count": len(results),
            "results": [
                {
                    "id": r.get('id', 0),
                    "result": r.get('result', ''),
                    "request_id": r.get('request_id', ''),
                    "data_criacao": r.get('data_criacao').isoformat() if r.get('data_criacao') else ''
                }
                for r in results
            ]
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/xpath/aggregate', methods=['GET'])
def aggregate_xpath():
    """Endpoint REST para agregações XPath (para BI Service)"""
    try:
        xpath_query = request.args.get('xpath_query')
        if not xpath_query:
            return jsonify({"error": "xpath_query parameter is required"}), 400
        
        aggregate_func = request.args.get('aggregate_func', 'count')
        
        result = db.aggregate_xpath(xpath_query, aggregate_func)
        
        return jsonify({
            "success": True,
            "result": result.get('result', '0'),
            "aggregate_func": aggregate_func
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/query/top-marketcap', methods=['GET'])
def get_top_marketcap():
    """
    Endpoint REST para obter top N ativos por market cap.
    Query params:
    - limit: número de resultados (padrão: 10)
    - tipo: filtrar por tipo de ativo (opcional, ex: 'Cryptocurrency')
    """
    try:
        limit = int(request.args.get('limit', 10))
        tipo = request.args.get('tipo', None)
        
        if limit < 1 or limit > 100:
            return jsonify({"error": "limit must be between 1 and 100"}), 400
        
        results = db.get_top_marketcap_latest(limit=limit, tipo=tipo)
        
        return jsonify({
            "success": True,
            "count": len(results),
            "data": results
        }), 200
    except ValueError:
        return jsonify({"error": "Invalid limit parameter"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/query/stats-by-tipo', methods=['GET'])
def get_stats_by_tipo():
    """
    Endpoint REST para obter estatísticas agregadas por tipo de ativo.
    Retorna: total_ativos, avg_preco, total_volume, avg_variacao_pct por tipo
    """
    try:
        results = db.get_stats_by_tipo_latest()
        
        return jsonify({
            "success": True,
            "count": len(results),
            "data": results
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/query/movers', methods=['GET'])
def get_movers():
    """
    Endpoint REST para obter top gainers ou losers.
    Query params:
    - limit: número de resultados (padrão: 10)
    - direction: 'up' para gainers, 'down' para losers (padrão: 'up')
    """
    try:
        limit = int(request.args.get('limit', 10))
        direction = request.args.get('direction', 'up').lower()
        
        if limit < 1 or limit > 100:
            return jsonify({"error": "limit must be between 1 and 100"}), 400
        
        if direction not in ['up', 'down']:
            return jsonify({"error": "direction must be 'up' or 'down'"}), 400
        
        results = db.get_movers_latest(limit=limit, direction=direction)
        
        return jsonify({
            "success": True,
            "count": len(results),
            "direction": direction,
            "data": results
        }), 200
    except ValueError:
        return jsonify({"error": "Invalid limit parameter"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def init_database():
    """Inicializa banco de dados"""
    try:
        db.connect()
        db.init_schema()
    except Exception as e:
        print(f"✗ Database initialization error: {e}")
        raise


if __name__ == '__main__':
    import threading
    
    # Inicializar banco de dados
    init_database()
    
    # Iniciar servidor TCP Socket em thread separada
    socket_port = int(os.getenv('SOCKET_PORT', 7000))
    if start_socket_server:
        socket_thread = threading.Thread(
            target=start_socket_server,
            args=(db, socket_port),
            daemon=True
        )
        socket_thread.start()
        print(f"✓ TCP Socket Server started on port {socket_port} (NON-HTTP)")
    else:
        print("⚠ TCP Socket Server not started (module not found)")
    
    # Iniciar servidor gRPC em thread separada
    if grpc_serve:
        grpc_port = int(os.getenv('GRPC_PORT', 50051))
        grpc_thread = threading.Thread(
            target=grpc_serve,
            daemon=True
        )
        grpc_thread.start()
        print(f"✓ gRPC Server started on port {grpc_port}")
    else:
        print("⚠ gRPC Server not started (proto files not generated - run protoc during build)")
    
    # Obter porta do ambiente ou usar padrão
    port = int(os.getenv('API_PORT', 5000))
    
    print(f"\n{'='*60}")
    print("XML Service starting...")
    print(f"{'='*60}")
    print(f"Flask API Port: {port} (REST)")
    print(f"TCP Socket Port: {socket_port} (NON-HTTP)")
    print(f"gRPC Port: {grpc_port}")
    print(f"Environment: {os.getenv('ENV', 'development')}")
    print(f"{'='*60}\n")
    
    # Iniciar servidor Flask
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
