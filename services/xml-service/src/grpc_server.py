"""Servidor gRPC REAL para consultas XPath do XML Service"""

import os
import sys
import grpc
from concurrent import futures
import time
from datetime import datetime

# Adicionar path para imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Importar arquivos gerados do proto (serão gerados via build)
try:
    import xml_service_pb2
    import xml_service_pb2_grpc
except ImportError:
    # Se não existirem, tentar gerar
    print("⚠ Proto files not found. Run: python -m grpc_tools.protoc -I./proto --python_out=./src --grpc_python_out=./src ./proto/xml_service.proto")
    sys.exit(1)

from database import Database


class XmlQueryServiceServicer(xml_service_pb2_grpc.XmlQueryServiceServicer):
    """Implementação REAL do serviço gRPC para consultas XPath"""
    
    def __init__(self):
        self.db = Database()
        try:
            self.db.connect()
            print("✓ gRPC Server: Database connected")
        except Exception as e:
            print(f"✗ gRPC Server: Database connection error: {e}")
            raise
    
    def ExecuteXPath(self, request, context):
        """Executa consulta XPath simples"""
        try:
            filters = {}
            if request.start_date:
                filters['start_date'] = request.start_date
            if request.end_date:
                filters['end_date'] = request.end_date
            if request.status:
                filters['status'] = request.status
            else:
                filters['status'] = 'OK'
            
            print(f"gRPC ExecuteXPath: {request.xpath_query}")
            
            # Consultar banco de dados
            results = self.db.query_xpath(request.xpath_query, filters if filters else None)
            
            # Converter para formato gRPC
            response = xml_service_pb2.XPathResponse()
            response.success = True
            response.count = len(results)
            
            for result in results:
                xpath_result = xml_service_pb2.XPathResult()
                xpath_result.id = result.get('id', 0)
                xpath_result.result = result.get('result', '')
                xpath_result.request_id = result.get('request_id', '')
                if result.get('data_criacao'):
                    xpath_result.data_criacao = result['data_criacao'].isoformat() if hasattr(result['data_criacao'], 'isoformat') else str(result['data_criacao'])
                response.results.append(xpath_result)
            
            return response
            
        except Exception as e:
            print(f"✗ gRPC ExecuteXPath error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            response = xml_service_pb2.XPathResponse()
            response.success = False
            response.error_message = str(e)
            response.count = 0
            return response
    
    def ExecuteAggregate(self, request, context):
        """Executa agregação XPath"""
        try:
            aggregate_func = request.aggregate_func or 'count'
            
            print(f"gRPC ExecuteAggregate: {request.xpath_query} (func: {aggregate_func})")
            
            # Consultar banco de dados
            result = self.db.aggregate_xpath(request.xpath_query, aggregate_func)
            
            # Converter para formato gRPC
            response = xml_service_pb2.AggregateResponse()
            response.success = True
            response.result = str(result.get('result', '0'))
            response.aggregate_func = aggregate_func
            
            return response
            
        except Exception as e:
            print(f"✗ gRPC ExecuteAggregate error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            response = xml_service_pb2.AggregateResponse()
            response.success = False
            response.error_message = str(e)
            response.result = '0'
            response.aggregate_func = request.aggregate_func or 'count'
            return response
    
    def ExecuteFilter(self, request, context):
        """Executa consulta XPath com filtros complexos"""
        try:
            filters = {}
            if request.start_date:
                filters['start_date'] = request.start_date
            if request.end_date:
                filters['end_date'] = request.end_date
            if request.status:
                filters['status'] = request.status
            else:
                filters['status'] = 'OK'
            
            print(f"gRPC ExecuteFilter: {request.xpath_query}")
            
            # Consultar banco de dados
            results = self.db.query_xpath(request.xpath_query, filters if filters else None)
            
            # Converter para formato gRPC
            response = xml_service_pb2.FilterResponse()
            response.success = True
            response.count = len(results)
            
            for result in results:
                xpath_result = xml_service_pb2.XPathResult()
                xpath_result.id = result.get('id', 0)
                xpath_result.result = result.get('result', '')
                xpath_result.request_id = result.get('request_id', '')
                if result.get('data_criacao'):
                    xpath_result.data_criacao = result['data_criacao'].isoformat() if hasattr(result['data_criacao'], 'isoformat') else str(result['data_criacao'])
                response.results.append(xpath_result)
            
            return response
            
        except Exception as e:
            print(f"✗ gRPC ExecuteFilter error: {e}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            response = xml_service_pb2.FilterResponse()
            response.success = False
            response.error_message = str(e)
            response.count = 0
            return response


def serve():
    """Inicia o servidor gRPC REAL"""
    port = int(os.getenv('GRPC_PORT', 50051))
    
    # Criar servidor gRPC
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    
    # Adicionar serviço
    servicer = XmlQueryServiceServicer()
    xml_service_pb2_grpc.add_XmlQueryServiceServicer_to_server(
        servicer, server
    )
    
    # Escutar na porta
    server.add_insecure_port(f'[::]:{port}')
    server.start()
    
    print(f"\n{'='*60}")
    print("gRPC Server started (REAL implementation)")
    print(f"{'='*60}")
    print(f"Listening on port {port}")
    print(f"Service: XmlQueryService")
    print(f"Methods: ExecuteXPath, ExecuteAggregate, ExecuteFilter")
    print(f"{'='*60}\n")
    
    try:
        # Manter servidor rodando
        while True:
            time.sleep(86400)  # 24 horas
    except KeyboardInterrupt:
        print("\nShutting down gRPC server...")
        server.stop(0)


if __name__ == '__main__':
    # Gerar arquivos proto se não existirem
    proto_path = os.path.join(os.path.dirname(__file__), '..', 'proto', 'xml_service.proto')
    if os.path.exists(proto_path):
        print("ℹ Proto file found. Make sure to generate Python files:")
        print("  python -m grpc_tools.protoc -I./proto --python_out=./src --grpc_python_out=./src ./proto/xml_service.proto")
    
    serve()
