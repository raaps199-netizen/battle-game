"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Player={id:string;name:string;is_alive:boolean;created_at:string};
type Room={id:string;code:string;status:"lobby"|"active"|"finished";round:number;host_player_id:string|null};
type Phase="lobby"|"night"|"resolution"|"day"|"voting"|"hunter"|"game_over";

const roles:Record<string,{name:string;icon:string;desc:string}>={
 WEREWOLF:{name:"Werewolf",icon:"☾",desc:"Bangun tiap malam dan pilih korban bersama serigala lain."},
 SEER:{name:"Seer",icon:"◉",desc:"Tiap malam cek satu pemain dan server memberi hasil hanya ke Seer."},
 DOCTOR:{name:"Doctor",icon:"✚",desc:"Tiap malam lindungi satu pemain dari serangan."},
 HUNTER:{name:"Hunter",icon:"⌁",desc:"Kalau mati, mendapat kesempatan menentukan satu pemain lain."},
 VILLAGER:{name:"Villager",icon:"○",desc:"Tidak punya skill malam. Menang lewat diskusi dan voting."},
};

const code=()=>Math.random().toString(36).slice(2,8).toUpperCase();

export default function GameRoom(){
 const [name,setName]=useState(""),[roomCode,setRoomCode]=useState(""),[room,setRoom]=useState<Room|null>(null);
 const [players,setPlayers]=useState<Player[]>([]),[myId,setMyId]=useState(""),[myRole,setMyRole]=useState<string|null>(null);
 const [allies,setAllies]=useState<{id:string;name:string}[]>([]),[seerResult,setSeerResult]=useState<{player_name:string;role:string}|null>(null);
 const [nightProgress,setNightProgress]=useState<{submitted:number;required:number}|null>(null),[myNightAction,setMyNightAction]=useState<{target_player_id:string}|null>(null),[voteProgress,setVoteProgress]=useState<any>(null),[myVote,setMyVote]=useState<any>(null);
 const [selectedTarget,setSelectedTarget]=useState(""),[selectedVote,setSelectedVote]=useState(""),[lastNightSummary,setLastNightSummary]=useState("");
 const [phase,setPhase]=useState<Phase>("lobby"),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const [showIntro,setShowIntro]=useState(false),[introShown,setIntroShown]=useState(false);
 const [messages,setMessages]=useState<any[]>([]),[message,setMessage]=useState("");

 const me=players.find(p=>p.id===myId),alive=players.filter(p=>p.is_alive),role=myRole?roles[myRole]:null;
 const canActAtNight=["WEREWOLF","SEER","DOCTOR"].includes(myRole??"");
 const nightTargets=alive.filter(p=>myRole==="DOCTOR"||(p.id!==myId&&!allies.some(a=>a.id===p.id)));

 useEffect(()=>{let id=sessionStorage.getItem("werewolf_player_id");if(!id){const legacyId=localStorage.getItem("werewolf_player_id");const legacyToken=localStorage.getItem("werewolf_session");if(legacyId&&legacyToken){id=legacyId;sessionStorage.setItem("werewolf_player_id",id);sessionStorage.setItem("werewolf_session",legacyToken)}}if(!id){id=crypto.randomUUID();sessionStorage.setItem("werewolf_player_id",id)}setMyId(id)},[]);

 async function load(id:string){
   const playerId=sessionStorage.getItem("werewolf_player_id");
   const sessionToken=sessionStorage.getItem("werewolf_session");
   if(!playerId||!sessionToken)return;
   const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{
    action:"snapshot",room_id:id,player_id:playerId,session_token:sessionToken
   }});
   if(e||!data){setError(e?.message??"Gagal memuat room.");return}
   if(data.room?.status==="lobby"){window.location.href="/lobby/"+data.room.code;return} if(data.room?.status==="finished"){window.location.href="/";return} if(data.room)setRoom(data.room);
   if(Array.isArray(data.players))setPlayers(data.players);
   if(["lobby","night","resolution","day","voting","hunter","game_over"].includes(data.phase))setPhase(data.phase);
   setNightProgress(data.night_progress??null);
   setLastNightSummary(data.last_night_summary??"");
   if(data.phase==="night"){
    setMyNightAction(data.my_night_action??null);
    if(data.my_night_action?.target_player_id)setSelectedTarget((current:string)=>current||data.my_night_action.target_player_id);
   }else{setMyNightAction(null);setSelectedTarget("");}
 }
 useEffect(()=>{const playerId=sessionStorage.getItem("werewolf_player_id");if(!playerId){window.location.href="/";return}load("");},[]);
 async function loadChat(id:string){
   const {data}=await supabase.from("chat_messages").select("id,body,player_id,created_at").eq("room_id",id).eq("channel","general").order("created_at",{ascending:true}).limit(100);
   if(data)setMessages(data);
 }
 useEffect(()=>{if(!room?.id)return;load(room.id);loadChat(room.id);
   const c=supabase.channel("ww-"+room.id)
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"chat_messages",filter:"room_id=eq."+room.id},()=>loadChat(room.id))
    .subscribe();
   const poll=setInterval(()=>load(room.id),1500);
   const chatPoll=setInterval(()=>loadChat(room.id),5000);
   return()=>{clearInterval(poll);clearInterval(chatPoll);supabase.removeChannel(c)}
 },[room?.id]);

 useEffect(()=>{if(room?.status==="active"&&myId)fetchRole(myId)},[room?.status,myId,phase]);

 async function start(){
  if(!room||room.host_player_id!==myId)return;
  setBusy(true);const {error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"start",room_id:room.id,player_id:myId,session_token:sessionStorage.getItem("werewolf_session")}});
  if (e) {
    let detail = e.message;
    try {
      const response = (e as unknown as { context?: Response }).context;
      if (response) {
        const body = await response.clone().json();
        if (typeof body?.error === "string") detail = body.error;
      }
    } catch {
      // Keep the original SDK error when no JSON response is available.
    }
    setError(detail);
  } else {
    setNotice("ROLE DIACAK · GAME DIMULAI");setShowIntro(true);
    await load(room.id);
    await fetchRole(myId);
  }
  setBusy(false);
 }
 async function fetchRole(id:string){
  const token=sessionStorage.getItem("werewolf_session");if(!token)return;
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"role",player_id:id,session_token:token}});
  if(!e&&data?.role){
   setMyRole(data.role); if(!introShown){setShowIntro(true);setIntroShown(true);}
   setAllies(Array.isArray(data.allies)?data.allies:[]);
   setSeerResult(data.seer_result??null);
  }
 }
 async function nightAction(){
  if(!room||!myId||!selectedTarget||!canActAtNight)return;
  setBusy(true);setError("");
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{
   action:"night_action",player_id:myId,session_token:sessionStorage.getItem("werewolf_session"),target_player_id:selectedTarget
  }});
  if(e||!data?.submitted){
   let detail=data?.error??e?.message??"Aksi malam gagal dikirim.";
   try{const response=(e as unknown as {context?:Response})?.context;if(response){const body=await response.clone().json();if(typeof body?.error==="string")detail=body.error}}catch{}
   setError(detail);setBusy(false);return;
  }
  setNotice("AKSI MALAM TERSIMPAN");
  await load(room.id);
  setBusy(false);
 }
 async function startVoting(){
  if(!room||room.host_player_id!==myId)return;setBusy(true);
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"start_voting",player_id:myId,session_token:sessionStorage.getItem("werewolf_session")}});
  if(e||!data?.started)setError(data?.error??e?.message??"Gagal membuka voting.");else{setNotice("VOTING DIBUKA");await load(room.id)}setBusy(false);
 }
 async function vote(){
  if(!room||!selectedVote)return;setBusy(true);
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"vote",player_id:myId,session_token:sessionStorage.getItem("werewolf_session"),target_player_id:selectedVote}});
  if(e||!data?.voted)setError(data?.error??e?.message??"Vote gagal.");else{setNotice("VOTE TERSIMPAN");await load(room.id)}setBusy(false);
 }
 async function resolveVotes(){
  if(!room||room.host_player_id!==myId)return;setBusy(true);
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"resolve_votes",player_id:myId,session_token:sessionStorage.getItem("werewolf_session")}});
  if(e||!data?.resolved)setError(data?.error??e?.message??"Voting gagal.");else{setNotice(data.summary??"VOTING SELESAI");await load(room.id);await fetchRole(myId)}setBusy(false);
 }
 async function hunterAction(){
  if(!room||!selectedTarget)return;setBusy(true);
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"hunter_action",player_id:myId,session_token:sessionStorage.getItem("werewolf_session"),target_player_id:selectedTarget}});
  if(e||!data?.submitted)setError(data?.error??e?.message??"Hunter gagal.");else{setNotice("TARGET HUNTER DIPILIH");await load(room.id)}setBusy(false);
 }
 async function resolveHunter(){
  if(!room||room.host_player_id!==myId)return;setBusy(true);
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{action:"resolve_hunter",player_id:myId,session_token:sessionStorage.getItem("werewolf_session")}});
  if(e||!data?.resolved)setError(data?.error??e?.message??"Hunter gagal diselesaikan.");else{setNotice(data.summary??"HUNTER SELESAI");await load(room.id);await fetchRole(myId)}setBusy(false);
 }
 async function resolveNight(){
  if(!room||!myId||room.host_player_id!==myId)return;
  setBusy(true);setError("");
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{
   action:"resolve_night",player_id:myId,session_token:sessionStorage.getItem("werewolf_session")
  }});
  if(e||!data?.resolved){
   let detail=data?.error??e?.message??"Malam gagal diselesaikan.";
   try{const response=(e as unknown as {context?:Response})?.context;if(response){const body=await response.clone().json();if(typeof body?.error==="string")detail=body.error}}catch{}
   setError(detail);await load(room.id);setBusy(false);return;
  }
  setNotice(data.summary??"MALAM SELESAI");
  await load(room.id);
  await loadChat(room.id);
  setBusy(false);
 }
 async function send(){
  if(!room||!myId||!message.trim())return;
  const body=message.trim();
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{
   action:"chat_send",player_id:myId,session_token:sessionStorage.getItem("werewolf_session"),message:body,channel:"general"
  }});
  if(e||!data?.message){setError(e?.message??data?.error??"Pesan gagal dikirim.");return}
  const saved=data.message;
  setMessages(prev=>prev.some(m=>m.id===saved.id)?prev:[...prev,saved].sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime()).slice(-100));
  setMessage("");
 }
 async function leave(){
  if(!room||!myId)return;
  setBusy(true);
  const {data,error:e}=await supabase.functions.invoke("werewolf-api",{body:{
   action:"leave",player_id:myId,session_token:sessionStorage.getItem("werewolf_session")
  }});
  if(e||!data?.left){setError(e?.message??data?.error??"Gagal keluar dari room.");setBusy(false);return}
  sessionStorage.removeItem("werewolf_player_id");sessionStorage.removeItem("werewolf_session");
  setRoom(null);setPlayers([]);setMyRole(null);setAllies([]);setSeerResult(null);setNightProgress(null);setMyNightAction(null);setSelectedTarget("");setLastNightSummary("");setPhase("lobby");setMessages([]);
  setBusy(false);
 }

 return <main className="game"><header className="top"><div className="brand">WEREWOLF<span>//</span>ONLINE</div><div className="room">ROOM <b>{room.code}</b></div><div className="phase">{phase.toUpperCase()} · ROUND {room.round}</div></header>
 <section className="layout">
  <aside className="panel players"><div className="panel-head">PLAYERS <span>{alive.length}/{players.length} ALIVE</span></div>
   {players.map((p,i)=><div className={"player "+(p.id===myId?"me":"")} key={p.id}><div className="avatar">{i+1}</div><div className="player-name">{p.name}<small>{p.id===myId?"YOU · "+(p.is_alive?"READY":"DEAD"):(p.is_alive?"ALIVE":"DEAD")}</small></div></div>)}
   {phase==="lobby"&&<button className="leave" onClick={leave}>LEAVE ROOM</button>}
  </aside>
  <section className="center">{phase==="lobby"?<div className="lobby-main"><div className="eyebrow">LOBBY · {players.length}/20</div><h2>WAITING FOR THE VILLAGE</h2><p className="muted">Minimal 3 pemain. Host memulai game dan server akan mengacak role.</p><div className="code-box">{room.code}</div><div className="lobby-actions"><button className="secondary" onClick={()=>navigator.clipboard.writeText(room.code)}>COPY CODE</button><button className="primary" onClick={start} disabled={room.host_player_id!==myId||players.length<3||busy}>START GAME</button></div></div>
   :<div className="board"><div className="moon">☾</div><div className="eyebrow">{phase==="night"?"THE VILLAGE IS ASLEEP":phase==="day"?"THE VILLAGE WAKES":"SOMEONE MUST ANSWER"}</div><h2>{phase.toUpperCase()} {room.round}</h2>
    {role&&<div className="role-reveal"><div className="role-icon">{role.icon}</div><div><span>YOUR ROLE</span><strong>{role.name}</strong><p>{role.desc}</p></div></div>}
    {phase==="night"&&<div className="day-card night-card">
      <strong>NIGHT ACTIONS</strong>
      {myRole==="WEREWOLF"&&<p>Tim serigala: pilih pemain hidup di luar timmu. {allies.length?("Rekanmu: "+allies.map(a=>a.name).join(", ")): "Kamu satu-satunya serigala."}</p>}
      {myRole==="SEER"&&<p>Pilih satu pemain hidup untuk diperiksa. Hasilnya hanya terlihat oleh kamu saat siang.</p>}
      {myRole==="DOCTOR"&&<p>Pilih satu pemain hidup untuk dilindungi. Kamu boleh melindungi diri sendiri, tetapi tidak boleh memilih target yang sama dua malam berturut-turut.</p>}
      {myRole==="VILLAGER"&&<p>Kamu tidak punya aksi malam. Tunggu sampai desa bangun.</p>}
      {myRole==="HUNTER"&&<p>Kamu tidak punya aksi malam. Skill Hunter belum aktif di milestone ini.</p>}
      {canActAtNight&&<div className="target-grid">{nightTargets.map(p=><button key={p.id} className={"target-choice "+(selectedTarget===p.id?"selected":"")} onClick={()=>setSelectedTarget(p.id)}>{p.name}{p.id===myId?" · YOU":""}</button>)}</div>}
      {canActAtNight&&<button className="primary action-submit" onClick={nightAction} disabled={busy||!selectedTarget}>{myNightAction?"UPDATE ACTION":"SUBMIT ACTION"}</button>}
      <div className="action-progress">{myNightAction?"✓ Aksimu sudah tersimpan.":canActAtNight?"Pilih target lalu kirim aksi.":"Menunggu pemain dengan aksi malam."} <b>{nightProgress?.submitted??0}/{nightProgress?.required??0} ACTIONS SUBMITTED</b></div>
      {room.host_player_id===myId&&<div className="host-resolve"><button className="primary resolve-button" onClick={resolveNight} disabled={busy}>RESOLVE NIGHT</button><small>{nightProgress?`${nightProgress.submitted}/${nightProgress.required} aksi wajib terkirim`:"Menunggu status aksi..."}</small></div>}
    </div>}
    {phase==="resolution"&&<div className="day-card"><strong>RESOLVING NIGHT</strong><p>Server sedang menghitung pilihan, perlindungan, korban, dan kondisi menang.</p></div>}
    {phase==="day"&&<div className="day-card"><strong>☀️ THE VILLAGE WAKES</strong><p>{lastNightSummary||"Malam telah selesai."}</p>{seerResult&&<div className="seer-result">🔮 HASIL RAHASIA: <b>{seerResult.player_name}</b> adalah <b>{roles[seerResult.role]?.name??seerResult.role}</b>. Hanya kamu yang melihat ini.</div>}<p className="day-hint">💬 Diskusi terbuka. Bongkar alibi, cari kontradiksi, lalu voting.</p>{room.host_player_id===myId&&<button className="primary" onClick={startVoting} disabled={busy}>⚖️ OPEN VOTING</button>}</div>}
    {phase==="voting"&&<div className="day-card"><strong>⚖️ VILLAGE VOTE</strong><p>Pilih pemain yang paling kamu curigai. Vote bisa diubah sebelum host membuka hasil.</p><div className="target-grid">{alive.map(p=><button key={p.id} className={"target-choice "+(selectedVote===p.id?"selected":"")} onClick={()=>setSelectedVote(p.id)}>{p.name}</button>)}</div><button className="primary action-submit" onClick={vote} disabled={busy||!selectedVote||!me?.is_alive}>{myVote?"CHANGE VOTE":"CAST VOTE"}</button><div className="action-progress"><b>{voteProgress?.submitted??0}/{voteProgress?.required??0} VOTES CAST</b></div>{room.host_player_id===myId&&<button className="primary resolve-button" onClick={resolveVotes} disabled={busy}>REVEAL VOTES</button>}</div>}
    {phase==="hunter"&&<div className="day-card"><strong>🏹 HUNTER'S LAST SHOT</strong><p>Hunter sudah mati. Pilih satu pemain untuk ditembak.</p>{myRole==="HUNTER"&&!me?.is_alive&&<><div className="target-grid">{alive.map(p=><button key={p.id} className={"target-choice "+(selectedTarget===p.id?"selected":"")} onClick={()=>setSelectedTarget(p.id)}>{p.name}</button>)}</div><button className="primary action-submit" onClick={hunterAction} disabled={!selectedTarget||busy}>🔥 FIRE</button></>}{room.host_player_id===myId&&<button className="primary resolve-button" onClick={resolveHunter} disabled={busy}>RESOLVE HUNTER</button>}</div>}
{phase==="game_over"&&<div className="day-card game-over"><strong>🏁 GAME OVER</strong><p>{lastNightSummary||"Permainan selesai."}</p></div>}
   </div>}</section>
  <aside className="panel chat"><div className="panel-head">VILLAGE CHAT <span>LIVE</span></div><div className="messages">{messages.map(m=><div className="msg" key={m.id}><b>{players.find(p=>p.id===m.player_id)?.name??"PLAYER"}</b><p>{m.body}</p></div>)}{!messages.length&&<div className="empty">Belum ada pesan.</div>}</div>
   {(phase==="lobby"||phase==="day"||phase==="voting")?<div className="chat-input"><input value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ketik pesan..." maxLength={500}/><button onClick={send}>SEND</button></div>:<div className="chat-closed">Village chat ditutup selama malam.</div>}
  </aside>
 </section><footer className="bottom"><span>PLAYER: {me?.name??"-"}</span><span>ROLE: {myRole?role?.name.toUpperCase():"PRIVATE"}</span><span>{room.host_player_id===myId?"HOST":"PLAYER"} · REALTIME CONNECTED</span></footer>
 {showIntro&&<div className="intro-overlay"><div className={"intro-card "+(myRole?.toLowerCase()??"")}>
  <div className="intro-stars"></div><div className="intro-orb"></div><div className="intro-mark">{role?.icon||"☾"}</div><div className="intro-line"></div>
  <div className="eyebrow">ROLE INTRODUCTION · ROUND {room.round}</div>
  <h2>{role?.name?.toUpperCase()||"YOUR ROLE"}</h2>
  <p>{myRole==="WEREWOLF"?"Kamu bagian dari tim Werewolf. Berpura-puralah sebagai warga, koordinasikan korban, dan jangan sampai identitas timmu terbongkar.":myRole==="SEER"?"Kamu adalah mata desa. Setiap malam kamu dapat memeriksa satu pemain dan mengetahui role aslinya.":myRole==="DOCTOR"?"Kamu adalah pelindung desa. Setiap malam lindungi satu pemain dari serangan Werewolf.":myRole==="HUNTER"?"Kamu adalah Hunter. Kalau kamu mati, kamu mendapat satu kesempatan terakhir untuk menembak pemain hidup.":"Kamu adalah Villager. Tidak punya aksi malam, jadi kekuatanmu ada di pengamatan, diskusi, dan voting."}</p>
  <div className="intro-rules">
    <div><b>ROLE</b><span>{role?.desc}</span></div>
    <div><b>YOUR GOAL</b><span>{myRole==="WEREWOLF"?"Buat jumlah Werewolf setidaknya sama dengan warga yang tersisa.":"Temukan dan singkirkan semua Werewolf sebelum mereka menguasai desa."}</span></div>
    <div><b>YOUR ACTION</b><span>{myRole==="WEREWOLF"?"Pilih korban bersama timmu.":myRole==="SEER"?"Pilih satu pemain untuk diperiksa.":myRole==="DOCTOR"?"Pilih satu pemain untuk dilindungi.":myRole==="HUNTER"?"Jika mati, pilih satu target untuk ditembak.":"Tidak ada aksi malam. Gunakan diskusi dan voting."}</span></div>
  </div>
  {myRole==="WEREWOLF"&&<div className="intro-role"><span>YOUR PACK</span><strong>{allies.length?allies.map(a=>a.name).join(" · "):"YOU STAND ALONE"}</strong><small>Jangan pernah membocorkan daftar ini ke desa.</small></div>}
  <div className="intro-role"><span>GAME FLOW</span><strong>🌙 NIGHT → ☀️ DAY → ⚖️ VOTE</strong><small>Malam untuk kemampuan rahasia. Siang untuk diskusi. Voting menentukan siapa yang tersingkir. Jika Hunter mati, dia mendapat fase khusus.</small></div>
  <button className="primary intro-button" onClick={()=>setShowIntro(false)}>UNDERSTAND · ENTER NIGHT</button>
</div></div>}
{notice&&<div className="toast">✓ {notice}</div>}{error&&<div className="toast error-toast">{error}</div>}
 </main>
}