// Only status and non-secret metadata are retained. PAT never enters browser storage.
export function initPersonalQoderUI({request}){
  const $=id=>document.getElementById(id),root=$('personal-qoder-settings');
  let busy=false;
  const fields=['qoder-pat','qoder-agent','qoder-environment','qoder-model','qoder-budget'];
  const message=(text,error=false)=>{$('qoder-status').textContent=text;$('qoder-status').dataset.error=String(error);};
  function lock(value){busy=value;fields.forEach(id=>$(id).disabled=value);$('qoder-save').disabled=value;$('qoder-remove').disabled=value;root.setAttribute('aria-busy',String(value));}
  function show(status){
    $('qoder-pat').value='';$('qoder-pat').placeholder=status.configured?'已加密保存；留空保留原 PAT':'pt-…';
    $('qoder-agent').value=status.agentId||'';$('qoder-environment').value=status.environmentId||'';
    $('qoder-model').value=status.model||'ultimate';$('qoder-budget').value=status.credits||'10.00';
    $('qoder-remove').hidden=!status.configured;
    message(status.configured?'云端连接使用你的 Qoder 配置；已加密保存，可跨设备使用。':'云端连接使用团队接口。填写以下信息可改用自己的 Qoder。');
  }
  async function run(action){if(busy)return;lock(true);try{await action();}catch(error){message(error.message,true);}finally{$('qoder-pat').value='';lock(false);}}
  const call=body=>request({operation:'credentials',...body},{transport:'cloud'});
  $('ai-connection-details').addEventListener('toggle',()=>{if($('ai-connection-details').open)run(async()=>{message('正在读取个人配置状态…');show(await call({action:'status'}));});else $('qoder-pat').value='';});
  $('qoder-save').onclick=()=>run(async()=>{
    const config={key:$('qoder-pat').value,agentId:$('qoder-agent').value,environmentId:$('qoder-environment').value,model:$('qoder-model').value,credits:$('qoder-budget').value};
    message('正在检查 Qoder 连接并加密保存…');
    try{show(await call({action:'save',config}));}finally{config.key='';}
  });
  $('qoder-remove').onclick=()=>run(async()=>{message('正在移除个人配置…');show(await call({action:'remove'}));});
  window.addEventListener('pagehide',()=>{$('qoder-pat').value='';});
}
