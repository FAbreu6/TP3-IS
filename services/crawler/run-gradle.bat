@echo off
REM Script para compilar e executar o crawler com Gradle

echo ========================================
echo   CRAWLER JAVA - Compilar e Executar
echo ========================================
echo.

REM Verificar se Java está instalado
java -version >nul 2>&1
if errorlevel 1 (
    echo ERRO: Java nao encontrado!
    echo Instale Java 17+ e tente novamente.
    pause
    exit /b 1
)

REM Verificar se gradle-wrapper.jar existe, se não, tentar gerar
if not exist gradle\wrapper\gradle-wrapper.jar (
    echo gradle-wrapper.jar nao encontrado. Tentando gerar o Gradle Wrapper...
    echo.
    
    REM Verificar se Gradle está instalado globalmente
    gradle -version >nul 2>&1
    if errorlevel 1 (
        echo ERRO: Gradle nao encontrado e gradle-wrapper.jar esta faltando!
        echo.
        echo Solucao 1: Instale o Gradle e execute 'gradle wrapper' neste diretorio
        echo Solucao 2: Baixe o gradle-wrapper.jar manualmente de:
        echo   https://raw.githubusercontent.com/gradle/gradle/v8.14.0/gradle/wrapper/gradle-wrapper.jar
        echo   E salve em: gradle\wrapper\gradle-wrapper.jar
        echo.
        echo Tentando baixar automaticamente...
        
        REM Tentar baixar usando PowerShell
        powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/gradle/gradle/v8.14.0/gradle/wrapper/gradle-wrapper.jar' -OutFile 'gradle\wrapper\gradle-wrapper.jar'}"
        
        if not exist gradle\wrapper\gradle-wrapper.jar (
            echo ERRO: Nao foi possivel baixar o gradle-wrapper.jar automaticamente.
            echo Por favor, baixe manualmente ou instale o Gradle.
            pause
            exit /b 1
        ) else (
            echo gradle-wrapper.jar baixado com sucesso!
        )
    ) else (
        echo Gerando Gradle Wrapper usando Gradle instalado...
        call gradle wrapper --gradle-version 8.14
        if errorlevel 1 (
            echo ERRO: Falha ao gerar Gradle Wrapper.
            pause
            exit /b 1
        )
    )
)

REM Verificar se gradlew.bat existe, se não, criar
if not exist gradlew.bat (
    echo ERRO: gradlew.bat nao encontrado!
    echo Tentando gerar usando Gradle...
    gradle wrapper --gradle-version 8.14
    if not exist gradlew.bat (
        echo ERRO: Nao foi possivel gerar gradlew.bat.
        pause
        exit /b 1
    )
)

echo Compilando projeto...
call gradlew.bat build
if errorlevel 1 (
    echo ERRO: Falha ao compilar!
    pause
    exit /b 1
)

echo.
echo Iniciando crawler...
echo Pressione Ctrl+C para parar
echo.

REM Executar o crawler
call gradlew.bat run

pause
