"use client";
import { useEffect,useState } from "react";
import { supabase } from "@/lib/supabase";
import "../../../app/globals.css";
type Player={id:string;name:string;is_alive:boolean;created_at:string};
type Room={id:string;code:string;status:"lobby"|"active"|"finished";round:number;host_player_id:string|null};
export default function Lobby(){
 const [room,setRoom]=useState<Room|null>(null),[players,setPlayers]=useState<Player[]>([]),[myId,setMyId]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const code=typeof window!=="undefined"?window.location.pathname.split("/").pop()?.toUpperCase()||"":"";
 useEffect(()=>{setMyId(sessionStorage.getItem("werewolf_player_id")||"")},[]);
 async function load(){
  const playerId=sessionStorage.getItem("werewolf_player_id"),token=sessionStorage.getItem("werewolf_session");
  if(!playerId||!token){window.location.href="/";return}
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"snapshot",player_id:playerId,session_token:token}});
  if(e||!data){setError(e?.message||"Session room tidak ditemukan.");return}
  if(data.room?.status==="active"){window.location.href="/game/"+data.room.code;return}
  if(data.room?.status==="finished"){window.location.href="/";return}
  setRoom(data.room);setPlayers(data.players||[]);
 }
 useEffect(()=>{load();const t=setInterval(load,1500);return()=>clearInterval(t)},[]);
 async function start(){
  if(!room||room.host_player_id!==myId)return;setBusy(true);
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"start",room_id:room.id,player_id:myId,session_token:sessionStorage.getItem("werewolf_session")}});
  if(e||data?.error){setError(data?.error??e?.message??"Gagal mulai game.");setBusy(false);return}
  window.location.href="/game/"+room.code;
 }
 async function leave(){
  setBusy(true);const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"leave",player_id:myId,session_token:sessionStorage.getItem("werewolf_session")}});
  if(e||!data?.left){setError(e?.message??data?.error??"Gagal keluar.");setBusy(false);return}
  sessionStorage.removeItem("werewolf_player_id");sessionStorage.removeItem("werewolf_session");window.location.href="/";
 }
 if(!room)return <main className="landing"><div className="landing-card"><div className="brand">WEREWOLF<span>//</span>ONLINE</div><div className="eyebrow">LOADING LOBBY</div><h1>{code}</h1><p className="muted">{error||"Menghubungkan ke room..."}</p></div></main>;
 return <main className="game"><header className="top"><div className="brand">WEREWOLF<span>//</span>ONLINE</div><div className="room">ROOM <b>{room.code}</b></div><div className="phase">LOBBY · {players.length}/20</div></header>
 <section className="layout"><aside className="panel players"><div className="panel-head">PLAYERS <span>{players.length}/20</span></div>
 {players.map((p,i)=><div className={"player "+(p.id===myId?"me":"")} key={p.id}><div className="avatar">{i+1}</div><div className="player-name">{p.name}<small>{p.id===myId?"YOU":"READY"}</small></div></div>)}
 <button className="leave" onClick={leave} disabled={busy}>LEAVE ROOM</button></aside>
 <section className="center"><div className="lobby-main"><div className="eyebrow">PRIVATE LOBBY · {players.length}/20</div><h2>WAITING FOR THE VILLAGE</h2><p className="muted">Bagikan kode ini ke pemain lain. Begitu host menekan start, semua pemain otomatis pindah ke Game Room.</p>
 <div className="code-box">{room.code}</div><div className="lobby-actions"><button className="secondary" onClick={()=>navigator.clipboard.writeText(room.code)}>COPY CODE</button><button className="primary" onClick={start} disabled={room.host_player_id!==myId||players.length<3||busy}>{busy?"STARTING...":"START GAME"}</button></div>
 {room.host_player_id!==myId&&<p className="muted" style={{marginTop:18}}>Menunggu host memulai game...</p>}{error&&<div className="error">{error}</div>}</div></section>
 <aside className="panel chat"><div className="panel-head">LOBBY STATUS <span>LIVE</span></div><div className="messages"><div className="empty">Lobby terpisah dari Game Room.<br/><br/>HOST: {players.find(p=>p.id===room.host_player_id)?.name??"..."}</div></div></aside></section>
 <footer className="bottom"><span>ROOM: {room.code}</span><span>PLAYER: {players.find(p=>p.id===myId)?.name??"-"}</span><span>{room.host_player_id===myId?"HOST":"PLAYER"} · LOBBY</span></footer></main>;
}