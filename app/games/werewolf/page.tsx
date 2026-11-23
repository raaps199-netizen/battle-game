"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function WerewolfEntry() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function enter(action: "create" | "join") {
    if (!name.trim()) { setError("Isi nama pemain dulu."); return; }
    if (action === "join" && !roomCode.trim()) { setError("Masukkan kode room."); return; }
    setBusy(true); setError("");
    const { data, error: requestError } = await supabase.functions.invoke("werewolf-api", {
      body: { action, name: name.trim(), code: roomCode.trim().toUpperCase() },
    });
    if (requestError || !data) {
      let detail = requestError?.message ?? "Gagal masuk ke room.";
      try {
        const response = (requestError as unknown as { context?: Response })?.context;
        if (response) {
          const body = await response.clone().json();
          if (typeof body?.error === "string") detail = body.error;
        }
      } catch {}
      setError(detail); setBusy(false); return;
    }
    sessionStorage.setItem("werewolf_player_id", data.player_id);
    sessionStorage.setItem("werewolf_session", data.session_token);
    window.location.href = "/lobby/" + data.room.code;
  }

  return (
    <main className="werewolf-entry">
      <header className="hub-topbar"><Link href="/" className="hub-brand">GOHOFog<span>•</span></Link><Link href="/" className="entry-back">← ALL GAMES</Link></header>
      <section className="entry-wrap">
        <div className="entry-art">
          <div className="entry-art-moon">☾</div><div className="entry-art-ground" />
          <div className="entry-art-title"><span>GAME 01 · SOCIAL DEDUCTION</span><h1>WEREWOLF</h1><p>Somebody in the village is not who they say they are.</p></div>
        </div>
        <div className="entry-panel">
          <div className="hub-section-kicker">ENTER THE VILLAGE</div><h2>Ready to play?</h2>
          <label htmlFor="player-name">PLAYER NAME</label>
          <input id="player-name" value={name} onChange={event=>setName(event.target.value)} placeholder="Your name" maxLength={20}/>
          <button className="entry-create" onClick={()=>enter("create")} disabled={busy}>{busy?"CONNECTING...":"CREATE A ROOM"} <span>↗</span></button>
          <div className="entry-divider"><span>OR JOIN A ROOM</span></div>
          <label htmlFor="room-code">ROOM CODE</label>
          <div className="entry-join-row"><input id="room-code" value={roomCode} onChange={event=>setRoomCode(event.target.value.toUpperCase())} placeholder="ENTER CODE" maxLength={6}/><button onClick={()=>enter("join")} disabled={busy}>JOIN</button></div>
          {error&&<div className="error">{error}</div>}
          <Link href="/" className="entry-library-link">← BACK TO GAME LIBRARY</Link>
        </div>
      </section>
    </main>
  );
}
