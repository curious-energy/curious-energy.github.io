const { createApp } = Vue;

// API基础URL
const API_BASE = 'http://localhost:3000/api';

// IndexedDB 管理类
class DraftDB {
  constructor() {
    this.dbName = 'HugoBlogDrafts';
    this.version = 1;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'filename' });
        }
      };
    });
  }

  async saveDraft(filename, content, frontMatter) {
    const transaction = this.db.transaction(['drafts'], 'readwrite');
    const store = transaction.objectStore('drafts');
    const data = {
      filename,
      content,
      frontMatter,
      savedAt: new Date().toISOString()
    };
    return store.put(data);
  }

  async getDraft(filename) {
    const transaction = this.db.transaction(['drafts'], 'readonly');
    const store = transaction.objectStore('drafts');
    return new Promise((resolve, reject) => {
      const request = store.get(filename);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteDraft(filename) {
    const transaction = this.db.transaction(['drafts'], 'readwrite');
    const store = transaction.objectStore('drafts');
    return store.delete(filename);
  }

  async getAllDrafts() {
    const transaction = this.db.transaction(['drafts'], 'readonly');
    const store = transaction.objectStore('drafts');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

// 创建Vue应用
const app = createApp({
  data() {
    return {
      posts: [],
      currentPost: null,
      frontMatter: {
        title: '',
        draft: false,
        encrypted: false,
        password: '',
        date: '',
        categories: '',
        tags: ''
      },
      markdownContent: '', // 直接绑定到 textarea
      searchQuery: '',
      showCreateDialog: false,
      showPublishDialog: false,
      newPostFilename: '',
      commitMessage: '',
      publishing: false,
      autoSaveTimer: null,
      autoSaveStatus: '',
      draftDB: null,
      toast: {
        show: false,
        message: '',
        type: 'success'
      }
    };
  },
  
  computed: {
    filteredPosts() {
      if (!this.searchQuery) return this.posts;
      const query = this.searchQuery.toLowerCase();
      return this.posts.filter(post => 
        post.title.toLowerCase().includes(query) ||
        post.filename.toLowerCase().includes(query)
      );
    }
  },
  
  async mounted() {
    // 初始化IndexedDB
    this.draftDB = new DraftDB();
    await this.draftDB.init();
    
    // 加载文章列表
    await this.loadPosts();
    
    // 监听页面关闭事件，保存草稿
    window.addEventListener('beforeunload', (e) => {
      if (this.currentPost) {
        this.saveDraft();
      }
    });
  },
  
  methods: {
    // 加载文章列表
    async loadPosts() {
      try {
        const response = await axios.get(`${API_BASE}/posts`);
        if (response.data.success) {
          this.posts = response.data.posts;
        }
      } catch (error) {
        this.showToast('加载文章列表失败：' + error.message, 'error');
      }
    },
    
    // 加载单篇文章
    async loadPost(post) {
      try {
        // 如果正在编辑另一篇文章，先保存草稿
        if (this.currentPost) {
          await this.saveDraft();
        }

        // 设置当前文章
        this.currentPost = post;
        this.markdownContent = ''; // 清空内容
        
        // 先尝试从IndexedDB加载草稿
        const draft = await this.draftDB.getDraft(post.filename);
        let useDraft = false;

        if (draft) {
          // 如果有草稿，询问是否加载
          if (confirm('检测到本地草稿，是否加载草稿？\n点击"取消"将加载已保存的版本。')) {
            useDraft = true;
            this.frontMatter = { ...draft.frontMatter };
            this.markdownContent = draft.content;
            this.showToast('已加载本地草稿', 'info');
          }
        }
        
        // 如果不使用草稿，从服务器加载
        if (!useDraft) {
          const response = await axios.get(`${API_BASE}/posts/${post.filename}`);
          if (response.data.success) {
            this.parseContent(response.data.content);
          }
        }
      } catch (error) {
        this.showToast('加载文章失败：' + error.message, 'error');
      }
    },
    
    // 解析文章内容
    parseContent(content) {
      // 解析Front Matter
      // 优化正则：允许开头有空白，更稳健地匹配第一个 +++ 块
      const frontMatterRegex = /^\s*\+\+\+\s*\n([\s\S]*?)\n\s*\+\+\+\s*\n([\s\S]*)$/;
      let match = content.match(frontMatterRegex);
      
      let markdownText = content;
      
      if (match) {
        const frontMatterText = match[1];
        markdownText = match[2];
        
        // 【关键修复】：检查正文是否依然包含残留的 Front Matter（应对之前保存错误导致的重复头部）
        // 如果正文开头看起来还是 Front Matter，继续剥离，直到只剩真正的正文
        while (true) {
            const secondaryMatch = markdownText.match(frontMatterRegex);
            if (secondaryMatch) {
                console.warn('检测到重复的 Front Matter，已自动清理旧头部');
                markdownText = secondaryMatch[2];
            } else {
                break;
            }
        }
        
        // 解析Front Matter字段
        this.frontMatter = {
          title: this.extractField(frontMatterText, 'title') || '',
          draft: this.extractField(frontMatterText, 'draft') === 'true',
          encrypted: this.extractField(frontMatterText, 'encrypted') === 'true',
          password: this.extractField(frontMatterText, 'password') || '',
          date: this.extractField(frontMatterText, 'date') || '',
          categories: this.extractArrayField(frontMatterText, 'categories'),
          tags: this.extractArrayField(frontMatterText, 'tags')
        };
        
        // 如果是加密文章，从Front Matter中获取加密内容
        if (this.frontMatter.encrypted && this.frontMatter.password) {
          const encryptedContentMatch = frontMatterText.match(/encrypted_content\s*=\s*'''([\s\S]*?)'''/);
          if (encryptedContentMatch) {
            // 清理可能存在的空白字符
            const encryptedData = encryptedContentMatch[1].replace(/\s/g, '');
            // 尝试使用 Front Matter 中的密码自动解密
            try {
              const decrypted = CryptoJS.AES.decrypt(encryptedData, this.frontMatter.password).toString(CryptoJS.enc.Utf8);
              if (decrypted) {
                markdownText = decrypted;
              } else {
                // 解密失败（可能是密码错误或数据损坏）
                console.warn('自动解密失败，尝试请求用户密码');
                const userPassword = prompt('此文章已加密，请输入密码进行编辑：');
                if (userPassword) {
                   const decryptedUser = CryptoJS.AES.decrypt(encryptedData, userPassword).toString(CryptoJS.enc.Utf8);
                   if (decryptedUser) markdownText = decryptedUser;
                }
              }
            } catch (e) {
              console.error('解密异常:', e);
              // 如果自动解密失败，尝试手动输入
              const userPassword = prompt('自动解密异常，请输入密码：');
              if (userPassword) {
                 try {
                    const decryptedUser = CryptoJS.AES.decrypt(encryptedData, userPassword).toString(CryptoJS.enc.Utf8);
                    if (decryptedUser) markdownText = decryptedUser;
                 } catch(err) {
                    alert('解密失败，无法编辑原始内容');
                 }
              }
            }
          }
        }
      } else {
        this.frontMatter = {
          title: this.currentPost ? this.currentPost.title : '',
          draft: false,
          encrypted: false,
          password: '',
          date: new Date().toISOString()
        };
      }
      
      this.markdownContent = markdownText;
    },
    
    // 提取Front Matter字段
    extractField(text, fieldName) {
      const regex = new RegExp(`${fieldName}\\s*=\\s*['"](.+?)['"]`);
      const match = text.match(regex);
      return match ? match[1] : null;
    },

    // 提取数组字段 (categories, tags)
    extractArrayField(text, fieldName) {
      const regex = new RegExp(`${fieldName}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
      const match = text.match(regex);
      if (match) {
        // 移除引号并用逗号分隔
        return match[1].replace(/['"]/g, '').split(',').map(s => s.trim()).filter(s => s).join(', ');
      }
      return '';
    },
    
    // 生成完整的文章内容
    generateFullContent() {
      const now = this.frontMatter.date || new Date().toISOString();
      let content = this.markdownContent;
      let encryptedContent = '';
      
      // 如果启用加密，加密内容并保存在Front Matter中
      if (this.frontMatter.encrypted && this.frontMatter.password) {
        encryptedContent = CryptoJS.AES.encrypt(content, this.frontMatter.password).toString();
        // 加密文章的正文显示提示信息
        content = '*此文章已加密，请输入密码查看。*';
      }

      // 处理分类和标签数组
      const formatArray = (str) => {
        if (!str) return '[]';
        const items = str.split(/,|，/).map(s => s.trim()).filter(s => s);
        if (items.length === 0) return '[]';
        return `['${items.join("', '")}']`;
      };
      
      const categoriesToml = formatArray(this.frontMatter.categories);
      const tagsToml = formatArray(this.frontMatter.tags);
      
      const frontMatter = `+++
date = '${now}'
draft = ${this.frontMatter.draft}
title = '${this.frontMatter.title}'
categories = ${categoriesToml}
tags = ${tagsToml}
${this.frontMatter.encrypted ? `encrypted = true\npassword = '${this.frontMatter.password}'\nencrypted_content = '''${encryptedContent}'''` : ''}
+++

${content}`;
      
      return frontMatter;
    },

    // 手动强制解密（用于调试）
    tryManualDecrypt() {
        const userPassword = prompt('请输入解密密码：');
        if (!userPassword) return;

        // 获取当前文件的原始完整内容（包含 Front Matter 和 正文）
        // 这里的关键是我们需要重新获取一次 API 数据，或者从当前已解析的 frontMatter 中尝试获取（如果内存中有缓存）
        // 但最可靠的是请求后端获取原始文件内容
        
        if (!this.currentPost) return;

        axios.get(`${API_BASE}/posts/${this.currentPost.filename}`)
          .then(response => {
             if (response.data.success) {
                const fullContent = response.data.content;
                // 解析 Front Matter 提取加密内容
                const match = fullContent.match(/encrypted_content\s*=\s*'''([\s\S]*?)'''/);
                if (match) {
                   const encryptedData = match[1].replace(/\s/g, ''); // 关键：清洗数据
                   try {
                      const decrypted = CryptoJS.AES.decrypt(encryptedData, userPassword).toString(CryptoJS.enc.Utf8);
                      if (decrypted && decrypted.length > 0) {
                         this.markdownContent = decrypted;
                         this.frontMatter.password = userPassword; // 更新密码以便后续保存
                         this.showToast('强制解密成功！', 'success');
                      } else {
                         alert('密码错误或数据损坏，解密失败。');
                      }
                   } catch(e) {
                      console.error(e);
                      alert('解密发生错误：' + e.message);
                   }
                } else {
                   alert('未找到加密数据字段，该文件可能未正确加密。');
                }
             }
          })
          .catch(err => {
             alert('获取文件失败：' + err.message);
          });
    },
    
    // 内容变化时触发
    onContentChange() {
      // 清除之前的定时器
      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
      }
      
      // 设置新的自动保存定时器（30秒后）
      this.autoSaveTimer = setTimeout(() => {
        this.saveDraft();
      }, 30000);
    },
    
    // 保存草稿到IndexedDB
    async saveDraft() {
      if (!this.currentPost) return;
      
      try {
        await this.draftDB.saveDraft(
          this.currentPost.filename,
          this.markdownContent,
          this.frontMatter
        );
        this.autoSaveStatus = '✓ 已自动保存到本地浏览器';
        setTimeout(() => {
          this.autoSaveStatus = '';
        }, 3000);
      } catch (error) {
        console.error('保存草稿失败：', error);
      }
    },
    
    // 保存到本地文件
    async saveToLocal() {
      if (!this.currentPost) return;
      
      try {
        const content = this.generateFullContent();
        const response = await axios.post(`${API_BASE}/posts/save`, {
          filename: this.currentPost.filename,
          content
        });
        
        if (response.data.success) {
          this.showToast('文章已保存到本地文件系统', 'success');
          // 删除草稿
          await this.draftDB.deleteDraft(this.currentPost.filename);
          // 重新加载文章列表
          await this.loadPosts();
        }
      } catch (error) {
        this.showToast('保存失败：' + error.message, 'error');
      }
    },
    
    // 显示新建文章对话框
    showCreateModal() {
      this.showCreateDialog = true;
      this.newPostFilename = '';
    },
    
    // 创建新文章
    async createPost() {
      if (!this.newPostFilename.trim()) {
        this.showToast('请输入文件名', 'error');
        return;
      }
      
      try {
        const response = await axios.post(`${API_BASE}/posts/create`, {
          filename: this.newPostFilename
        });
        
        if (response.data.success) {
          this.showToast('文章创建成功', 'success');
          this.showCreateDialog = false;
          await this.loadPosts();
          
          // 自动打开新创建的文章
          const newPost = this.posts.find(p => p.filename === response.data.filename);
          if (newPost) {
            await this.loadPost(newPost);
          }
        }
      } catch (error) {
        this.showToast('创建失败：' + error.response?.data?.error || error.message, 'error');
      }
    },
    
    // 删除文章
    async deletePost() {
      if (!this.currentPost) return;
      
      if (!confirm(`确定要删除文章《${this.currentPost.title}》吗？此操作不可恢复！`)) {
        return;
      }
      
      try {
        const response = await axios.delete(`${API_BASE}/posts/${this.currentPost.filename}`);
        
        if (response.data.success) {
          this.showToast('文章已删除', 'success');
          // 删除草稿
          await this.draftDB.deleteDraft(this.currentPost.filename);
          // 重置当前文章
          this.currentPost = null;
          this.markdownContent = '';
          // 重新加载列表
          await this.loadPosts();
        }
      } catch (error) {
        this.showToast('删除失败：' + error.message, 'error');
      }
    },
    
    // 显示发布对话框
    showPublishModal() {
      this.showPublishDialog = true;
      this.commitMessage = `博客更新 ${new Date().toLocaleString('zh-CN')}`;
    },
    
    // 发布到GitHub
    async publishToGitHub() {
      this.publishing = true;
      this.showPublishDialog = false;
      
      try {
        const response = await axios.post(`${API_BASE}/publish`, {
          commitMessage: this.commitMessage
        });
        
        if (response.data.success) {
          this.showToast('发布成功！', 'success');
        }
      } catch (error) {
        this.showToast('发布失败：' + error.response?.data?.error || error.message, 'error');
      } finally {
        this.publishing = false;
      }
    },
    
    // 预览博客
    async previewBlog() {
      try {
        const response = await axios.post(`${API_BASE}/preview`);
        if (response.data.success) {
          this.showToast('预览服务器已启动，请访问 http://localhost:1313', 'info');
          // 3秒后自动打开浏览器
          setTimeout(() => {
            window.open('http://localhost:1313', '_blank');
          }, 2000);
        }
      } catch (error) {
        this.showToast('启动预览失败：' + error.message, 'error');
      }
    },
    
    // 显示Toast提示
    showToast(message, type = 'success') {
      this.toast = {
        show: true,
        message,
        type
      };
      
      setTimeout(() => {
        this.toast.show = false;
      }, 3000);
    },
    
    // 格式化日期
    formatDate(dateString) {
      const date = new Date(dateString);
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }
});

app.mount('#app');