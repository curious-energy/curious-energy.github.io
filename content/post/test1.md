+++
date = '2025-12-17T19:57:33.777Z'
draft = false
title = '一些网站使用上的备忘录'
categories = []
tags = []
math = true
+++

奇怪的一点，目录的显示必须是##开始，#是无效果的。

创建一个新的博客文章, x为新文章名字，最好和内容有一点关联性，我怕找不到了。
`hugo new content post/x.md`

写完后保存就行，一般情况下我是在其他markdown软件下写好才会往这边复制，所以问题不大，注意一下兼容性就行。

图床目前使用这个[网站](https://picx.xpoet.cn/),测试了一下还是很好用的，至少不怕跑路而且免费。

`hugo server`可以用来预览页面，正式发布前使用`hugo`生成发布内容public下。

接着使用`npm run algolia`来更新一下站内搜索的索引。

本地的所有事项完成后，开始上传内容到github.

正常情况下，`git add .`, `git commit -m "some logs..."`, `git push`就可以了。

PS：新的地方可以使用git clone这些来拉取网站原内容。


## 子命令
重置用户登陆失败状态：

`sudo pam_tally2 --user testuser --reset`

查看秘密过期状态：

`sudo chage -l testuser`

改变密码使用时间和提示修改：

`sudo chage -M 150 -W 30 testuser`

督促修改秘密

`chage -d '2023-10-01' testuser`

## 代码测试
```python

import os

os.listdir()
print("this is test")

```

## 公式测试
$$
\int_0^\infty e^x dx
$$

## 其他
> 不知道这个可以不可以正常使用
