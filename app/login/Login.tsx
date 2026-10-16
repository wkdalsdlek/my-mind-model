"use client";
import { useState, type FormEvent } from "react";
export default function Login(){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function login(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    const data=new FormData(event.currentTarget);
    try{const r=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:data.get('email'),password:data.get('password')})});
      if(r.ok){window.location.replace('/');return;}
      setError(r.status===429?'잠시 후 다시 시도해 주세요.':r.status>=500?'인증 서비스를 사용할 수 없습니다. 관리자에게 문의해 주세요.':'로그인 정보 또는 초대 계정 상태를 확인해 주세요.');
    }catch{setError('인증 서버에 연결하지 못했습니다.');}finally{setBusy(false);}
  }
  return <main style={{minHeight:'100dvh',background:'#08050e',display:'grid',placeItems:'center',color:'white',padding:24}}><form onSubmit={login} style={{width:'min(100%,360px)',display:'grid',gap:18,padding:30,border:'1px solid #3f3152',borderRadius:28}}>
    <h1>나의 마음 우주</h1><p>초대받은 계정으로 입장해 주세요.</p>
    <label>이메일<input name="email" type="email" autoComplete="username" required maxLength={254} style={{display:'block',width:'100%',padding:12}}/></label>
    <label>비밀번호<input name="password" type="password" autoComplete="current-password" required maxLength={128} style={{display:'block',width:'100%',padding:12}}/></label>
    <button type="submit" disabled={busy} style={{padding:12,background:'#8434bf',color:'white',borderRadius:18}}>{busy?'확인 중…':'입장하기'}</button>
    {error&&<p role="alert">{error}</p>}
  </form></main>;
}
