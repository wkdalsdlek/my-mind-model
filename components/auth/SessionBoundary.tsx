"use client";
import { useEffect, useState, type ReactNode } from "react";
export default function SessionBoundary({children}:{children:ReactNode}) {
  const [unavailable,setUnavailable]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{
    let alive=true;
    const check=async()=>{
      try{const r=await fetch('/api/auth/get-session',{cache:'no-store',signal:AbortSignal.timeout(10000)});
        if(!alive)return;
        if(r.status===401||r.status===403){window.location.replace('/login');return;}
        setUnavailable(!r.ok);
      }catch{if(alive)setUnavailable(true);}
    };
    const interval=setInterval(check,30000);window.addEventListener('focus',check);window.addEventListener('pageshow',check);void check();
    return()=>{alive=false;clearInterval(interval);window.removeEventListener('focus',check);window.removeEventListener('pageshow',check);};
  },[]);
  async function logout(){
    setBusy(true);
    try{const r=await fetch('/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      if(r.ok){window.location.replace('/login');return;}setUnavailable(true);
    }catch{setUnavailable(true);}finally{setBusy(false);}
  }
  return <>{children}<button type="button" onClick={logout} disabled={busy} style={{position:'fixed',right:12,bottom:12,zIndex:90,padding:'8px 14px',borderRadius:18,background:'#181124',color:'#fff',border:'1px solid #65517b'}} aria-label="로그아웃">{busy?'종료 중…':'로그아웃'}</button>
    {unavailable&&<div role="alert" style={{position:'fixed',inset:0,zIndex:100,background:'#100a20f5',color:'white',display:'grid',placeContent:'center',padding:24}}><p>세션을 확인하지 못했습니다. 답변은 현재 화면에 보존됩니다.</p><p>연결 복구 후 자동으로 다시 확인합니다.</p><button onClick={logout} disabled={busy}>로그아웃 다시 시도</button></div>}</>;
}
