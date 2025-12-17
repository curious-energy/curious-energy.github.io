@echo off
chcp 65001 >nul

REM 切换到脚本所在目录
cd /d "%~dp0"

echo ================================================
echo   Hugo 博客管理系统启动脚本
echo ================================================
echo.

REM 检查Node.js是否安装
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 未检测到Node.js，请先安装Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

echo [1/3] 检查依赖包...
if not exist node_modules (
    echo [信息] 首次运行，正在安装依赖包...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo [信息] 依赖包已存在
)

echo.
echo [2/3] 启动管理系统...
echo.
echo ================================================
echo   管理界面: http://localhost:3000
echo   
echo   按 Ctrl+C 可以停止服务
echo ================================================
echo.

start http://localhost:3000

node server.js

pause

