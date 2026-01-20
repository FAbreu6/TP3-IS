"""TCP Socket Server para receber CSV do Processor (não HTTP)"""

import os
import json
import socket
import threading
import struct
from typing import Tuple, Dict, Any
from datetime import datetime

# Imports do módulo principal
from models import ProcessRequest
from database import Database
from xml_generator import generate_xml_from_csv, get_mapper_version
from xml_validator import validate_xml
import requests


def send_webhook(webhook_url: str, request_id: str, status: str, document_id: int = None, error_message: str = None):
    """Envia notificação webhook para o Processor"""
    payload = {
        "ID_Requisicao": request_id,
        "Status": status
    }
    
    if document_id:
        payload["ID_Documento"] = document_id
    
    if error_message:
        payload["Mensagem"] = error_message
    
    try:
        response = requests.post(
            webhook_url,
            json=payload,
            headers={'Content-Type': 'application/json'},
            timeout=10
        )
        print(f"✓ Webhook sent: {status}")
    except Exception as e:
        print(f"✗ Error sending webhook: {e}")


def process_csv_from_socket(request_data: ProcessRequest, db: Database):
    """
    Processa CSV recebido via socket:
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
        print(f"Processing CSV from socket: {request_id}")
        print(f"{'='*60}")
        
        # Validar dados recebidos
        if not csv_content:
            raise ValueError("CSV content is empty or None")
        if not mapper:
            raise ValueError("Mapper is empty or None")
        if not request_id:
            raise ValueError("Request ID is empty or None")
        
        print(f"CSV content length: {len(csv_content)} bytes")
        print(f"CSV preview (first 200 chars): {csv_content[:200]}")
        print(f"Mapper keys: {list(mapper.keys()) if mapper else 'None'}")
        
        # 1. Gerar XML
        print("\nStep 1: Generating XML from CSV...")
        if not csv_content or len(csv_content.strip()) == 0:
            raise ValueError("CSV content is empty")
        
        try:
            xml_content = generate_xml_from_csv(csv_content, mapper, request_id)
            print(f"✓ XML generation completed (type: {type(xml_content)})")
        except Exception as gen_error:
            print(f"✗ Error during XML generation: {gen_error}")
            print(f"   Error type: {type(gen_error).__name__}")
            import traceback
            traceback.print_exc()
            raise ValueError(f"XML generation failed: {str(gen_error)}") from gen_error
        
        if not xml_content:
            raise ValueError("XML generation returned None or empty")
        
        if not isinstance(xml_content, str):
            raise ValueError(f"XML generation returned wrong type: {type(xml_content)}, expected str")
        
        mapper_version = get_mapper_version(mapper)
        
        print(f"✓ XML generated ({len(xml_content)} bytes)")
        print(f"   XML preview (first 500 chars): {xml_content[:500]}")
        
        # 2. Validar XML
        print("\nStep 2: Validating XML...")
        is_valid, error_message = validate_xml(xml_content)
        
        if not is_valid:
            print(f"✗ XML validation failed: {error_message}")
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
            send_webhook(webhook_url, request_id, "ERRO_PERSISTENCIA", None, str(db_error))
            
    except Exception as e:
        print(f"✗ Processing error: {e}")
        send_webhook(webhook_url, request_id, "ERRO_VALIDACAO", None, str(e))


def parse_socket_message(data: bytes) -> Tuple[Dict[str, Any], bytes]:
    """
    Parse mensagem do socket:
    - Header JSON com length-prefixed
    - Conteúdo binário (CSV)
    """
    try:
        # Ler tamanho do header JSON (4 bytes - uint32)
        if len(data) < 4:
            raise ValueError("Message too short for header size")
        
        header_size = struct.unpack('>I', data[:4])[0]
        
        # Ler header JSON
        if len(data) < 4 + header_size:
            raise ValueError("Message too short for header")
        
        header_json = data[4:4+header_size].decode('utf-8')
        header = json.loads(header_json)
        
        # Resto é o conteúdo CSV
        csv_content = data[4+header_size:]
        
        return header, csv_content.decode('utf-8')
        
    except Exception as e:
        raise ValueError(f"Error parsing socket message: {e}")


def handle_client_connection(client_socket: socket.socket, address: Tuple[str, int], db: Database):
    """Lida com conexão de cliente TCP"""
    print(f"\n✓ Client connected: {address}")
    
    try:
        # Receber TODOS os dados antes de fazer parse
        # Estrutura: [header_size (4 bytes)] + [header_json] + [csv_content]
        # O cliente envia tudo de uma vez e fecha a conexão, então recebemos até a conexão fechar
        data = b''
        
        # Configurar timeout para evitar bloqueio infinito
        client_socket.settimeout(10.0)  # 10 segundos timeout
        
        # Receber todos os dados até a conexão fechar
        try:
            while True:
                chunk = client_socket.recv(8192)  # Aumentar buffer para 8KB
                if not chunk:
                    # Conexão fechada pelo cliente - todos os dados foram recebidos
                    break
                data += chunk
                print(f"  Received chunk: {len(chunk)} bytes (total: {len(data)} bytes)")
        except socket.timeout:
            # Timeout - assumir que recebemos todos os dados
            print(f"  Timeout reached, total received: {len(data)} bytes")
        except Exception as e:
            print(f"  Error receiving data: {e}")
            raise
        
        if len(data) < 4:
            raise ValueError(f"Message too short: only {len(data)} bytes received (need at least 4 for header size)")
        
        # Ler tamanho do header
        header_size = struct.unpack('>I', data[:4])[0]
        print(f"  Header size: {header_size} bytes")
        
        if len(data) < 4 + header_size:
            raise ValueError(f"Message incomplete: received {len(data)} bytes, need {4 + header_size} bytes for header")
        
        # Parse do header
        header_json = data[4:4+header_size].decode('utf-8')
        header = json.loads(header_json)
        
        # Extrair CSV content (tudo após o header)
        csv_content_bytes = data[4+header_size:]
        csv_content = csv_content_bytes.decode('utf-8')
        
        print(f"  Total data received: {len(data)} bytes")
        print(f"  Header: {4 + header_size} bytes")
        print(f"  CSV content: {len(csv_content_bytes)} bytes")
        
        # Validar dados parseados
        if not csv_content:
            raise ValueError("Parsed CSV content is empty")
        if not header.get('requestId'):
            raise ValueError("Request ID missing in header")
        if not header.get('mapper'):
            raise ValueError("Mapper missing in header")
        if not header.get('webhookUrl'):
            raise ValueError("Webhook URL missing in header")
        
        print(f"✓ Parsed socket message:")
        print(f"  Request ID: {header.get('requestId')}")
        print(f"  CSV length: {len(csv_content)} bytes")
        print(f"  CSV lines: {len(csv_content.split(chr(10)))} (including empty lines)")
        csv_non_empty_lines = [line for line in csv_content.split('\n') if line.strip()]
        print(f"  CSV non-empty lines: {len(csv_non_empty_lines)}")
        print(f"  Mapper keys: {list(header.get('mapper', {}).keys())}")
        
        # Criar objeto de requisição
        request_data = ProcessRequest(
            request_id=header.get('requestId'),
            mapper=header.get('mapper'),
            webhook_url=header.get('webhookUrl'),
            csv_content=csv_content
        )
        
        # Processar em thread separada (não bloquear socket)
        thread = threading.Thread(
            target=process_csv_from_socket,
            args=(request_data, db)
        )
        thread.daemon = True
        thread.start()
        
        # Enviar ACK via socket
        ack = json.dumps({
            "accepted": True,
            "requestId": request_data.request_id,
            "message": "Request accepted for processing"
        }).encode('utf-8')
        
        # Enviar tamanho + mensagem
        ack_with_size = struct.pack('>I', len(ack)) + ack
        client_socket.sendall(ack_with_size)
        
        print(f"✓ ACK sent for request: {request_data.request_id}")
                
    except Exception as e:
        print(f"✗ Error handling client {address}: {e}")
        # Enviar erro via socket
        try:
            error_response = json.dumps({
                "accepted": False,
                "error": str(e)
            }).encode('utf-8')
            error_with_size = struct.pack('>I', len(error_response)) + error_response
            client_socket.sendall(error_with_size)
        except:
            pass
    
    finally:
        client_socket.close()
        print(f"✓ Client disconnected: {address}")


def start_socket_server(db: Database, port: int = 7000):
    """Inicia servidor TCP Socket"""
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind(('0.0.0.0', port))
    server_socket.listen(5)
    
    print(f"\n{'='*60}")
    print("TCP Socket Server started (NON-HTTP)")
    print(f"{'='*60}")
    print(f"Listening on port {port}")
    print(f"Protocol: TCP Socket (NOT HTTP)")
    print(f"{'='*60}\n")
    
    while True:
        try:
            client_socket, address = server_socket.accept()
            
            # Processar em thread separada
            thread = threading.Thread(
                target=handle_client_connection,
                args=(client_socket, address, db)
            )
            thread.daemon = True
            thread.start()
            
        except Exception as e:
            print(f"✗ Socket server error: {e}")
            break
    
    server_socket.close()


if __name__ == '__main__':
    # Inicializar banco de dados
    db = Database()
    db.connect()
    
    # Iniciar servidor socket
    socket_port = int(os.getenv('SOCKET_PORT', 7000))
    start_socket_server(db, socket_port)
