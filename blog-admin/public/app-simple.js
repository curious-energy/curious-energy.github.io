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
        date: ''
      },
      markdownContent: '',
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
        // 设置当前文章
        this.currentPost = post;
        
        // 先尝试从IndexedDB加载草稿
        const draft = await this.draftDB.getDraft(post.filename);
        
        if (draft) {
          // 如果有草稿，询问是否加载
          if (confirm('检测到本地草稿，是否加载草稿？\n点击"取消"将加载已保存的版本。')) {
            this.loadFromDraft(draft);
            this.showToast('已加载本地草稿', 'info');
            return;
          }
        }
        
        // 从服务器加载
        const response = await axios.get(`${API_BASE}/posts/${post.filename}`);
        if (response.data.success) {
          this.parseContent(response.data.content);
        }
      } catch (error) {
        this.showToast('加载文章失败：' + error.message, 'error');
      }
    },
    
    // 从草稿加载
    loadFromDraft(draft) {
      this.frontMatter = { ...draft.frontMatter };
      this.markdownContent = draft.content;
    },
    
    // 解析文章内容
    parseContent(content) {
      // 解析Front Matter
      const frontMatterMatch = content.match(/^\+\+\+\n([\s\S]*?)\n\+\+\+\n([\s\S]*)$/);
      
      if (frontMatterMatch) {
        const frontMatterText = frontMatterMatch[1];
        let markdownText = frontMatterMatch[2];
        
        // 解析Front Matter字段
        this.frontMatter = {
          title: this.extractField(frontMatterText, 'title') || '',
          draft: this.extractField(frontMatterText, 'draft') === 'true',
          encrypted: this.extractField(frontMatterText, 'encrypted') === 'true',
          password: this.extractField(frontMatterText, 'password') || '',
          date: this.extractField(frontMatterText, 'date') || ''
        };
        
        // 如果是加密文章，从Front Matter中获取加密内容
        if (this.frontMatter.encrypted && this.frontMatter.password) {
          // 提取encrypted_content字段（使用三引号包裹）
          const encryptedContentMatch = frontMatterText.match(/encrypted_content\s*=\s*'''([\s\S]*?)'''/);
          if (encryptedContentMatch) {
            try {
              const encryptedData = encryptedContentMatch[1].trim();
              const decrypted = CryptoJS.AES.decrypt(encryptedData, this.frontMatter.password).toString(CryptoJS.enc.Utf8);
              this.markdownContent = decrypted || markdownText;
            } catch (e) {
              console.error('解密失败:', e);
              this.markdownContent = markdownText;
            }
          } else {
            this.markdownContent = markdownText;
          }
        } else {
          this.markdownContent = markdownText;
        }
      } else {
        this.markdownContent = content;
      }
    },
    
    // 提取Front Matter字段
    extractField(text, fieldName) {
      const regex = new RegExp(`${fieldName}\\s*=\\s*['"](.+?)['"]`);
      const match = text.match(regex);
      return match ? match[1] : null;
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
      
      const frontMatter = `+++
date = '${now}'
draft = ${this.frontMatter.draft}
title = '${this.frontMatter.title}'
${this.frontMatter.encrypted ? `encrypted = true\npassword = '${this.frontMatter.password}'\nencrypted_content = '''${encryptedContent}'''` : ''}
+++

${content}`;
      
      return frontMatter;
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
          this.showToast('发布成功！GitHub Actions将自动部署', 'success');
        }
      } catch (error) {
        this.showToast('发布失败：' + error.response?.data?.error || error.message, 'error');
      } finally {
        this.publishing = false;
      }
    },
    
    // 预览博客（启动Hugo服务）
    async previewBlog() {
      try {
        const response = await axios.post(`${API_BASE}/preview`);
        if (response.data.success) {
          this.showToast('预览服务器已启动', 'success');
          // 2秒后自动打开浏览器
          setTimeout(() => {
            window.open('http://localhost:1313', '_blank');
          }, 2000);
        }
      } catch (error) {
        this.showToast('启动预览失败：' + error.message, 'error');
      }
    },
    
    // 在浏览器中打开Hugo预览
    openHugoPreview() {
      window.open('http://localhost:1313', '_blank');
      this.showToast('请确保已点击顶部"Hugo预览"按钮启动预览服务', 'info');
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

