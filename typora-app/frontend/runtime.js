(() => {
  'use strict';
  const KEY = 'via-redcowork-demo-v3';
  const seed = window.viaDemoSeed;
  const clone = value => structuredClone(value);
  let memory;
  function read() {
    try { const value = JSON.parse(localStorage.getItem(KEY)); if (value?.version === 3 && Array.isArray(value.sources) && value.settings) return value; } catch {}
    return memory || clone(seed);
  }
  function write(value) {
    memory = value;
    try { localStorage.setItem(KEY,JSON.stringify(value)); } catch { notice('浏览器未允许保存，当前体验仍可继续；刷新后记录可能重置。'); }
  }
  // Add new presets once without replacing edits, deleted sources, or submitted reviews.
  const initial = read();
  if ((initial.fixtureRevision || 1) < seed.fixtureRevision) {
    for (const item of initial.sources) {
      const preset = seed.sources.find(source => source.id === item.id);
      for (const comment of preset?.comments || []) {
        if (comment.presetRevision > (initial.fixtureRevision || 1) && !item.comments.some(existing => existing.id === comment.id)) item.comments.push(clone(comment));
      }
    }
    initial.fixtureRevision = seed.fixtureRevision;
  }
  write(initial);
  const esc = value => String(value || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let onLaunch, onChanged, onAiChanged;
  let activeId = new URLSearchParams(location.search).get('doc') || read().sources[0]?.id;
  const source = () => read().sources.find(item=>item.id === activeId);
  function getDocument() { const item = source(); return item ? {...item,record:{comments:item.comments,recap:item.recap}} : null; }
  function ai() {return {provider:read().settings.aiProvider,configured:true,providers:{deepseek:{configured:false},openai:{configured:false}}};}
  function notice(text) {const item=document.getElementById('toast');if(!item)return;item.textContent=text;item.classList.add('show');setTimeout(()=>item.classList.remove('show'),3500);}
  function mutate(fn) {const value=read();fn(value);write(value);return value;}
  function download(body,name) {const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;}
  function showSidebar() {document.body.classList.remove('sidebar-closed');document.body.dataset.mobileView='notes';}
  async function quote(text, question = '@Via ') {
    const item=getDocument();if(!item)return;
    if (!text) {notice('先选中一段原文，再按 Ctrl+Q 或点击划词后浮现的「问 Via」。');return;}
    if (text.length>180) {notice('请缩短引用，最多选择 180 字。');return;}
    await onLaunch?.({...item,selectedText:text});showSidebar();
    requestAnimationFrame(()=>{const input=document.getElementById('messageInput');if(input){input.value=question;input.focus();input.setSelectionRange(question.length,question.length);}});
  }
  function documentView() {
    const item=source(); const article=document.getElementById('readingBody'); if(!article)return;
    document.getElementById('readingFile').textContent=item?.name || '尚未选择资料';
    const md=window.markdownit({html:false,breaks:true}).disable(['image','link','autolink']);
    article.innerHTML=item ? md.render(item.content) : '<h1>资料已移除</h1><p>可以从设置恢复初始演示。</p>';
  }
  const unavailable = '当前仅前端无法使用此功能，请联系开发者获取完整安装包。';
  function packetFor(data,date) {const packet=data.dailyReview.days[date];if(!packet)throw Error('这一天没有复盘记录');return packet;}
  function printSource(item,person) {
    const preview=document.createElement('dialog');preview.className='pdf-preview-dialog';
    let html=window.viaDemoPdf.buildPdfHtml(item.name,item.content,item.comments,{person});
    html=html.replace(/<script>[\s\S]*?<\/script>/,'<script>document.getElementById("save").onclick=()=>window.print();<\/script>');
    html=html.replace('保存为 PDF','打印 / 保存为 PDF');
    if(person)html=html.replace('原文与批注 · PDF 预览','原文与 @'+esc(person)+' 的批注 · PDF 预览');
    const close=document.createElement('button');close.className='pdf-preview-close';close.textContent='关闭 PDF 预览';close.onclick=()=>{preview.close();preview.remove();};
    const frame=document.createElement('iframe');frame.title='原文与批注 PDF 排版预览';frame.srcdoc=html;
    preview.append(close,frame);document.body.append(preview);preview.addEventListener('cancel',event=>{event.preventDefault();preview.close();preview.remove();});preview.showModal();return true;
  }
  function personMarkdown(item,person){
    const comments=window.viaExportScope.forPerson(item.comments,person);
    return ['# @'+person+' 的批注与关联问答','', '来源：'+item.name,'',...comments.map(c=>['> '+c.quote,'',...c.messages.map(m=>'**'+(m.role==='via'?'Via':'我')+'**\n\n'+m.text+'\n')].join('\n'))].join('\n');
  }
  function personExport(item,person){return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='person-export-dialog demo-about';
    dialog.innerHTML='<h3>导出 @'+esc(person)+' 的批注</h3><p>只包含该对象的批注及关联问答；原文完整保留。</p><button class="export-format" data-format="md">仅引用与问答 · Markdown</button><button class="export-format" data-format="pdf">原文与 @'+esc(person)+' 的批注 · PDF</button><button class="about-close" aria-label="取消导出">取消</button>';
    document.body.append(dialog);dialog.showModal();const close=()=>{dialog.close();dialog.remove();resolve(false);};
    dialog.querySelector('.about-close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    dialog.querySelectorAll('[data-format]').forEach(button=>button.onclick=()=>{try{if(button.dataset.format==='pdf')printSource(item,person);else download(personMarkdown(item,person),person+'-批注.md');dialog.close();dialog.remove();resolve(true);}catch(error){notice(error.message);}});
  });}
  window.viaDesktop={
    isDemo:true,
    getData:async()=>({...window.viaDemoData.deriveDesktopData(read().sources),settings:read().settings,dailyReview:read().dailyReview,auth:{available:false,state:'signedOut'},ai:ai(),release:{version:'2.1.5',title:'每日复盘',summary:'两份安克示例文档 · 每日选择题 · 按日期找回问答。'}}),
    openSource:async id=>{location.href='index.html?doc='+encodeURIComponent(id);},
    removeSource:async id=>{mutate(data=>data.sources=data.sources.filter(item=>item.id!==id));return true;},
    toggleTodo:async(id,messageId,resolved)=>{mutate(data=>{const item=data.sources.find(s=>s.id===id);if(!item)throw Error('资料已移除');if(resolved)item.todoStates[messageId]={resolvedAt:new Date().toISOString()};else delete item.todoStates[messageId];});},
    exportTodos:async(id,person)=>{const item=read().sources.find(s=>s.id===id);if(!item)throw Error('资料已移除');return personExport(item,person);},
    chooseReviewAnswer:async(date,id,index)=>mutate(data=>{const packet=packetFor(data,date);if(packet.submittedAt)throw Error('已提交的答案不能改写');const q=window.viaDailyReview.questions(packet).find(q=>q.id===id);if(!q||!Number.isInteger(index)||index<0||index>=q.options.length)throw Error('无效选项');packet.choices[id]=index;}),
    submitReview:async date=>mutate(data=>{const packet=packetFor(data,date);window.viaDailyReview.grade(packet);packet.submittedAt ||= new Date().toISOString();}),
    saveReviewReminder:async time=>mutate(data=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('请选择有效时间');data.dailyReview.reminderTime=time;}),
    askDailyReview:async(date,text)=>mutate(data=>{const packet=packetFor(data,date);const message=String(text||'').trim().slice(0,1000);if(!message)return;const match=packet.questions.find(q=>message.includes(q.topic)||/幂等|重试/.test(message)&&q.id==='idempotency'||/权限|ACL|企业/.test(message)&&q.id==='acl'||/闭环|指标|采纳/.test(message)&&q.id==='adoption');const reply=match?match.answer:'这页围绕当天的原问答复盘。你可以先展开「这一天的原始问答」，核对引用与解释，再尝试用自己的话总结。当前演示使用预设回答；开放式分析需要完整安装包及 AI 连接。';packet.conversation.push({role:'user',text:message},{role:'via',text:reply});}),
    saveProfile:async(name,email,signature,avatar)=>{if(!name.trim())throw Error('请填写显示名称');if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('请填写有效的联系邮箱');return mutate(data=>Object.assign(data.settings.profile,{name,email,signature,avatar})).settings;},
    setAiProvider:async provider=>{mutate(data=>data.settings.aiProvider=provider);onAiChanged?.(ai());return ai();},
    toggleTypora:async enabled=>mutate(data=>data.settings.typoraEnabled=enabled).settings,
    setTyporaShortcut:async shortcut=>mutate(data=>data.settings.typoraShortcut=shortcut).settings,
    openLink:async url=>{if(/^https?:\/\//.test(url))window.open(url,'_blank','noopener,noreferrer');},
    minimize:()=>{},maximize:()=>{},close:()=>{location.href='index.html';},onChanged:callback=>{onChanged=callback;},
    resetDemo:async()=>{if(confirm('恢复初始演示？这会清除当前浏览器中的演示改动。')){write(clone(seed));location.reload();}}
  };
  window.via={
    chooseDocument:async()=>getDocument(),openDocument:async()=>getDocument(),
    saveRecord:async payload=>{mutate(data=>{const item=data.sources.find(s=>s.documentPath===payload.documentPath);if(!item)throw Error('资料已移除，请返回工作台。');item.comments=clone(payload.comments);item.recap=clone(payload.recap);item.updatedAt=new Date().toISOString();});return payload;},
    exportMarkdown:async payload=>download(payload.body,'Via-引用与问答.md'),
    exportPdf:async payload=>printSource(source(),payload?.person),
    aiStatus:async()=>ai(),
    answer:async payload=>{
      await new Promise(resolve=>setTimeout(resolve,750));
      const question=payload.messages.filter(m=>m.role==='user').at(-1)?.text||'';
      const examples=seed.sources.flatMap(source=>source.comments).filter(comment=>comment.messages.some(message=>message.role==='via'&&message.status==='answered'));
      const match=examples.find(comment=>payload.quote?.includes(comment.quote)||comment.quote.includes(payload.quote||'__none__'));
      const text=match ? match.messages.find(message=>message.role==='via'&&message.status==='answered').text : '这条引用还没有预制问答。当前纯前端演示不能对新的问题调用模型；可以查看两份安克文档已有的示例批注，或联系开发者获取完整安装包后配置 AI 连接。';
      return {text,source:'引用与邻近原文 · 预设演示',model:'demo',search:{status:payload.search?'unavailable':'off',provider:'demo',message:payload.search?'作品演示不联网搜索。':''},citations:[]};
    },
    openDesktop:()=>{location.href='workbench.html';},closeWindow:()=>document.body.classList.add('sidebar-closed'),minimizeWindow:()=>document.body.classList.add('sidebar-closed'),
    onLaunch:callback=>{onLaunch=callback;},onAiChanged:callback=>{onAiChanged=callback;}
  };
  window.addEventListener('storage',event=>{if(event.key===KEY){onChanged?.();const item=getDocument();if(onLaunch&&item)Promise.resolve(onLaunch(item)).catch(error=>notice(error.message));documentView();}});
  document.addEventListener('DOMContentLoaded',async()=>{
    const reading=!location.pathname.endsWith('workbench.html');document.body.classList.add(reading?'demo-reading':'demo-workbench');
    const about=document.createElement('dialog');about.className='demo-about';about.innerHTML='<button class="about-close" aria-label="关闭演示说明">×</button><span class="demo-label">VIA · INTERACTIVE DEMO</span><h2>从阅读，到下一步行动。</h2><p>这是 Via 本机 Markdown 桌面产品的纯前端演示。你可以引用、提问、回复、收藏、留下 @待办，再到工作台找回并导出。</p><p>示例文档与 AI 回答为演示内容；不会读取电脑文件、调用模型或向他人发送消息。你的操作只保存在当前浏览器。</p><button class="about-start">开始体验</button>';document.body.append(about);about.querySelector('.about-close').onclick=()=>about.close();about.querySelector('.about-start').onclick=()=>about.close();
    if(reading){
      const header=document.createElement('header');header.className='scene-header';header.innerHTML='<a class="scene-brand" href="index.html"><i>v</i><strong>Via</strong><span>你的终端 Vibe 搭子</span></a><div class="scene-links"><button class="demo-info">交互演示 ⓘ</button><a class="workspace-link" href="workbench.html">打开工作台 ↗</a></div>';document.body.prepend(header);
      const shell=document.createElement('div');shell.className='reading-shell';const sidebar=document.querySelector('body > .app');sidebar.before(shell);
      const documentPane=document.createElement('section');documentPane.className='document-pane';documentPane.setAttribute('aria-label','Markdown 原文');documentPane.innerHTML='<div class="document-bar"><span><b>T</b> <span id="readingFile"></span></span><span class="local-badge">本机 Markdown · 示例</span></div><div class="document-scroll"><article class="document-body" id="readingBody"></article><div class="document-end"><span>读完之后，思考还有下一步。</span><a href="workbench.html">查看我的待办与收藏 →</a></div></div>';
      shell.append(documentPane,sidebar);sidebar.classList.add('scene-sidecar');
      const mobile=document.createElement('nav');mobile.className='mobile-views';mobile.innerHTML='<button data-mobile="document">原文</button><button data-mobile="notes">批注</button>';header.after(mobile);mobile.querySelectorAll('button').forEach(button=>button.onclick=()=>document.body.dataset.mobileView=button.dataset.mobile);document.body.dataset.mobileView='document';
      let selection='';
      const selectionAction=document.createElement('button');selectionAction.className='selection-ask';selectionAction.textContent='问 Via · Ctrl+Q';selectionAction.hidden=true;document.body.append(selectionAction);
      selectionAction.onmousedown=e=>e.preventDefault();selectionAction.onclick=()=>{selectionAction.hidden=true;quote(selection);};
      documentPane.addEventListener('mouseup',event=>{const current=window.getSelection();selection=current?.anchorNode&&document.getElementById('readingBody').contains(current.anchorNode)?current.toString().trim():'';selectionAction.hidden=!selection;if(selection){selectionAction.style.left=Math.min(event.clientX,window.innerWidth-150)+'px';selectionAction.style.top=Math.max(70,Math.min(event.clientY+12,window.innerHeight-40))+'px';}});
      document.addEventListener('mousedown',event=>{if(event.target!==selectionAction)selectionAction.hidden=true;});
      document.querySelector('.document-scroll').addEventListener('scroll',()=>selectionAction.hidden=true);
      document.addEventListener('keydown',event=>{if(event.ctrlKey&&event.key.toLowerCase()==='q'&&!/INPUT|TEXTAREA/.test(event.target.tagName)){event.preventDefault();selectionAction.hidden=true;if(selection)quote(selection);else showSidebar();}});
      documentView();const item=getDocument();if(item)await onLaunch?.(item);
      sidebar.querySelector('.window-controls').innerHTML='<button id="collapseSidebar" aria-label="收起侧栏" title="收起侧栏">→</button>';document.getElementById('collapseSidebar').onclick=window.via.closeWindow;
      const title=sidebar.querySelector('.titlebar strong');title.textContent='文档批注';title.title='Via · 当前文档的批注';
      const footer=document.createElement('div');footer.className='sidecar-demo-note';footer.textContent='预设回答演示 · 批注保存在当前浏览器';sidebar.append(footer);
    }else{
      document.querySelector('.window-controls').innerHTML='<button class="demo-info">交互演示 ⓘ</button><a class="return-reading" href="index.html">回到阅读现场 ↗</a>';
      document.querySelector('[data-setup-later]')?.click();
    }
    document.querySelectorAll('.demo-info').forEach(button=>button.onclick=()=>about.showModal());
  });
})();
