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

REM Verificar se gradlew.bat existe
if not exist gradlew.bat (
    echo ERRO: gradlew.bat nao encontrado!
    echo Certifique-se de que o Gradle Wrapper esta configurado.
    pause
    exit /b 1
)

REM Verificar se gradle-wrapper.jar existe
if not exist gradle\wrapper\gradle-wrapper.jar (
    echo ERRO: gradle-wrapper.jar nao encontrado!
    echo Certifique-se de que o Gradle Wrapper esta configurado.
    pause
    exit /b 1
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
