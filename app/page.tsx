"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Room = { id: string; code: string; status: string; round: number; host_player_id: string | null };
type Player = { id: string; room_id: string; name: string; hp: number; max_hp: number; ammo: number; role: string | null; item: string | null; round_wins: number; is_alive: boolean; is_ready: boolean; ability_used: boolean; ability_cooldown: number; item_uses: number };

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
  const [phase, setPhase] = useState<"ability" | "action">("ability");
  const [target, setTarget] = useState("");
  const [attack, setAttack] = useState("SINGLE");
  const [shield, setShield] = useState("NONE");
  const [abilityBusy, setAbilityBusy] = useState(false);

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
    if (data?.phase === "ability" || data?.phase === "action") setPhase(data.phase);
  }

  async function loadPlayers(roomId: string) {
    const { data } = await supabase.from("players").select("*").eq("room_id", roomId).order("created_at");
    if (data) {
      setPlayers(data);
      const myId = localStorage.getItem("battle_player_id");
      setMe(data.find((p: Player) => p.id === myId) ?? null);
    }
  }

  async function createRoom() {
    if (!name.trim()) return setError("Isi nama lu dulu jir.");
    setBusy(true); setError("");
    const code = makeCode();
    const playerId = localStorage.getItem("battle_player_id")!;
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
    const playerId = localStorage.getItem("battle_player_id")!;
    const { error: playerError } = await supabase.from("players").insert({ id: playerId, room_id: found.id, name: name.trim() });
    if (playerError) { setError(playerError.message); setBusy(false); return; }
    setRoom(found); await loadPlayers(found.id); await loadGameState(found.id); setBusy(false);
  }

  async function useAbility() {
    if (!room || !me || me.ability_used || me.ability_cooldown > 0 || abilityBusy) return;
    setAbilityBusy(true);
    const patch = me.role === "KING" ? { ammo: Math.min(4, me.ammo + 2), ability_used: true } : { ability_used: true };
    const { error } = await supabase.from("players").update(patch).eq("id", me.id);
    if (error) setError(error.message);
    await supabase.from("game_states").update({ phase: "action" }).eq("room_id", room.id);
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
    if (!room || !me || !target) return;
    const chosen = attacks.find(a => a.name === attack)!;
    await supabase.from("actions").upsert({
      room_id: room.id,
      player_id: me.id,
      target_player_id: target,
      action_type: attack,
      action_data: { ammo_cost: chosen.cost, shield },
      locked: true,
      round: room.round
    }, { onConflict: "room_id,player_id,round" });
    await supabase.from("players").update({ is_ready: true }).eq("id", me.id);
    
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
        <div className="lobby-title">ENTER THE ROOM</div>
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
  return (
    <main className="game-shell">
      <div className="scanlines" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◆</span><div><div className="brand-name">BATTLE<span>//</span>GAME</div><div className="brand-sub">TACTICAL LIVE COMBAT</div></div></div>
        <div className="round-box"><span>ROUND</span><strong>{String(room.round).padStart(2, "0")}</strong><small>/ MATCH</small></div>
        <div className="status"><span className="live-dot" /> ONLINE <span className="room-code">ROOM: {room.code}</span></div>
      </header>

      <section className="hud-grid">
        <aside className="side-panel left-panel">
          <div className="panel-title">PLAYERS <span>{players.length} / 6</span></div>
          {players.map(p => (
            <div key={p.id} className={p.id === me?.id ? "player-card active" : "player-card"}>
              <div className={"avatar " + (p.id === me?.id ? "cyan" : "violet")}>{p.id === me?.id ? "👑" : "?"}</div>
              <div className="player-info"><strong>{p.name.toUpperCase()}</strong><span>{p.role ?? "UNKNOWN"} · {p.round_wins} WIN</span><div className="hp-row">{Array.from({length: Math.max(3,p.max_hp)}, (_,i) => <i key={i} className={i < p.hp ? "hp on" : "hp"} />)}</div></div>
              <div className="ammo">{p.ammo} <span>●</span></div>
            </div>
          ))}
        </aside>

        <section className="arena-panel">
          <div className="phase-banner">
            <span className="phase-index">PHASE 0{phase === "ability" ? "1" : "2"}</span>
            <div><strong>{phase === "ability" ? "ABILITY PHASE" : "ACTION PHASE"}</strong><span>{phase === "ability" ? "Use your ability before locking an action." : "Choose your target and attack."}</span></div>
            <div className="ready-count">{players.filter(p => p.is_ready).length} / {alive.length} READY</div>
          </div>
          <div className="arena">
            <div className="grid-floor" />
            <div className="crosshair c1" /><div className="crosshair c2" /><div className="crosshair c3" />
            {players.slice(0,3).map((p,i) => <div key={p.id} className={`player-node node-${["a","b","c"][i]}`}><div className={`node-ring ${p.id===me?.id?"pulse":""}`} /><div className={`node-core ${i===0?"cyan":i===1?"violet":"pink"}`}>{p.id===me?.id?"👑":"?"}</div><span>{p.id===me?.id?"YOU":p.name.toUpperCase()}</span><small>{p.hp} HP · {p.ammo} AMMO</small></div>)}
          </div>
          <div className="event-log"><span className="log-time">ROOM</span>{room.status === "lobby" ? "Waiting for host to start..." : "Server sync active. Actions resolve together."}</div>
        </section>

        <aside className="side-panel right-panel">
          <div className="panel-title">YOUR LOADOUT</div>
          <div className="role-card"><div className="role-icon">◆</div><div><span>ROLE</span><strong>{me?.role ?? "UNKNOWN"}</strong></div><div className="passive">ITEM: {me?.item ?? "NONE"}</div></div>
          {room.status === "lobby" ? (
            <div className="ability-card"><div className="card-top"><span>ROOM</span><span>{players.length} / 6</span></div><strong>READY TO DEPLOY</strong><p>Host can start once 3–6 players are inside.</p><button className="ability-btn" onClick={startGame} disabled={players.length < 3 || me?.id !== room.host_player_id}>START MATCH</button></div>
          ) : (
            <>
              <div className="ability-card"><div className="card-top"><span>⚡ ABILITY</span><span className="available">READY</span></div><strong>ROYAL RELOAD</strong><p>Reload gives +2 ammo instead of +1.</p><button onClick={useAbility} className="ability-btn" disabled={me?.is_ready || me?.ability_used || (me?.ability_cooldown ?? 0) > 0 || abilityBusy}>{me?.ability_used ? "ABILITY USED" : me?.ability_cooldown ? `COOLDOWN ${me.ability_cooldown}` : "USE ABILITY"}</button></div>
              <div className="action-card"><div className="card-top"><span>ACTION</span><span>AMMO {me?.ammo ?? 0} / 4</span></div><label>TARGET</label><div className="target-buttons">{players.filter(p => p.id !== me?.id && p.is_alive).map(p => <button key={p.id} className={target === p.id ? "selected" : ""} onClick={() => setTarget(p.id)}>{p.name.toUpperCase()}</button>)}</div><label>SHIELD</label><div className="target-buttons shield-buttons">{["NONE", "SINGLE", "DOUBLE", "BURST", "BAZOOKA"].map(s => <button key={s} className={shield === s ? "selected" : ""} onClick={() => setShield(s)}>{s === "NONE" ? "NO SHIELD" : s + " SHIELD"}</button>)}</div><label>ATTACK</label><div className="attack-grid">{attacks.map(a => <button key={a.name} className={attack === a.name ? "selected" : ""} onClick={() => setAttack(a.name)} disabled={(me?.ammo ?? 0) < a.cost}><b>{a.icon}</b><span>{a.name}</span><small>{a.cost} BULLET</small></button>)}</div><button className="ready-btn" onClick={lockAction} disabled={!target || me?.is_ready}><span>✓</span> {me?.is_ready ? "ACTION LOCKED" : "LOCK ACTION"}</button></div>
            </>
          )}
        </aside>
      </section>
      <footer className="bottom-bar"><div><span className="key">ROOM</span> {room.code}</div><div><span className="key">PLAYERS</span> {players.length}/6</div><div className="sync">● REALTIME CONNECTED</div></footer>
    </main>
  );
}
