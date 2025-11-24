@echo off
echo ====================================
echo    COMPILANDO SERVIDOR CON ICE
echo ====================================
echo.

echo Deteniendo procesos Java...
taskkill /f /im java.exe 2>nul

echo Limpiando build anterior...
rmdir /s /q build 2>nul
mkdir build
mkdir build\classes

echo Compilando clases Ice generadas...
javac -cp ".;libs/ice-3.7.6.jar" -d build/classes src/main/java/Chat/*.java

if %ERRORLEVEL% NEQ 0 (
    echo ERROR compilando clases Ice!
    pause
    exit /b 1
)

echo Compilando servidor con Ice...
javac -cp ".;src/main/java;libs/ice-3.7.6.jar;libs/icebox-3.7.6.jar;libs/icestorm-3.7.6.jar;build/classes" ^
  -d build/classes ^
  src/main/java/server/ice/*.java ^
  src/main/java/ui/Main.java ^
  src/main/java/server/*.java

if %ERRORLEVEL% NEQ 0 (
    echo ERROR compilando servidor!
    pause
    exit /b 1
)

echo.
echo ====================================
echo    EJECUTANDO SERVIDOR CON ICE
echo ====================================
echo.

java -cp "build/classes;libs/ice-3.7.6.jar;libs/icebox-3.7.6.jar;libs/icestorm-3.7.6.jar" ui.Main

pause