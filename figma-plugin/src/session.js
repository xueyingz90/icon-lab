// Optional persistence through the main-thread bridge. Passwords never enter it.
export function createRememberedSession({client,send,onChange=()=>{},onStatus=()=>{},timeout=8000}){
  let remember=false,initializing=false,suspended=false,serial=0,epoch=0,writes=Promise.resolve(),refreshing;
  const pending=new Map(),baseSet=client.setSession.bind(client),baseRefresh=client.refresh.bind(client);
  const state=()=>({remember,initializing});
  function change(){onChange(state());}
  function status(text,retry=false){onStatus(text,retry);}
  function snapshot(session){
    if(!session?.access_token||!session.refresh_token||!session.user?.id||!Number.isFinite(session.expires_at))throw Error('登录会话不完整，请重新登录。');
    return {access_token:session.access_token,refresh_token:session.refresh_token,expires_at:session.expires_at,user:{id:session.user.id,email:session.user.email||''}};
  }
  function request(type,session){
    const requestId='session-'+(++serial);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('本机登录存储响应超时，请重试。'));},timeout);
      pending.set(requestId,{resolve,reject,timer});send({type,requestId,origin:client.config.url,...(session?{session}:{})});
    });
  }
  function handleMessage(data){
    if(data.type!=='session-result')return false;
    const task=pending.get(data.requestId);if(!task)return true;
    clearTimeout(task.timer);pending.delete(data.requestId);
    if(data.ok)task.resolve(data);else task.reject(Error('无法保存或清除本机登录，请重试。'));
    return true;
  }
  function queue(type,session){
    const write=writes.catch(()=>{}).then(()=>request(type,session));writes=write;
    write.catch(()=>status('无法更新本机登录记录，请重试。关闭插件前请确认保存或清除成功。'));
    return write;
  }
  client.setSession=session=>{
    baseSet(session);change();
    if(suspended)return;
    if(!session){remember=false;change();queue('session-clear');status('登录已失效或退出，请重新登录。');}
    else if(remember){try{queue('session-save',snapshot(session)).then(()=>{if(remember&&client.session?.refresh_token===session.refresh_token)status('已记住此设备的登录，不保存密码。');}).catch(()=>{});}catch(e){status(e.message);}}
  };
  // Read the latest saved refresh token before renewing across plugin windows.
  client.refresh=()=>{
    if(!refreshing){
      const started=epoch;
      refreshing=(async()=>{
        if(remember){
          await writes.catch(()=>{});const {session}=await request('session-load');
          if(started!==epoch)throw Error('登录状态已变化，请重试。');
          if(!session||session.user?.id!==client.session?.user?.id){
            remember=false;baseSet(null);change();status('本机登录记录已变化，请重新登录。');throw Error('请重新登录。');
          }
          baseSet(snapshot(session));
        }
        if(started!==epoch)throw Error('登录状态已变化，请重试。');
        const result=await baseRefresh();await writes;return result;
      })().finally(()=>{refreshing=null;});
    }
    return refreshing;
  };
  async function restore(){
    if(initializing)return false;
    const started=++epoch;let loaded=false;initializing=true;change();status('正在检查已保存的登录…');
    try{
      const {session}=await request('session-load');if(started!==epoch)return false;loaded=true;
      if(!session){remember=false;status('未勾选时，登录仅保留到本次插件关闭。');return false;}
      const saved=snapshot(session);remember=true;baseSet(saved);change();
      await client.refresh();if(started!==epoch)return false;
      status('已恢复登录。此设备会记住登录，不保存密码。');return true;
    }catch(e){
      if(started!==epoch)return false;
      if(!loaded)status('无法读取本机登录记录，请重试。仍可取消记住登录后手动登录。',true);
      else if(!client.session&&!remember){await writes.catch(()=>{});status('登录已失效，请重新登录。');}
      else {suspended=true;try{baseSet(null);}finally{suspended=false;}status('暂时无法恢复登录。检查网络后重试，或取消“记住登录”并重新登录。',true);}
      return false;
    }finally{if(started===epoch){initializing=false;change();}}
  }
  async function setRemember(value){
    remember=!!value;change();
    if(!remember){++epoch;initializing=false;await queue('session-clear');status(client.session?'已清除本机记录；本次登录仍可使用。':'已清除本机登录记录。');}
    else if(client.session){await queue('session-save',snapshot(client.session));status('已记住此设备的登录，不保存密码。');}
    else status('登录成功后，将记住此设备的登录。');
    change();
  }
  return {restore,setRemember,handleMessage,state,commitLogin:()=>remember?writes:queue('session-clear'),flush:()=>writes};
}
