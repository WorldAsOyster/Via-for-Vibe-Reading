(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.viaExportScope=factory();})(globalThis,function(){
  const mentions = text => [...String(text||'').matchAll(/@([^\s@，。！？、：；,.!?;:]+)/g)].map(m=>m[1]).filter(name=>name.toLowerCase()!=='via');
  function forPerson(comments,person){
    if(!person)return structuredClone(comments||[]);
    return (comments||[]).flatMap(comment=>{
      const messages=comment.messages||[],byId=new Map(messages.map(m=>[m.id,m]));
      const selected=new Set(messages.filter(m=>m.role==='user'&&mentions(m.text).includes(person)).map(m=>m.id));
      if(!selected.size)return [];
      const allowed=m=>m.role!=='user'||!mentions(m.text).length||mentions(m.text).includes(person);
      // Retain the original question/answer ancestors needed by this person's task.
      for(const id of [...selected]){let next=byId.get(id)?.replyTo;const visited=new Set();while(next&&!visited.has(next)){visited.add(next);const parent=byId.get(next);if(!parent||!allowed(parent))break;selected.add(next);next=parent.replyTo;}}
      let changed=true;while(changed){changed=false;for(const m of messages)if(m.replyTo&&selected.has(m.replyTo)&&!selected.has(m.id)&&allowed(m)){selected.add(m.id);changed=true;}}
      return [{...structuredClone(comment),messages:messages.filter(m=>selected.has(m.id)).map(m=>structuredClone(m))}];
    });
  }
  return {mentions,forPerson};
});
