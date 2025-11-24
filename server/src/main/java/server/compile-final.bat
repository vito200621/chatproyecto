@echo off
echo ====================================
echo    COMPILACIÓN FINAL CON ICE
echo ====================================
echo.

echo 1. Deteniendo procesos Java...
taskkill /f /im java.exe 2>nul

echo 2. Limpiando build anterior...
rmdir /s /q build 2>nul
mkdir build
mkdir build\classes

echo 3. Compilando clases Ice generadas...
javac -cp ".;libs/ice-3.7.6.jar" -d build/classes src/main/java/Chat/*.java

if %ERRORLEVEL% NEQ 0 (
    echo Error compilando clases Ice
    pause
    exit /b 1
)

echo 4. Compilando servidor con Ice...
javac -cp ".;src/main/java;libs/ice-3.7.6.jar;libs/icebox-3.7.6.jar;build/classes" ^
  -d build/classes ^
  src/main/java/server/ice/*.java ^
  src/main/java/ui/Main.java ^
  src/main/java/server/*.java

if %ERRORLEVEL% NEQ 0 (
    echo Error compilando servidor
    pause
    exit /b 1
)

echo.
echo ====================================
echo    COMPILACIÓN EXITOSA
echo ====================================
echo.

echo Ejecutando servidor...
java -cp "build/classes;libs/ice-3.7.6.jar;libs/icebox-3.7.6.jar" ui.Main

pause