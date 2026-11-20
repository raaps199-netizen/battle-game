"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Room = { id: string; code: string; status: string; round: number; host_player_id: string | null };
type Player = { id: string; room_id: string; name: string; hp: number; max_hp: number; ammo: number; role: string | null; item: string | null; inventory?: string[]; round_wins: number; is_alive: boolean; is_ready: boolean; ability_used: boolean; ability_cooldown: number; item_uses: number; clone_count?: number };

const attacks = [
  { name: "SINGLE", cost: 1, icon: "•" },
  { name: "DOUBLE", cost: 2, icon: "••" },
  { name: "BURST", cost: 3, icon: "•••" },
  { name: "BAZOOKA", cost: 4, icon: "◉" }
];

function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function Home() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [me, setMe] = useState<Player | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"ability" | "action" | "resolution" | "match_end">("ability");
  const [target, setTarget] = useState("");
  const [attack, setAttack] = useState("SINGLE");
  const [shield, setShield] = useState("NONE");
  const [abilityBusy, setAbilityBusy] = useState(false);
  const [abilityTarget, setAbilityTarget] = useState("");
  const [guessedRole, setGuessedRole] = useState("KING");
  const [useHollow, setUseHollow] = useState(false);
  const [useBoomerang, setUseBoomerang] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("battle_player_id");
    if (!saved) localStorage.setItem("battle_player_id", crypto.randomUUID());
  }, []);

  useEffect(() => {
    if (!room) return;
    const channel = supabase
      .channel("room-" + room.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${room.id}` }, () => loadPlayers(room.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room.id}` }, () => loadRoom(room.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "game_states", filter: `room_id=eq.${room.id}` }, () => loadGameState(room.id))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [room?.id]);

  async function loadRoom(id: string) {
    const { data } = await supabase.from("rooms").select("*").eq("id", id).single();
    if (data) setRoom(data);
  }

  async function loadGameState(roomId: string) {
    const { data } = await supabase.from("game_states").select("phase").eq("room_id", roomId).single();
    if (data?.phase === "ability" || data?.phase === "action" || data?.phase === "resolution" || data?.phase === "match_end") setPhase(data.phase);
  }

  async function loadPlayers(roomId: string) {
    const { data } = await supabase.from("players").select("*").eq("room_id", roomId).order("created_at");
    if (data) {
      setPlayers(data);
      const myId = localStorage.getItem("battle_player_id");
      setMe(data.find((p: Player) => p.id === myId) ?? null);
    }
  }

  async function copyRoomCode() {
    if (!room?.code) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setError("Room code copied.");
      setTimeout(() => setError(""), 1500);
    } catch {
      setError("Code: " + room.code);
    }
  }

  async function createRoom() {
    if (!name.trim()) return setError("Isi nama lu dulu jir.");
    setBusy(true); setError("");
    const code = makeCode();
    const playerId = crypto.randomUUID();
    localStorage.setItem("battle_player_id", playerId);
    const { data: newRoom, error: roomError } = await supabase.from("rooms").insert({ code }).select().single();
    if (roomError || !newRoom) { setError(roomError?.message ?? "Gagal bikin room."); setBusy(false); return; }
    const { error: playerError } = await supabase.from("players").insert({ id: playerId, room_id: newRoom.id, name: name.trim(), role: null });
    await supabase.from("rooms").update({ host_player_id: playerId }).eq("id", newRoom.id);
    if (playerError) { setError(playerError.message); setBusy(false); return; }
    await supabase.from("game_states").insert({ room_id: newRoom.id });
    setRoom(newRoom); await loadPlayers(newRoom.id); await loadGameState(newRoom.id); setBusy(false);
  }

  async function joinRoom() {
    if (!name.trim() || !roomCode.trim()) return setError("Nama sama room code-nya isi dulu.");
    setBusy(true); setError("");
    const { data: found, error: findError } = await supabase.from("rooms").select("*").eq("code", roomCode.trim().toUpperCase()).single();
    if (findError || !found) { setError("Room nggak ketemu."); setBusy(false); return; }
    if (found.status !== "lobby") { setError("Room itu udah mulai."); setBusy(false); return; }
    const playerId = crypto.randomUUID();
    localStorage.setItem("battle_player_id", playerId);
    const { error: playerError } = await supabase.from("players").insert({ id: playerId, room_id: found.id, name: name.trim() });
    if (playerError) { setError(playerError.message); setBusy(false); return; }
    setRoom(found); await loadPlayers(found.id); await loadGameState(found.id); setBusy(false);
  }

  async function useAbility(skip = false) {
    if (!room || !me || me.ability_used || me.ability_cooldown > 0 || abilityBusy) return;
    if (!skip && (me.role === "DETECTIVE" || me.role === "NINJA") && !abilityTarget) {
      setError("Pilih target ability dulu.");
      return;
    }

    setAbilityBusy(true);
    setError("");

    const { error } = await supabase.functions.invoke("use-ability", {
      body: {
        room_id: room.id,
        player_id: me.id,
        target_player_id: abilityTarget || null,
        guessed_role: me.role === "DETECTIVE" ? guessedRole : null,
        skip
      }
    });

    if (error) setError(error.message);
    else await loadGameState(room.id);

    setAbilityBusy(false);
  }

  async function startGame() {
    if (!room || !me || players.length < 3 || players.length > 6 || me.id !== room.host_player_id) return;
    const { error } = await supabase.functions.invoke("start-match", {
      body: { room_id: room.id, player_id: me.id }
    });
    if (error) { setError(error.message); return; }
    await loadRoom(room.id);
    await loadPlayers(room.id);
    await loadGameState(room.id);
  }

  async function lockAction() {
    if (!room || !me || !target || phase !== "action") return;
    const chosen = attacks.find(a => a.name === attack)!;
    if (useHollow && !(me.inventory ?? []).includes("HOLLOW_BULLET")) return setError("Lu nggak punya Hollow Bullet.");
    if (useBoomerang && !(me.inventory ?? []).includes("BOOMERANG")) return setError("Lu nggak punya Boomerang.");
    setError("");
    const { error: actionError } = await supabase.from("actions").upsert({
      room_id: room.id,
      player_id: me.id,
      target_player_id: target,
      action_type: attack,
      action_data: { ammo_cost: chosen.cost, shield, hollow_bullet: useHollow, use_boomerang: useBoomerang },
      locked: true,
      round: room.round
    }, { onConflict: "room_id,player_id,round" });
    if (actionError) {
      setError(actionError.message);
      return;
    }

    const { error: readyError } = await supabase.from("players").update({ is_ready: true }).eq("id", me.id);
    if (readyError) {
      setError(readyError.message);
      return;
    }
    
    const { error: resolveError } = await supabase.functions.invoke("resolve-round", {
      body: { room_id: room.id }
    });
    if (resolveError) setError(resolveError.message);
  }

  if (!room) return (
    <main className="lobby-shell">
      <div className="scanlines" />
      <div className="lobby-card">
        <div className="brand"><span className="brand-mark">◆</span><div><div className="brand-name">BATTLE<span>//</span>GAME</div><div className="brand-sub">TACTICAL LIVE COMBAT</div></div></div>
        <div className="lobby-title">{room ? "ROOM LOBBY" : "ENTER THE ROOM"}</div>
        <p className="lobby-copy">Real-time tactical combat. Pilih room, masuk, lalu tembak-tembakan secara simultan. Karena ternyata manusia masih butuh website buat saling nembak.</p>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="PLAYER NAME" maxLength={20} />
        <div className="join-row"><input value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={8} /><button onClick={joinRoom} disabled={busy}>JOIN</button></div>
        <button className="create-btn" onClick={createRoom} disabled={busy}>{busy ? "CONNECTING..." : "CREATE ROOM"}</button>
        {error && <div className="error-box">{error}</div>}
        <div className="lobby-note">3–6 PLAYERS · FIRST TO 3 ROUNDS</div>
      </div>
    </main>
  );

  const alive = players.filter(p => p.is_alive);
  const matchWinner = players.find(p => p.round_wins >= 3);
  return (
    <main className="game-shell">
      <div className="scanlines" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◆</span><div><div className="brand-name">BATTLE<span>//</span>GAME</div><div className="brand-sub">TACTICAL LIVE COMBAT</div></div></div>
        <div className="round-box"><span>ROUND</span><strong>{String(room.round).padStart(2, "0")}</strong><small>/ MATCH</small></div>
        <div className="status"><span className="live-dot" /> ONLINE <button className="room-code" onClick={copyRoomCode}>ROOM: {room.code} ⧉</button></div>
      </header>

      <section className="hud-grid">
        <aside className="side-panel left-panel">
          <div className="panel-title">PLAYERS <span>{players.length} / 6</span></div>
          {players.map(p => (
            <div key={p.id} className={p.id === me?.id ? "player-card active" : "player-card"}>
              <div className={"avatar " + (p.id === me?.id ? "cyan" : "violet")}>{p.id === me?.id ? "👑" : "?"}</div>
              <div className="player-info"><strong>{p.name.toUpperCase()}</strong><span>{p.id === me?.id ? (p.role ?? "UNKNOWN") : "ROLE HIDDEN"} · {p.round_wins} WIN</span><div className="hp-row">{Array.from({length: Math.max(3,p.max_hp)}, (_,i) => <i key={i} className={i < p.hp ? "hp on" : "hp"} />)}</div></div>
              <div className="ammo">{p.ammo} <span>●</span></div>
            </div>
          ))}
        </aside>

        <section className="arena-panel">
          <div className="phase-banner">
            <span className="phase-index">{phase === "ability" ? "PHASE 01" : phase === "action" ? "PHASE 02" : "PHASE 03"}</span>
            <div><strong>{phase === "ability" ? "ABILITY PHASE" : phase === "action" ? "ACTION PHASE" : phase === "resolution" ? "RESOLVING" : "MATCH END"}</strong><span>{phase === "ability" ? "Use your ability or skip, then wait for everyone." : phase === "action" ? "Choose target, attack and shield, then lock." : phase === "resolution" ? "Server is resolving every action simultaneously." : "The match has a winner."}</span></div>
            <div className="ready-count">{players.filter(p => p.is_ready).length} / {alive.length} READY</div>
          </div>
          <div className="arena">
            <div className="grid-floor" />
            <div className="crosshair c1" /><div className="crosshair c2" /><div className="crosshair c3" />
            {players.slice(0,3).map((p,i) => <div key={p.id} className={`player-node node-${["a","b","c"][i]}`}><div className={`node-ring ${p.id===me?.id?"pulse":""}`} /><div className={`node-core ${i===0?"cyan":i===1?"violet":"pink"}`}>{p.id===me?.id?"👑":"?"}</div><span>{p.id===me?.id?"YOU":p.name.toUpperCase()}</span><small>{p.hp} HP · {p.ammo} AMMO</small></div>)}
          </div>
          <div className="event-log"><span className="log-time">ROOM</span>{room.status === "lobby" ? `Share code ${room.code} with 2–5 players.` : phase === "match_end" ? `${matchWinner?.name ?? "Winner"} wins the match.` : phase === "resolution" ? "Resolving simultaneous actions..." : "Server sync active. Actions resolve together."}</div>
        </section>

        <aside className="side-panel right-panel">
          <div className="panel-title">YOUR LOADOUT</div>
          <div className="role-card"><div className="role-icon">◆</div><div><span>ROLE</span><strong>{me?.role ?? "UNKNOWN"}</strong></div><div className="passive">ITEMS: {(me?.inventory ?? [me?.item ?? "NONE"]).join(" · ")}</div></div>
          {room.status === "lobby" ? (
            <div className="ability-card">
              <div className="card-top"><span>ROOM CODE</span><span>{players.length} / 6 PLAYERS</span></div>
              <div className="room-code-big">{room.code}</div>
              <button className="copy-btn" onClick={copyRoomCode}>COPY ROOM CODE</button>
              <strong>READY TO DEPLOY</strong>
              <p>{players.length < 3 ? "Need at least 3 players." : "Share the code, then the host starts the match."}</p>
              <button className="ability-btn" onClick={startGame} disabled={players.length < 3 || players.length > 6 || me?.id !== room.host_player_id}>START MATCH</button>
            </div>
          ) : (
            <>
              <div className="ability-card">
                <div className="card-top"><span>⚡ ABILITY</span><span className="available">{me?.ability_cooldown ? `CD ${me.ability_cooldown}` : me?.ability_used ? "USED" : "READY"}</span></div>
                <strong>{me?.role ?? "UNKNOWN"}</strong>
                <p>{
                  me?.role === "KING" ? "Gain +2 ammo now, up to the ammo cap." :
                  me?.role === "DETECTIVE" ? "Guess one player's role. A correct guess eliminates them this round." :
                  me?.role === "GLITCH" ? "Become untargetable for this round." :
                  me?.role === "WUKONG" ? "Double your clone count. Clones increase your resource strength." :
                  me?.role === "NINJA" ? "Change your target before the round resolves." :
                  me?.role === "HUNTER" ? "Passive ability. Successful hits restore 1 HP." :
                  "No active ability."
                }</p>
                {(me?.role === "DETECTIVE" || me?.role === "NINJA") && (
                  <div className="target-buttons">
                    {players.filter(p => p.id !== me?.id && p.is_alive).map(p => (
                      <button key={p.id} className={abilityTarget === p.id ? "selected" : ""} onClick={() => setAbilityTarget(p.id)}>
                        {p.name.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
                {me?.role === "DETECTIVE" && (
                  <select value={guessedRole} onChange={e => setGuessedRole(e.target.value)} className="role-select">
                    {["KING","DETECTIVE","GLITCH","WUKONG","HUNTER","NINJA"].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
                <div className="ability-actions">
                  <button onClick={() => useAbility(false)} className="ability-btn" disabled={me?.is_ready || me?.ability_used || (me?.ability_cooldown ?? 0) > 0 || abilityBusy || me?.role === "HUNTER"}>
                    {me?.ability_used ? "ABILITY USED" : me?.ability_cooldown ? `COOLDOWN ${me.ability_cooldown}` : me?.role === "HUNTER" ? "PASSIVE" : "USE ABILITY"}
                  </button>
                  {!me?.ability_used && !me?.is_ready && (
                    <button onClick={() => useAbility(true)} className="skip-btn" disabled={abilityBusy}>SKIP</button>
                  )}
                </div>
              </div>
              <div className="action-card"><div className="card-top"><span>ACTION</span><span>AMMO {me?.ammo ?? 0} / 4</span></div>
              {phase !== "action" && <div className="phase-lock">{phase === "resolution" ? "RESOLVING..." : "WAITING FOR NEXT PHASE"}</div>}<label>TARGET</label><div className="target-buttons">{players.filter(p => p.id !== me?.id && p.is_alive).map(p => <button key={p.id} className={target === p.id ? "selected" : ""} onClick={() => setTarget(p.id)}>{p.name.toUpperCase()}</button>)}</div><label>SHIELD</label><div className="target-buttons shield-buttons">{["NONE", "SINGLE", "DOUBLE", "BURST", "BAZOOKA"].map(s => <button key={s} className={shield === s ? "selected" : ""} onClick={() => setShield(s)}>{s === "NONE" ? "NO SHIELD" : s + " SHIELD"}</button>)}</div><label>ATTACK</label><div className="attack-grid">{attacks.map(a => <button key={a.name} className={attack === a.name ? "selected" : ""} onClick={() => setAttack(a.name)} disabled={(me?.ammo ?? 0) < a.cost}><b>{a.icon}</b><span>{a.name}</span><small>{a.cost} BULLET</small></button>)}</div><div className="item-actions">
                <button className={useHollow ? "selected" : ""} onClick={() => setUseHollow(!useHollow)} disabled={!(me?.inventory ?? []).includes("HOLLOW_BULLET") || phase !== "action"}>HOLOW BULLET</button>
                <button className={useBoomerang ? "selected" : ""} onClick={() => setUseBoomerang(!useBoomerang)} disabled={!(me?.inventory ?? []).includes("BOOMERANG") || phase !== "action"}>BOOMERANG</button>
              </div>
              <button className="ready-btn" onClick={lockAction} disabled={!target || me?.is_ready || phase !== "action"}><span>✓</span> {me?.is_ready ? "ACTION LOCKED" : phase !== "action" ? "WAITING..." : "LOCK ACTION"}</button></div>
            </>
          )}
        </aside>
      </section>
      <footer className="bottom-bar"><div><span className="key">ROOM</span> {room.code}</div><div><span className="key">PLAYERS</span> {players.length}/6</div><div className="sync">● REALTIME CONNECTED</div></footer>
    </main>
  );
}
