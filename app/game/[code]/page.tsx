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
 const [showIntro,setShowIntro]=useState(false),[introShown,setIntroShown]=useState(false),[nightReportOpen,setNightReportOpen]=useState(false),[nightReportSeen,setNightReportSeen]=useState("");
 const [messages,setMessages]=useState<any[]>([]),[message,setMessage]=useState("");

 const me=players.find(p=>p.id===myId),alive=players.filter(p=>p.is_alive),role=myRole?roles[myRole]:null;
 const canActAtNight=["WEREWOLF","SEER","DOCTOR"].includes(myRole??"");
 const nightTargets=alive.filter(p=>myRole==="DOCTOR"||(p.id!==myId&&!allies.some(a=>a.id===p.id)));

 useEffect(()=>{let id=sessionStorage.getItem("werewolf_player_id");if(!id){const legacyId=localStorage.getItem("werewolf_player_id");const legacyToken=localStorage.getItem("werewolf_session");if(legacyId&&legacyToken){id=legacyId;sessionStorage.setItem("werewolf_player_id",id);sessionStorage.setItem("werewolf_session",legacyToken)}}if(!id){id=crypto.randomUUID();sessionStorage.setItem("werewolf_player_id",id)}setMyId(id)},[]);

 useEffect(()=>{\n   if(phase==="day" && lastNightSummary==="Tidak ada korban malam ini." && room){\n    const key=`${room.round}:${lastNightSummary}`;\n    if(nightReportSeen!==key){setNightReportSeen(key);setNightReportOpen(true);}\n   }\n },[phase,lastNightSummary,room?.round]);\n\n async function load(id:string){
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


 const recentCutoff = Date.now() - 18000;
 const bubbleByPlayer = new Map<string, any>();
 messages.forEach((m) => {
  if (new Date(m.created_at).getTime() >= recentCutoff) bubbleByPlayer.set(m.player_id, m);
 });
 if (!room) return <main className="game-loading"><div className="loading-mark">☾</div><p>{error || "MEMASUKI DESA..."}</p></main>;
 const selectedTargetName = players.find((p) => p.id === selectedTarget)?.name;
 const selectedVoteName = players.find((p) => p.id === selectedVote)?.name;
 const phaseTitle = phase === "night" || phase === "resolution" ? "THE VILLAGE IS ASLEEP" : phase === "day" ? "THE VILLAGE WAKES" : phase === "voting" ? "THE VILLAGE MUST DECIDE" : phase === "hunter" ? "ONE LAST SHOT" : "THE GAME HAS ENDED";
 const phaseSubtitle = phase === "night" ? "SOMEONE IS MOVING IN THE DARK" : phase === "day" ? "TALK. OBSERVE. TRUST NO ONE." : phase === "voting" ? "CHOOSE WHO LEAVES THE VILLAGE" : phase === "hunter" ? "A FINAL CHOICE BEFORE SILENCE" : "THE VILLAGE WILL REMEMBER";
 return <main className={"game game-room " + ((phase === "night" || phase === "resolution") ? "is-night" : "is-day")}>
  <header className="top game-top">
   <div className="brand">WEREWOLF<span>//</span>ONLINE</div>
   <div className="room">ROOM <b>{room.code}</b></div>
   <div className="game-top-right"><span className="phase-pill">{phase.toUpperCase()} · ROUND {room.round}</span><span className="alive-pill"><i></i>{alive.length} ALIVE</span></div>
  </header>
  <section className="gameplay-shell">
   <div className="scene-heading">
    <span className="scene-kicker">THE FORGOTTEN VILLAGE</span>
    <span className="scene-subtitle">{phaseSubtitle}</span>
   </div>
   <div className="arena">
    <div className="arena-stars"></div>
    <div className="arena-fog fog-a"></div>
    <div className="arena-fog fog-b"></div>
    <div className="arena-ring ring-outer"></div>
    <div className="arena-ring ring-inner"></div>
    <div className="village-core" key={phase}>
     <div className="core-moon">{phase === "day" || phase === "voting" ? "☀" : phase === "hunter" ? "⌁" : phase === "game_over" ? "✦" : "☾"}</div>
     <span className="core-kicker">{phase === "night" || phase === "resolution" ? "NIGHTFALL" : phase === "day" ? "DAYBREAK" : phase === "voting" ? "THE VERDICT" : phase === "hunter" ? "LAST STAND" : "FINAL CHAPTER"}</span>
     <h1>{phaseTitle}</h1>
     <p>ROUND {room.round} <span>•</span> {alive.length} OF {players.length} SOULS REMAIN</p>
     <div className="core-fire"><i></i><i></i><i></i><span>✦</span></div>
    </div>
    <div className="player-orbit">
     {players.map((p, index) => {
      const angle = (index / Math.max(players.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const targetable = p.is_alive && (
       (phase === "night" && canActAtNight && nightTargets.some((t) => t.id === p.id)) ||
       (phase === "voting" && !!me?.is_alive && p.id !== myId) ||
       (phase === "hunter" && myRole === "HUNTER" && !me?.is_alive)
      );
      const chosen = selectedTarget === p.id || selectedVote === p.id;
      const bubble = bubbleByPlayer.get(p.id);
      return <button
       type="button"
       key={p.id}
       className={"player-seat " + (p.id === myId ? "is-me " : "") + (!p.is_alive ? "is-dead " : "") + (targetable ? "is-targetable " : "") + (chosen ? "is-selected " : "") + (bubble && phase !== "night" ? "is-speaking" : "")}
       style={{left:(50 + Math.cos(angle) * 42) + "%",top:(50 + Math.sin(angle) * 37) + "%",zIndex:Math.round(10 + Math.sin(angle) * 5)}}
       disabled={!targetable}
       aria-label={p.name + (p.is_alive ? ", alive" : ", dead")}
       onClick={() => {
        if (phase === "night" && targetable) setSelectedTarget(p.id);
        if (phase === "voting" && targetable) setSelectedVote(p.id);
        if (phase === "hunter" && targetable) setSelectedTarget(p.id);
       }}
      >
       {bubble && phase !== "night" && <span className="speech-bubble" key={bubble.id}><b>{p.id === myId ? "YOU" : p.name}</b>{bubble.body}</span>}
       <span className="avatar-halo"><span className="player-avatar">{p.is_alive ? p.name.trim().charAt(0).toUpperCase() : "✕"}</span><i className="alive-dot"></i></span>
       <span className="seat-name">{p.name}</span>
       <span className="seat-status">{p.id === myId ? "YOU" : p.is_alive ? "ALIVE" : "FALLEN"}</span>
      </button>;
     })}
    </div>
   </div>
   <section className="game-dock">
    <div className="role-chip">
     <span className="role-chip-icon">{role?.icon || "?"}</span>
     <span><small>YOUR ROLE</small><strong>{role?.name || "HIDDEN"}</strong></span>
     <span className="role-chip-desc">{role?.desc || "Your identity is private."}</span>
    </div>
    <div className="phase-console">
     {phase === "night" && <div className="phase-console-inner">
      <div className="console-title"><span>NIGHT ACTION</span><small>{nightProgress?.submitted ?? 0}/{nightProgress?.required ?? 0} SUBMITTED</small></div>
      <p>{myRole === "WEREWOLF" ? "Pilih warga yang akan menjadi korban. Rekan serigala: " + (allies.map(a=>a.name).join(", ") || "tidak ada") + "." : myRole === "SEER" ? "Ketuk profil pemain untuk memeriksa identitasnya." : myRole === "DOCTOR" ? "Pilih satu pemain untuk dilindungi malam ini." : "Kamu tidak memiliki aksi malam. Tunggu desa bangun."}</p>
      {canActAtNight && <div className="selected-target"><span>TARGET</span><strong>{selectedTargetName || "TAP A PLAYER PROFILE"}</strong></div>}
      {canActAtNight && <button className="primary action-submit" onClick={nightAction} disabled={busy || !selectedTarget}>{myNightAction ? "UPDATE NIGHT ACTION" : "CONFIRM ACTION"}</button>}
      <div className="action-progress"><b>{myNightAction ? "✓ YOUR ACTION IS LOCKED IN" : canActAtNight ? "CHOOSE A PROFILE AROUND THE CIRCLE" : "WAITING FOR SPECIAL ROLES"}</b></div>
      {room.host_player_id === myId && <button className="secondary resolve-button" onClick={resolveNight} disabled={busy}>RESOLVE NIGHT · {nightProgress?.submitted ?? 0}/{nightProgress?.required ?? 0}</button>}
     </div>}
     {phase === "resolution" && <div className="phase-console-inner"><div className="console-title"><span>THE NIGHT UNFOLDS</span><small>SERVER RESOLUTION</small></div><p>Server sedang menghitung serangan, perlindungan, dan siapa yang masih bertahan.</p></div>}
     {phase === "day" && <div className="phase-console-inner">
      <div className="console-title"><span>DAYBREAK REPORT</span><small>DISCUSSION OPEN</small></div>
      <p>{lastNightSummary || "Matahari terbit. Desa mulai mencari tahu apa yang terjadi semalam."}</p>
      {seerResult && <div className="seer-result">🔮 HASIL RAHASIA: <b>{seerResult.player_name}</b> adalah <b>{roles[seerResult.role]?.name ?? seerResult.role}</b>. Hanya kamu yang melihat ini.</div>}
      <div className="console-actions">{room.host_player_id === myId && <button className="primary" onClick={startVoting} disabled={busy}>OPEN VOTING</button>}</div>
     </div>}
     {phase === "voting" && <div className="phase-console-inner">
      <div className="console-title"><span>VILLAGE VOTE</span><small>{voteProgress?.submitted ?? 0}/{voteProgress?.required ?? 0} VOTES</small></div>
      <p>Ketuk profil pemain yang kamu curigai. Pilihanmu bisa diubah sebelum hasil dibuka.</p>
      <div className="selected-target"><span>YOUR VOTE</span><strong>{selectedVoteName || "TAP A PLAYER PROFILE"}</strong></div>
      <button className="primary action-submit" onClick={vote} disabled={busy || !selectedVote || !me?.is_alive}>{myVote ? "CHANGE VOTE" : "CAST VOTE"}</button>
      {room.host_player_id === myId && <button className="secondary resolve-button" onClick={resolveVotes} disabled={busy}>REVEAL VOTES</button>}
     </div>}
     {phase === "hunter" && <div className="phase-console-inner">
      <div className="console-title"><span>HUNTER'S LAST SHOT</span><small>FINAL ABILITY</small></div>
      <p>{myRole === "HUNTER" && !me?.is_alive ? "Pilih satu pemain hidup untuk dibawa bersamamu." : "Hunter sedang menentukan target terakhirnya."}</p>
      {myRole === "HUNTER" && !me?.is_alive && <><div className="selected-target"><span>LAST TARGET</span><strong>{selectedTargetName || "TAP A PLAYER PROFILE"}</strong></div><button className="primary action-submit" onClick={hunterAction} disabled={!selectedTarget || busy}>FIRE</button></>}
      {room.host_player_id === myId && <button className="secondary resolve-button" onClick={resolveHunter} disabled={busy}>RESOLVE HUNTER</button>}
     </div>}
     {phase === "game_over" && <div className="phase-console-inner"><div className="console-title"><span>GAME OVER</span><small>THE VILLAGE IS QUIET</small></div><p>{lastNightSummary || "Permainan selesai."}</p></div>}
    </div>
    <div className="game-chat">
     {phase === "day" || phase === "voting" ? <>
      <span className="chat-status"><i></i> VILLAGE CHAT</span>
      <div className="chat-compose"><input value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ketik pesan untuk desa..." maxLength={500}/><button onClick={send} disabled={!message.trim()}>SEND</button></div>
     </> : <div className="chat-locked"><span>☾</span> {phase === "game_over" ? "GAME CHAT CLOSED" : "VILLAGE CHAT SLEEPS DURING THE NIGHT"}</div>}
    </div>
   </section>
   <footer className="scene-footer"><span>ROOM {room.code}</span><span>{me?.name ?? "PLAYER"} · {room.host_player_id === myId ? "HOST" : "PLAYER"}</span><button onClick={leave} disabled={busy}>LEAVE GAME</button></footer>
  </section>
  {showIntro && <div className="intro-overlay"><div className={"intro-card " + (myRole?.toLowerCase() ?? "")}>
   <div className="intro-stars"></div><div className="intro-orb"></div><div className="intro-mark">{role?.icon || "☾"}</div><div className="intro-line"></div>
   <div className="eyebrow">ROLE INTRODUCTION · ROUND {room.round}</div>
   <h2>{role?.name?.toUpperCase() || "YOUR ROLE"}</h2>
   <p>{myRole === "WEREWOLF" ? "Kamu bagian dari tim Werewolf. Berpura-puralah sebagai warga, koordinasikan korban, dan jangan sampai identitas timmu terbongkar." : myRole === "SEER" ? "Kamu adalah mata desa. Setiap malam kamu dapat memeriksa satu pemain dan mengetahui role aslinya." : myRole === "DOCTOR" ? "Kamu adalah pelindung desa. Setiap malam lindungi satu pemain dari serangan Werewolf." : myRole === "HUNTER" ? "Kamu adalah Hunter. Kalau kamu mati, kamu mendapat satu kesempatan terakhir untuk menembak pemain hidup." : "Kamu adalah Villager. Tidak punya aksi malam, jadi kekuatanmu ada di pengamatan, diskusi, dan voting."}</p>
   <div className="intro-rules">
    <div><b>ROLE</b><span>{role?.desc}</span></div>
    <div><b>YOUR GOAL</b><span>{myRole === "WEREWOLF" ? "Buat jumlah Werewolf setidaknya sama dengan warga yang tersisa." : "Temukan dan singkirkan semua Werewolf sebelum mereka menguasai desa."}</span></div>
    <div><b>YOUR ACTION</b><span>{myRole === "WEREWOLF" ? "Pilih korban bersama timmu." : myRole === "SEER" ? "Pilih satu pemain untuk diperiksa." : myRole === "DOCTOR" ? "Pilih satu pemain untuk dilindungi." : myRole === "HUNTER" ? "Jika mati, pilih satu target untuk ditembak." : "Tidak ada aksi malam. Gunakan diskusi dan voting."}</span></div>
   </div>
   {myRole === "WEREWOLF" && <div className="intro-role"><span>YOUR PACK</span><strong>{allies.length ? allies.map(a=>a.name).join(" · ") : "YOU STAND ALONE"}</strong><small>Jangan pernah membocorkan daftar ini ke desa.</small></div>}
   <div className="intro-role"><span>GAME FLOW</span><strong>🌙 NIGHT → ☀️ DAY → ⚖️ VOTE</strong><small>Malam untuk kemampuan rahasia. Siang untuk diskusi. Voting menentukan siapa yang tersingkir. Jika Hunter mati, dia mendapat fase khusus.</small></div>
   <button className="primary intro-button" onClick={()=>setShowIntro(false)}>UNDERSTAND · ENTER THE VILLAGE</button>
  </div></div>}
  {notice && <div className="toast">✓ {notice}</div>}{error && <div className="toast error-toast">{error}</div>}
 </main>;

}