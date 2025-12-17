#!/bin/bash

# 切换到脚本所在目录
cd "$(dirname "$0")"

echo "================================================"
echo "  Hugo 博客管理系统启动脚本"
echo "================================================"
echo ""

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到Node.js，请先安装Node.js"
    echo "下载地址: https://nodejs.org/"
    exit 1
fi

echo "[1/3] 检查依赖包..."
if [ ! -d "node_modules" ]; then
    echo "[信息] 首次运行，正在安装依赖包..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[错误] 依赖安装失败"
        exit 1
    fi
else
    echo "[信息] 依赖包已存在"
fi

echo ""
echo "[2/3] 启动管理系统..."
echo ""
echo "================================================"
echo "  管理界面: http://localhost:3000"
echo "  "
echo "  按 Ctrl+C 可以停止服务"
echo "================================================"
echo ""

# 在macOS/Linux上自动打开浏览器
if [[ "$OSTYPE" == "darwin"* ]]; then
    open http://localhost:3000
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open http://localhost:3000 2>/dev/null
fi

node server.js

