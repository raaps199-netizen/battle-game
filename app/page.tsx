"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Home(){
 const [name,setName]=useState(""),[roomCode,setRoomCode]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function create(){
  if(!name.trim())return setError("Nama dulu jir.");
  setBusy(true);setError("");
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"create",name:name.trim()}});
  if(e||!data){setError(e?.message??"Gagal bikin room.");setBusy(false);return}
  sessionStorage.setItem("werewolf_player_id",data.player_id);sessionStorage.setItem("werewolf_session",data.session_token);
  window.location.href="/lobby/"+data.room.code;
 }
 async function join(){
  if(!name.trim()||!roomCode.trim())return setError("Nama sama kode room isi dulu.");
  setBusy(true);setError("");
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"join",name:name.trim(),code:roomCode.trim().toUpperCase()}});
  if(e||!data){setError(e?.message??"Gagal join room.");setBusy(false);return}
  sessionStorage.setItem("werewolf_player_id",data.player_id);sessionStorage.setItem("werewolf_session",data.session_token);
  window.location.href="/lobby/"+data.room.code;
 }
 return <main className="landing"><div className="landing-card">
   <div className="brand">WEREWOLF<span>//</span>ONLINE</div><div className="eyebrow">SOCIAL DEDUCTION · REALTIME</div>
   <h1>WHO IS LYING?</h1><p className="muted">Masuk room, role diacak server, lalu cari siapa yang malam-malam bikin masalah. Manusia memang senang konflik yang punya aturan.</p>
   <input value={name} onChange={e=>setName(e.target.value)} placeholder="NAMA PEMAIN" maxLength={20}/>
   <div className="join-row"><input value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} placeholder="KODE ROOM" maxLength={8}/><button onClick={join} disabled={busy}>JOIN</button></div>
   <button className="primary" onClick={create} disabled={busy}>{busy?"CONNECTING...":"CREATE ROOM"}</button>
   {error&&<div className="error">{error}</div>}<div className="tiny">3–20 PLAYERS · WEREWOLF / SEER / DOCTOR / HUNTER / VILLAGER</div>
 </div></main>
}