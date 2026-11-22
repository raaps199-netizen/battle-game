"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Player={id:string;name:string;is_alive:boolean;created_at:string};
type Room={id:string;code:string;status:"lobby"|"active"|"finished";round:number;host_player_id:string|null};
type Phase="lobby"|"night"|"day"|"voting"|"game_over";

const roles:Record<string,{name:string;icon:string;desc:string}>={
 WEREWOLF:{name:"Werewolf",icon:"☾",desc:"Bangun tiap malam dan pilih korban bersama serigala lain."},
 SEER:{name:"Seer",icon:"◉",desc:"Tiap malam cek satu pemain dan server memberi hasil hanya ke Seer."},
 DOCTOR:{name:"Doctor",icon:"✚",desc:"Tiap malam lindungi satu pemain dari serangan."},
 HUNTER:{name:"Hunter",icon:"⌁",desc:"Kalau mati, mendapat kesempatan menentukan satu pemain lain."},
 VILLAGER:{name:"Villager",icon:"○",desc:"Tidak punya skill malam. Menang lewat diskusi dan voting."},
};

const code=()=>Math.random().toString(36).slice(2,8).toUpperCase();

export default function Home(){
 const [name,setName]=useState(""),[roomCode,setRoomCode]=useState(""),[room,setRoom]=useState<Room|null>(null);
 const [players,setPlayers]=useState<Player[]>([]),[myId,setMyId]=useState(""),[myRole,setMyRole]=useState<string|null>(null);
 const [phase,setPhase]=useState<Phase>("lobby"),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const [messages,setMessages]=useState<any[]>([]),[message,setMessage]=useState("");

 const me=players.find(p=>p.id===myId),alive=players.filter(p=>p.is_alive),role=myRole?roles[myRole]:null;

 useEffect(()=>{let id=localStorage.getItem("werewolf_player_id");if(!id){id=crypto.randomUUID();localStorage.setItem("werewolf_player_id",id)}setMyId(id)},[]);

 async function load(id:string){
   const [{data:r},{data:p},{data:g}]=await Promise.all([
    supabase.from("rooms").select("id,code,status,round,host_player_id").eq("id",id).single(),
    supabase.from("players").select("id,name,is_alive,created_at").eq("room_id",id).order("created_at"),
    supabase.from("game_states").select("phase").eq("room_id",id).single()
   ]);
   if(r)setRoom(r); if(p)setPlayers(p);
   if(g&&["lobby","night","day","voting","game_over"].includes(g.phase))setPhase(g.phase);
 }
 async function loadChat(id:string){
   const {data}=await supabase.from("chat_messages").select("id,body,player_id,created_at").eq("room_id",id).eq("channel","general").order("created_at",{ascending:true}).limit(100);
   if(data)setMessages(data);
 }
 useEffect(()=>{if(!room?.id)return;load(room.id);loadChat(room.id);
   const c=supabase.channel("ww-"+room.id)
    .on("postgres_changes",{event:"*",schema:"public",table:"players",filter:"room_id=eq."+room.id},()=>load(room.id))
    .on("postgres_changes",{event:"*",schema:"public",table:"rooms",filter:"id=eq."+room.id},()=>load(room.id))
    .on("postgres_changes",{event:"*",schema:"public",table:"game_states",filter:"room_id=eq."+room.id},()=>load(room.id))
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"chat_messages",filter:"room_id=eq."+room.id},()=>loadChat(room.id))
    .subscribe();
   const poll=setInterval(()=>load(room.id),1200);
   return()=>{clearInterval(poll);supabase.removeChannel(c)}
 },[room?.id]);

 useEffect(()=>{if(room?.status==="active"&&myId&&!myRole)fetchRole(myId)},[room?.status,myId,myRole]);

 async function create(){
  if(!name.trim())return setError("Nama dulu jir.");
  setBusy(true);setError("");
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"create",name:name.trim()}});
  if(e||!data){setError(e?.message??"Gagal bikin room.");setBusy(false);return}
  localStorage.setItem("werewolf_player_id",data.player_id);localStorage.setItem("werewolf_session",data.session_token);
  setMyId(data.player_id);setRoom(data.room);await load(data.room.id);if(data.room.status==="active")await fetchRole(data.player_id);setBusy(false);
 }
 async function join(){
  if(!name.trim()||!roomCode.trim())return setError("Nama sama kode room isi dulu.");
  setBusy(true);setError("");
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"join",name:name.trim(),code:roomCode.trim().toUpperCase()}});
  if(e||!data){setError(e?.message??"Gagal join room.");setBusy(false);return}
  localStorage.setItem("werewolf_player_id",data.player_id);localStorage.setItem("werewolf_session",data.session_token);
  setMyId(data.player_id);setRoom(data.room);await load(data.room.id);setBusy(false);
 }
 async function start(){
  if(!room||room.host_player_id!==myId)return;
  setBusy(true);const {error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"start",room_id:room.id,player_id:myId,session_token:localStorage.getItem("werewolf_session")}});
  if(e)setError(e.message);else{setNotice("ROLE DIACAK · GAME DIMULAI");await load(room.id);await fetchRole(myId)}
  setBusy(false);
 }
 async function fetchRole(id:string){
  const token=localStorage.getItem("werewolf_session");if(!token)return;
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"role",player_id:id,session_token:token}});
  if(!e&&data?.role)setMyRole(data.role);
 }
 async function send(){
  if(!room||!myId||!message.trim())return;
  const {error:e}=await supabase.from("chat_messages").insert({room_id:room.id,player_id:myId,channel:"general",body:message.trim(),day:room.round});
  if(e)setError(e.message);else setMessage("");
 }
 async function leave(){
  if(!room||!myId)return;
  await supabase.from("players").delete().eq("id",myId);
  localStorage.removeItem("werewolf_player_id");localStorage.removeItem("werewolf_session");
  setRoom(null);setPlayers([]);setMyRole(null);setPhase("lobby");
 }

 if(!room)return <main className="landing"><div className="landing-card">
   <div className="brand">WEREWOLF<span>//</span>ONLINE</div><div className="eyebrow">SOCIAL DEDUCTION · REALTIME</div>
   <h1>WHO IS LYING?</h1><p className="muted">Masuk room, role diacak server, lalu cari siapa yang malam-malam bikin masalah. Manusia memang senang konflik yang punya aturan.</p>
   <input value={name} onChange={e=>setName(e.target.value)} placeholder="NAMA PEMAIN" maxLength={20}/>
   <div className="join-row"><input value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} placeholder="KODE ROOM" maxLength={8}/><button onClick={join} disabled={busy}>JOIN</button></div>
   <button className="primary" onClick={create} disabled={busy}>{busy?"CONNECTING...":"CREATE ROOM"}</button>
   {error&&<div className="error">{error}</div>}<div className="tiny">3–20 PLAYERS · WEREWOLF / SEER / DOCTOR / HUNTER / VILLAGER</div>
 </div></main>;

 return <main className="game"><header className="top"><div className="brand">WEREWOLF<span>//</span>ONLINE</div><div className="room">ROOM <b>{room.code}</b></div><div className="phase">{phase.toUpperCase()} · ROUND {room.round}</div></header>
 <section className="layout">
  <aside className="panel players"><div className="panel-head">PLAYERS <span>{alive.length}/{players.length} ALIVE</span></div>
   {players.map(p=><div className={"player "+(p.id===myId?"me":"")} key={p.id}><div className="avatar">{p.id===myId?"YOU":"?"}</div><div className="player-name">{p.name}<small>{p.is_alive?"ALIVE":"DEAD"}</small></div></div>)}
   {phase==="lobby"&&<button className="leave" onClick={leave}>LEAVE ROOM</button>}
  </aside>
  <section className="center">{phase==="lobby"?<div className="lobby-main"><div className="eyebrow">LOBBY · {players.length}/20</div><h2>WAITING FOR THE VILLAGE</h2><p className="muted">Minimal 3 pemain. Host memulai game dan server akan mengacak role.</p><div className="code-box">{room.code}</div><div className="lobby-actions"><button className="secondary" onClick={()=>navigator.clipboard.writeText(room.code)}>COPY CODE</button><button className="primary" onClick={start} disabled={room.host_player_id!==myId||players.length<3||busy}>START GAME</button></div></div>
   :<div className="board"><div className="moon">☾</div><div className="eyebrow">{phase==="night"?"THE VILLAGE IS ASLEEP":phase==="day"?"THE VILLAGE WAKES":"SOMEONE MUST ANSWER"}</div><h2>{phase.toUpperCase()} {room.round}</h2>
    {role&&<div className="role-reveal"><div className="role-icon">{role.icon}</div><div><span>YOUR ROLE</span><strong>{role.name}</strong><p>{role.desc}</p></div></div>}
    <div className="day-card"><strong>{phase==="night"?"NIGHT ACTIONS":phase==="day"?"DISCUSSION":"VOTING"}</strong><p>Fondasi game sudah aktif. Fase malam, resolusi, voting dan win-condition akan kita sambungkan setelah lobby + role assignment ini.</p></div>
   </div>}</section>
  <aside className="panel chat"><div className="panel-head">VILLAGE CHAT <span>LIVE</span></div><div className="messages">{messages.map(m=><div className="msg" key={m.id}><b>{players.find(p=>p.id===m.player_id)?.name??"PLAYER"}</b><p>{m.body}</p></div>)}{!messages.length&&<div className="empty">Belum ada pesan.</div>}</div>
   <div className="chat-input"><input value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ketik pesan..." maxLength={500}/><button onClick={send}>SEND</button></div>
  </aside>
 </section><footer className="bottom"><span>PLAYER: {me?.name??"-"}</span><span>ROLE: {myRole?role?.name.toUpperCase():"PRIVATE"}</span><span>REALTIME CONNECTED</span></footer>
 {notice&&<div className="toast">✓ {notice}</div>}{error&&<div className="toast error-toast">{error}</div>}
 </main>
}