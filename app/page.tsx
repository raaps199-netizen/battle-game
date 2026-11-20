"use client";

import { useState } from "react";

const players = [
  { name: "DAFFA", role: "KING", hp: 3, ammo: 4, color: "cyan", avatar: "👑" },
  { name: "BUDI", role: "UNKNOWN", hp: 3, ammo: 2, color: "violet", avatar: "?" },
  { name: "CACA", role: "UNKNOWN", hp: 3, ammo: 3, color: "pink", avatar: "?" }
];

const attacks = [
  { name: "SINGLE", cost: 1, icon: "•" },
  { name: "DOUBLE", cost: 2, icon: "••" },
  { name: "BURST", cost: 3, icon: "•••" },
  { name: "BAZOOKA", cost: 4, icon: "◉" }
];

export default function Home() {
  const [phase, setPhase] = useState<"ability" | "action">("ability");
  const [target, setTarget] = useState("BUDI");
  const [attack, setAttack] = useState("SINGLE");

  return (
    <main className="game-shell">
      <div className="scanlines" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◆</span><div><div className="brand-name">BATTLE<span>//</span>GAME</div><div className="brand-sub">TACTICAL LIVE COMBAT</div></div></div>
        <div className="round-box"><span>ROUND</span><strong>02</strong><small>/ 03</small></div>
        <div className="status"><span className="live-dot" /> ONLINE <span className="room-code">ROOM: K7X2</span></div>
      </header>

      <section className="hud-grid">
        <aside className="side-panel left-panel">
          <div className="panel-title">PLAYERS <span>3 / 6</span></div>
          {players.map((p, i) => (
            <div key={p.name} className={i === 0 ? "player-card active" : "player-card"}>
              <div className={"avatar " + p.color}>{p.avatar}</div>
              <div className="player-info"><strong>{p.name}</strong><span>{p.role}</span><div className="hp-row">{[0,1,2,3,4].map(x => <i key={x} className={x < p.hp ? "hp on" : "hp"} />)}</div></div>
              <div className="ammo">{p.ammo} <span>●</span></div>
            </div>
          ))}
        </aside>

        <section className="arena-panel">
          <div className="phase-banner">
            <span className="phase-index">PHASE 0{phase === "ability" ? "1" : "2"}</span>
            <div><strong>{phase === "ability" ? "ABILITY PHASE" : "ACTION PHASE"}</strong><span>{phase === "ability" ? "Use your ability before locking an action." : "Choose your target and attack."}</span></div>
            <div className="ready-count">1 / 3 READY</div>
          </div>

          <div className="arena">
            <div className="grid-floor" />
            <div className="crosshair c1" /><div className="crosshair c2" /><div className="crosshair c3" />
            <div className="player-node node-a"><div className="node-ring pulse" /><div className="node-core cyan">👑</div><span>YOU</span><small>3 HP · 4 AMMO</small></div>
            <div className="player-node node-b"><div className="node-ring" /><div className="node-core violet">?</div><span>BUDI</span><small>3 HP · 2 AMMO</small></div>
            <div className="player-node node-c"><div className="node-ring" /><div className="node-core pink">?</div><span>CACA</span><small>3 HP · 3 AMMO</small></div>
            <div className="target-line" />
          </div>

          <div className="event-log"><span className="log-time">SYSTEM</span>Waiting for all players to lock their action...</div>
        </section>

        <aside className="side-panel right-panel">
          <div className="panel-title">YOUR LOADOUT</div>
          <div className="role-card"><div className="role-icon">👑</div><div><span>ROLE</span><strong>KING</strong></div><div className="passive">PASSIVE</div></div>

          <div className="ability-card">
            <div className="card-top"><span>⚡ ABILITY</span><span className="available">READY</span></div>
            <strong>ROYAL RELOAD</strong><p>Reload gives +2 ammo instead of +1.</p>
            <button onClick={() => setPhase("action")} className="ability-btn">USE ABILITY</button>
          </div>

          <div className="action-card">
            <div className="card-top"><span>ACTION</span><span>AMMO 4 / 4</span></div>
            <label>TARGET</label>
            <div className="target-buttons">{["BUDI","CACA"].map(name => <button key={name} className={target === name ? "selected" : ""} onClick={() => setTarget(name)}>{name}</button>)}</div>
            <label>ATTACK</label>
            <div className="attack-grid">{attacks.map(a => <button key={a.name} className={attack === a.name ? "selected" : ""} onClick={() => setAttack(a.name)}><b>{a.icon}</b><span>{a.name}</span><small>{a.cost} BULLET</small></button>)}</div>
            <button className="ready-btn" onClick={() => setPhase("action")}><span>✓</span> LOCK ACTION</button>
          </div>
        </aside>
      </section>

      <footer className="bottom-bar"><div><span className="key">SPACE</span> CONFIRM</div><div><span className="key">ESC</span> MENU</div><div className="sync">● SERVER SYNC ACTIVE</div></footer>
    </main>
  );
}