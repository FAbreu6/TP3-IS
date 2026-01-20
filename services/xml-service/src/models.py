"""Modelos de dados para o XML Service"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class XMLDocument:
    """Modelo para documento XML persistido"""
    id: Optional[int]
    xml_documento: str
    data_criacao: datetime
    mapper_version: str
    request_id: str
    status: str


@dataclass
class ProcessRequest:
    """Modelo para requisição de processamento"""
    request_id: str
    mapper: dict
    webhook_url: str
    csv_content: str


@dataclass
class WebhookNotification:
    """Modelo para notificação webhook"""
    id_requisicao: str
    status: str  # OK, ERRO_VALIDACAO, ERRO_PERSISTENCIA
    id_documento: Optional[int] = None
