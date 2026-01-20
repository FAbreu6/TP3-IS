"""Módulo para validar XML usando XML Schema Definition (XSD)"""

import os
import xmlschema
from lxml import etree
from typing import Tuple, Optional


def get_schema_path() -> str:
    """Retorna o caminho para o arquivo XSD"""
    # Caminho relativo a partir do diretório atual (src/)
    current_dir = os.path.dirname(os.path.abspath(__file__))
    schema_path = os.path.join(current_dir, '..', 'schemas', 'relatorio_conformidade.xsd')
    return os.path.normpath(schema_path)


def validate_xml(xml_content: str) -> Tuple[bool, Optional[str]]:
    """
    Valida XML usando XML Schema Definition (XSD)
    
    Args:
        xml_content: String XML a validar
        
    Returns:
        Tuple (is_valid, error_message)
    """
    try:
        # Validar entrada
        if not xml_content:
            return False, "XML content is empty or None"
        
        if not isinstance(xml_content, str):
            return False, f"XML content must be a string, got: {type(xml_content)}"
        
        # Primeiro, validar que o XML está bem formado (well-formed)
        try:
            parser = etree.XMLParser(no_network=True, recover=False)
            etree.fromstring(xml_content.encode('utf-8'), parser=parser)
        except etree.XMLSyntaxError as e:
            return False, f"XML syntax error (not well-formed): {str(e)}"
        
        # Obter caminho do schema XSD
        schema_path = get_schema_path()
        
        if not os.path.exists(schema_path):
            # Fallback: validar estrutura básica se XSD não existir
            return _validate_xml_basic(xml_content)
        
        # Validar contra o schema XSD
        try:
            schema = xmlschema.XMLSchema(schema_path)
            schema.validate(xml_content)
            return True, None
        except xmlschema.XMLSchemaException as e:
            # Obter mensagens de erro detalhadas
            error_messages = []
            try:
                # Tentar validar novamente para obter erros específicos
                errors = schema.iter_errors(xml_content)
                for error in errors:
                    error_messages.append(str(error))
            except:
                pass
            
            if error_messages:
                error_msg = "; ".join(error_messages[:5])  # Limitar a 5 erros
            else:
                error_msg = str(e)
            
            return False, f"XML Schema validation failed: {error_msg}"
        
    except Exception as e:
        return False, f"Validation error: {str(e)}"


def _validate_xml_basic(xml_content: str) -> Tuple[bool, Optional[str]]:
    """
    Validação básica (fallback quando XSD não está disponível)
    """
    try:
        parser = etree.XMLParser(no_network=True, recover=False)
        tree = etree.fromstring(xml_content.encode('utf-8'), parser=parser)
        
        # Validar estrutura básica
        if tree.tag != 'RelatorioConformidade':
            return False, "Root element must be 'RelatorioConformidade'"
        
        # Validar atributos obrigatórios do root
        if 'DataGeracao' not in tree.attrib:
            return False, "Root element must have 'DataGeracao' attribute"
        
        if 'Versao' not in tree.attrib:
            return False, "Root element must have 'Versao' attribute"
        
        # Validar presença de Configuracao
        config = tree.find('Configuracao')
        if config is None:
            return False, "XML must contain 'Configuracao' element"
        
        # Validar presença de Ativos
        ativos = tree.find('Ativos')
        if ativos is None:
            return False, "XML must contain 'Ativos' element"
        
        # Validar que há pelo menos um Ativo
        if len(ativos.findall('Ativo')) == 0:
            return False, "XML must contain at least one 'Ativo' element"
        
        return True, None
        
    except Exception as e:
        return False, f"Basic validation error: {str(e)}"


def validate_xml_structure(xml_content: str) -> bool:
    """
    Valida apenas a estrutura XML (well-formed)
    Retorna True se o XML está bem formado, False caso contrário
    """
    try:
        etree.fromstring(xml_content.encode('utf-8'))
        return True
    except etree.XMLSyntaxError:
        return False
