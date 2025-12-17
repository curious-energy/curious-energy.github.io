const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const PORT = 3000;

// 博客根目录（blog-admin的父目录）
const BLOG_ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(BLOG_ROOT, 'content', 'post');

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('public'));

// 默认路由 - 使用完整版（带EasyMDE编辑器）
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 简洁版（无卡顿）
app.get('/simple', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index-simple.html'));
});

// 获取文章列表
app.get('/api/posts', (req, res) => {
  try {
    const files = fs.readdirSync(CONTENT_DIR);
    const posts = files
      .filter(file => file.endsWith('.md') && file !== '_index.md')
      .map(file => {
        const filePath = path.join(CONTENT_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);
        
        // 解析Front Matter
        const frontMatterMatch = content.match(/^\+\+\+\n([\s\S]*?)\n\+\+\+/);
        let title = file.replace('.md', '');
        let date = stats.mtime.toISOString();
        let draft = false;
        let encrypted = false;
        
        if (frontMatterMatch) {
          const frontMatter = frontMatterMatch[1];
          const titleMatch = frontMatter.match(/title\s*=\s*['"](.+?)['"]/);
          const dateMatch = frontMatter.match(/date\s*=\s*['"](.+?)['"]/);
          const draftMatch = frontMatter.match(/draft\s*=\s*(true|false)/);
          const encryptedMatch = frontMatter.match(/encrypted\s*=\s*(true|false)/);
          
          if (titleMatch) title = titleMatch[1];
          if (dateMatch) date = dateMatch[1];
          if (draftMatch) draft = draftMatch[1] === 'true';
          if (encryptedMatch) encrypted = encryptedMatch[1] === 'true';
        }
        
        return {
          filename: file,
          title,
          date,
          draft,
          encrypted,
          modifiedTime: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    res.json({ success: true, posts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取单篇文章内容
app.get('/api/posts/:filename', (req, res) => {
  try {
    const filePath = path.join(CONTENT_DIR, req.params.filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: '文章不存在' });
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ success: true, content });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 保存文章（保存到本地）
app.post('/api/posts/save', (req, res) => {
  try {
    const { filename, content } = req.body;
    
    if (!filename || !content) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }
    
    const filePath = path.join(CONTENT_DIR, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    
    res.json({ success: true, message: '文章已保存到本地' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 创建新文章
app.post('/api/posts/create', (req, res) => {
  try {
    const { filename } = req.body;
    
    if (!filename) {
      return res.status(400).json({ success: false, error: '缺少文件名' });
    }
    
    const safeFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
    const filePath = path.join(CONTENT_DIR, safeFilename);
    
    if (fs.existsSync(filePath)) {
      return res.status(400).json({ success: false, error: '文件已存在' });
    }
    
    // 生成默认Front Matter
    const now = new Date().toISOString();
    const defaultContent = `+++
date = '${now}'
draft = false
title = '${filename.replace('.md', '')}'
+++

在这里开始写作...
`;
    
    fs.writeFileSync(filePath, defaultContent, 'utf-8');
    res.json({ success: true, filename: safeFilename });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除文章
app.delete('/api/posts/:filename', (req, res) => {
  try {
    const filePath = path.join(CONTENT_DIR, req.params.filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: '文章不存在' });
    }
    
    fs.unlinkSync(filePath);
    res.json({ success: true, message: '文章已删除' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 发布到GitHub
app.post('/api/publish', (req, res) => {
  try {
    const { commitMessage } = req.body;
    const message = commitMessage || `博客更新 ${new Date().toLocaleString('zh-CN')}`;
    
    // 执行Hugo构建
    console.log('执行Hugo构建...');
    execSync('hugo --minify', { cwd: BLOG_ROOT, stdio: 'inherit' });
    
    // 更新Algolia索引（如果配置了）
    try {
      console.log('更新搜索索引...');
      execSync('npm run algolia', { cwd: BLOG_ROOT, stdio: 'inherit' });
    } catch (algoliaError) {
      console.log('搜索索引更新失败（可能未配置），继续发布流程...');
    }
    
    // Git操作
    console.log('提交到Git...');
    execSync('git add .', { cwd: BLOG_ROOT, stdio: 'inherit' });
    execSync(`git commit -m "${message}"`, { cwd: BLOG_ROOT, stdio: 'inherit' });
    execSync('git push', { cwd: BLOG_ROOT, stdio: 'inherit' });
    
    res.json({ success: true, message: '发布成功！' });
  } catch (error) {
    // Git可能因为没有更改而失败，这不是错误
    if (error.message.includes('nothing to commit')) {
      return res.json({ success: true, message: '没有需要提交的更改' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// 预览博客（启动Hugo服务器）
app.post('/api/preview', (req, res) => {
  try {
    // 非阻塞方式启动Hugo服务器
    const { spawn } = require('child_process');
    console.log('启动Hugo预览服务器...');
    
    // 使用 shell: true 以确保在Windows上能找到命令
    // 使用 stdio: 'inherit' 以便在控制台查看Hugo输出
    const hugoProcess = spawn('hugo', ['server', '--port', '1313', '--bind', '0.0.0.0'], { 
      cwd: BLOG_ROOT,
      shell: true, 
      detached: false, // 设为false以便随主进程退出，或者如果需要长期运行可保持true
      stdio: 'inherit'
    });
    
    // 如果需要后台运行并不阻塞Node进程
    // hugoProcess.unref(); 
    
    // 这里我们不unref，这样可以在Node控制台看到Hugo的日志
    
    res.json({ 
      success: true, 
      message: 'Hugo预览服务器已启动，请留意控制台日志',
      url: 'http://localhost:1313'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║   Hugo 博客管理系统已启动                  ║
║                                            ║
║   管理界面: http://localhost:${PORT}        ║
║                                            ║
║   快捷操作:                                ║
║   - 编辑文章                               ║
║   - 本地保存（自动保存）                   ║
║   - 一键发布到GitHub                       ║
║   - 文章加密                               ║
╚════════════════════════════════════════════╝
  `);
});

