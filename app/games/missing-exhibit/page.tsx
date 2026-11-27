"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { supabase } from "@/lib/supabase";

type RoomKey = "main" | "security" | "archive";
type Position = { x: number; y: number };
type ExhibitPlayer = {
  id: string; name: string; room_key: RoomKey; x: number; y: number;
  inventory: string[]; evidence: string[]; last_seen?: string;
};
type GameSnapshot = {
  room: {
    id: string; code: string; status: "waiting" | "active" | "completed" | "expired";
    host_player_id: string; state: { security_solved: boolean; archive_unlocked: boolean; clue_found: boolean; inventory_found: boolean; opening_found: boolean };
    expires_at: string;
  };
  players: ExhibitPlayer[];
  self_id: string;
};
type Session = { player_id: string; session_token: string; code: string };
type ApiData = {
  error?: string; message?: string; player_id?: string; session_token?: string;
  room?: { code: string }; room_key?: RoomKey; x?: number; y?: number;
  [key: string]: unknown;
};

async function callApi(body: Record<string, unknown>): Promise<ApiData> {
  const { data, error } = await supabase.functions.invoke("missing-exhibit-api", { body });
  if (error || !data) {
    let message = error?.message ?? "Gagal menghubungi server.";
    try {
      const response = (error as unknown as { context?: Response })?.context;
      if (response) {
        const detail = await response.clone().json();
        if (typeof detail?.error === "string") message = detail.error;
      }
    } catch {}
    throw new Error(message);
  }
  if (typeof data.error === "string") throw new Error(data.error);
  return data as ApiData;
}

const roomNames: Record<RoomKey, string> = {
  main: "MAIN HALL",
  security: "SECURITY ROOM",
  archive: "ARCHIVE ROOM",
};

const objectPoints: Record<RoomKey, Record<string, Position>> = {
  main: { display_label: { x: 31, y: 43 }, opening_hours: { x: 69, y: 43 }, door_security: { x: 91, y: 52 } },
  security: { security_panel: { x: 50, y: 44 }, door_main: { x: 9, y: 52 }, door_archive: { x: 91, y: 52 } },
  archive: { archive_clue: { x: 50, y: 45 }, door_security: { x: 9, y: 52 } },
};

export default function MissingExhibitPage() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const playerId = sessionStorage.getItem("exhibit_player_id");
    const sessionToken = sessionStorage.getItem("exhibit_session");
    const savedCode = sessionStorage.getItem("exhibit_code");
    if (playerId && sessionToken && savedCode) {
      setSession({ player_id: playerId, session_token: sessionToken, code: savedCode });
    }
  }, []);

  async function enter(action: "create" | "join") {
    setError("");
    if (!name.trim()) { setError("Masukkan nama pemain dulu."); return; }
    if (action === "join" && code.trim().length !== 6) { setError("Kode room harus 6 karakter."); return; }
    setBusy(true);
    try {
      const data = await callApi({ action, name: name.trim(), code: code.trim().toUpperCase() });
      if (!data.player_id || !data.session_token || !data.room?.code) throw new Error("Data room tidak lengkap.");
      const next = { player_id: data.player_id, session_token: data.session_token, code: data.room.code };
      sessionStorage.setItem("exhibit_player_id", next.player_id);
      sessionStorage.setItem("exhibit_session", next.session_token);
      sessionStorage.setItem("exhibit_code", next.code);
      setSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal masuk ke room.");
    } finally {
      setBusy(false);
    }
  }

  if (session) return <ExhibitGame session={session} onExit={() => {
    sessionStorage.removeItem("exhibit_player_id");
    sessionStorage.removeItem("exhibit_session");
    sessionStorage.removeItem("exhibit_code");
    setSession(null);
  }} />;

  return (
    <main className="exhibit-entry">
      <header className="exhibit-entry-top">
        <Link href="/" className="exhibit-logo">GOHOFog<span>•</span></Link>
        <Link href="/" className="exhibit-back">← ALL GAMES</Link>
      </header>
      <section className="exhibit-entry-grid">
        <div className="exhibit-entry-art">
          <span className="exhibit-kicker">CO-OP MYSTERY · 3 ROOMS</span>
          <div className="exhibit-entry-orb">◈</div>
          <div className="exhibit-entry-copy">
            <p>THE MUSEUM ISN'T EMPTY.</p>
            <h1>THE MISSING<br /><em>EXHIBIT</em></h1>
            <span>Find the clues. Unlock the Archive. Solve the case.</span>
          </div>
          <div className="exhibit-art-foot"><span>CASE FILE 001</span><span>KLAPANUNGGAL MUSEUM · 22:10</span></div>
        </div>
        <div className="exhibit-entry-panel">
          <div className="exhibit-kicker">JOIN ROOM</div>
          <h2>Enter the museum</h2>
          <p className="exhibit-subcopy">Create a room or join with a code.</p>
          <label htmlFor="exhibit-name">YOUR NAME</label>
          <input id="exhibit-name" value={name} onChange={e => setName(e.target.value)} maxLength={20} placeholder="Detective name" />
          <button className="exhibit-primary" onClick={() => enter("create")} disabled={busy}>
            {busy ? "CONNECTING..." : "CREATE NEW ROOM"} <span>↗</span>
          </button>
          <div className="exhibit-or"><span>OR JOIN AN EXISTING ROOM</span></div>
          <label htmlFor="exhibit-code">ROOM CODE</label>
          <div className="exhibit-join">
            <input id="exhibit-code" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} maxLength={6} placeholder="ABC123" />
            <button onClick={() => enter("join")} disabled={busy}>JOIN</button>
          </div>
          {error && <div className="exhibit-error">{error}</div>}
          <div className="exhibit-entry-meta"><span>2–8 PLAYERS</span><span>10 MINUTES</span></div>
        </div>
      </section>
    </main>
  );
}

function ExhibitGame({ session, onExit }: { session: Session; onExit: () => void }) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [roomKey, setRoomKey] = useState<RoomKey>("main");
  const [myPos, setMyPos] = useState<Position>({ x: 50, y: 74 });
  const [status, setStatus] = useState("Masuk ke museum...");
  const [panelOpen, setPanelOpen] = useState(false);
  const [inspectPopup, setInspectPopup] = useState<{ title: string; body: string } | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(600);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const positionRef = useRef<Position>({ x: 50, y: 74 });
  const roomRef = useRef<RoomKey>("main");
  const keysRef = useRef<Set<string>>(new Set());
  const stickRef = useRef<Position>({ x: 0, y: 0 });
  const goalRef = useRef<Position | null>(null);

  const loadSnapshot = useCallback(async () => {
    try {
      const data = await callApi({ action: "snapshot", player_id: session.player_id, session_token: session.session_token });
      if (data.room && Array.isArray(data.players)) {
        const next = data as unknown as GameSnapshot;
        setSnapshot(next);
        const self = next.players.find(p => p.id === session.player_id);
        if (self) {
          roomRef.current = self.room_key;
          positionRef.current = { x: self.x, y: self.y };
          setRoomKey(self.room_key);
          setMyPos({ x: self.x, y: self.y });
        }
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Koneksi terputus.");
    }
  }, [session]);

  const broadcastState = useCallback(() => {
    void channelRef.current?.send({ type: "broadcast", event: "state", payload: { changed: Date.now() } });
  }, []);

  useEffect(() => {
    const channel = supabase.channel("missing-exhibit-" + session.code, {
      config: { broadcast: { self: false } },
    });
    channel
      .on("broadcast", { event: "position" }, ({ payload }) => {
        setSnapshot(prev => {
          if (!prev || !payload?.id) return prev;
          return { ...prev, players: prev.players.map(p => p.id === payload.id
            ? { ...p, x: Number(payload.x), y: Number(payload.y), room_key: payload.room_key as RoomKey }
            : p) };
        });
      })
      .on("broadcast", { event: "state" }, () => { void loadSnapshot(); })
      .subscribe((state) => {
        if (state === "SUBSCRIBED") void loadSnapshot();
      });
    channelRef.current = channel;
    const refresh = window.setInterval(() => { void loadSnapshot(); }, 2500);
    return () => {
      window.clearInterval(refresh);
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [session.code, loadSnapshot]);

  useEffect(() => {
    if (snapshot?.room.status !== "active" || !snapshot.room.expires_at) return;
    const update = () => setSeconds(Math.max(0, Math.ceil((new Date(snapshot.room.expires_at).getTime() - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [snapshot?.room.expires_at, snapshot?.room.status]);

  useEffect(() => {
    if (snapshot?.room.status !== "active") return;
    let frame = 0;
    let previous = 0;
    let lastUi = 0;
    let lastBroadcast = 0;
    let lastPersist = 0;

    const keyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        event.preventDefault();
        keysRef.current.add(key);
      }
    };
    const keyUp = (event: KeyboardEvent) => keysRef.current.delete(event.key.toLowerCase());
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    const tick = (now: number) => {
      if (!previous) previous = now;
      const dt = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      let vx = 0, vy = 0;
      const keys = keysRef.current;
      if (keys.has("a") || keys.has("arrowleft")) vx -= 1;
      if (keys.has("d") || keys.has("arrowright")) vx += 1;
      if (keys.has("w") || keys.has("arrowup")) vy -= 1;
      if (keys.has("s") || keys.has("arrowdown")) vy += 1;
      if (vx === 0 && vy === 0) {
        vx = stickRef.current.x;
        vy = stickRef.current.y;
      }
      if (vx === 0 && vy === 0 && goalRef.current) {
        const dx = goalRef.current.x - positionRef.current.x;
        const dy = goalRef.current.y - positionRef.current.y;
        if (Math.hypot(dx, dy) < 8) goalRef.current = null;
        else { vx = dx; vy = dy; }
      }
      const magnitude = Math.hypot(vx, vy);
      if (magnitude > 0.05) {
        const speed = keys.has("shift") ? 30 : 21;
        positionRef.current = {
          x: Math.max(5, Math.min(95, positionRef.current.x + (vx / magnitude) * speed * dt)),
          y: Math.max(8, Math.min(92, positionRef.current.y + (vy / magnitude) * speed * dt)),
        };
        if (now - lastUi > 45) {
          setMyPos({ ...positionRef.current });
          lastUi = now;
        }
        if (now - lastBroadcast > 120) {
          void channelRef.current?.send({
            type: "broadcast", event: "position",
            payload: { id: session.player_id, x: positionRef.current.x, y: positionRef.current.y, room_key: roomRef.current },
          });
          lastBroadcast = now;
        }
        if (now - lastPersist > 900) {
          void callApi({
            action: "move", player_id: session.player_id, session_token: session.session_token,
            room_key: roomRef.current, x: Number(positionRef.current.x.toFixed(1)), y: Number(positionRef.current.y.toFixed(1)),
          }).catch(err => setStatus(err instanceof Error ? err.message : "Posisi gagal disimpan."));
          lastPersist = now;
        }
      } else if (now - lastUi > 180) {
        setMyPos({ ...positionRef.current });
        lastUi = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [session, snapshot?.room.status]);

  const playerList = snapshot?.players ?? [];
  const self = playerList.find(p => p.id === session.player_id);
  const evidence = [...new Set(playerList.flatMap(player => player.evidence ?? []))];
  const inventory = self?.inventory ?? [];
  const isHost = snapshot?.room.host_player_id === session.player_id;
  const closeTo = (point: Position) => Math.hypot(myPos.x - point.x, myPos.y - point.y) <= 20;

  async function doAction(target: string) {
    const point = objectPoints[roomKey][target];
    if (point && !closeTo(point)) {
      goalRef.current = point;
      setStatus("Bergerak mendekati objek. Tekan tombol interaksi lagi saat sudah dekat.");
      return;
    }
    if (target === "security_panel") {
      setPanelOpen(true);
      return;
    }
    if (target.startsWith("door_")) {
      const nextRoom: RoomKey = target === "door_security" ? "security" :
        target === "door_archive" ? "archive" : "main";
      setBusy(true);
      try {
        const data = await callApi({
          action: "door", target: nextRoom,
          player_id: session.player_id, session_token: session.session_token,
        });
        roomRef.current = data.room_key ?? nextRoom;
        positionRef.current = { x: Number(data.x ?? 50), y: Number(data.y ?? 52) };
        setRoomKey(roomRef.current);
        setMyPos({ ...positionRef.current });
        goalRef.current = null;
        setStatus("Masuk ke " + roomNames[roomRef.current] + ".");
        await loadSnapshot();
        broadcastState();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Pintu tidak bisa dibuka.");
      } finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      const data = await callApi({
        action: "interact", target,
        player_id: session.player_id, session_token: session.session_token,
      });
      const titles: Record<string, string> = {
        display_label: "Exhibit label",
        opening_hours: "Museum information",
        archive_clue: "Delivery record",
      };
      setInspectPopup({ title: titles[target] ?? "Evidence found", body: data.message ?? "Clue collected." });
      setStatus("Evidence updated.");
      await loadSnapshot();
      broadcastState();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Interaksi gagal.");
    } finally { setBusy(false); }
  }

  async function solvePanel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await callApi({
        action: "interact", target: "security_panel", answer,
        player_id: session.player_id, session_token: session.session_token,
      });
      setStatus("Archive unlocked.");
      setPanelOpen(false);
      setAnswer("");
      setInspectPopup({ title: "Access granted", body: data.message ?? "Keycard acquired." });
      await loadSnapshot();
      broadcastState();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Kode tidak cocok.");
    } finally { setBusy(false); }
  }


  async function startGame() {
    setBusy(true);
    setStatus("");
    try {
      await callApi({ action: "start", player_id: session.player_id, session_token: session.session_token });
      await loadSnapshot();
      broadcastState();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not start.");
    } finally {
      setBusy(false);
    }
  }

  async function leaveGame() {
    try {
      await callApi({ action: "leave", player_id: session.player_id, session_token: session.session_token });
    } catch {}
    onExit();
  }

  function joystick(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width * 0.35);
    const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height * 0.35);
    const length = Math.hypot(dx, dy) || 1;
    stickRef.current = { x: Math.max(-1, Math.min(1, dx / Math.max(1, length))), y: Math.max(-1, Math.min(1, dy / Math.max(1, length))) };
  }

  const expired = snapshot?.room.status === "expired" || (snapshot?.room.status === "active" && seconds === 0);
  const completed = snapshot?.room.status === "completed" || snapshot?.room.state.clue_found;

  if (!snapshot) {
    return <main className="exhibit-loading"><div className="exhibit-loading-mark">◈</div><p>Connecting to room...</p></main>;
  }

  if (snapshot.room.status === "waiting") {
    return (
      <main className="exhibit-lobby">
        <header className="exhibit-entry-top">
          <Link href="/" className="exhibit-logo">GOHOFog<span>•</span></Link>
          <span className="exhibit-lobby-title">THE MISSING EXHIBIT</span>
          <button className="exhibit-back" onClick={() => void leaveGame()}>LEAVE</button>
        </header>
        <section className="exhibit-lobby-card">
          <span className="exhibit-kicker">PRIVATE ROOM</span>
          <h1>Waiting room</h1>
          <div className="exhibit-room-code-card">
            <span>{session.code}</span>
            <button onClick={() => { void navigator.clipboard?.writeText(session.code); setStatus("Code copied."); }}>COPY</button>
          </div>
          <div className="exhibit-waiting-roster">
            <div className="exhibit-waiting-head"><strong>Players</strong><span>{playerList.length}/8</span></div>
            <div className="exhibit-waiting-grid">
              {playerList.map((player) => (
                <div className={"exhibit-waiting-player " + (player.id === session.player_id ? "is-you" : "")} key={player.id}>
                  <b>{player.name.slice(0, 1).toUpperCase()}</b>
                  <span>{player.name}{player.id === session.player_id ? " (YOU)" : ""}</span>
                  {player.id === snapshot.room.host_player_id && <i>HOST</i>}
                </div>
              ))}
            </div>
          </div>
          <div className="exhibit-lobby-footer">
            <p>{isHost ? (playerList.length < 2 ? "Invite one more player to begin." : "Your team is ready.") : "Waiting for the host to begin."}</p>
            {isHost ? (
              <button className="exhibit-primary" onClick={() => void startGame()} disabled={busy || playerList.length < 2}>
                {busy ? "STARTING..." : "START INVESTIGATION"} <span>↗</span>
              </button>
            ) : <div className="exhibit-host-wait">WAITING FOR HOST</div>}
            {status && <small>{status}</small>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="exhibit-game">
      <header className="exhibit-game-top">
        <Link href="/" className="exhibit-logo">GOHOFog<span>•</span></Link>
        <div className="exhibit-case-title"><span>CASE FILE 001</span><strong>THE MISSING EXHIBIT</strong></div>
        <div className="exhibit-top-right"><span className="exhibit-room-code">ROOM {session.code}</span><strong className={seconds < 90 ? "urgent" : ""}>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</strong></div>
      </header>

      <div className="exhibit-game-layout">
        <aside className="exhibit-left-rail">
          <section className="exhibit-panel exhibit-people">
            <div className="exhibit-panel-title">INVESTIGATORS <span>{playerList.length}/8</span></div>
            {playerList.map((player, index) => (
              <div className={"exhibit-person " + (player.id === session.player_id ? "is-you" : "")} key={player.id}>
                <span className="exhibit-person-dot">{player.name.slice(0,1).toUpperCase()}</span>
                <span>{player.name}{player.id === session.player_id ? " (YOU)" : ""}<small>{roomNames[player.room_key]}</small></span>
                <i>{index + 1}</i>
              </div>
            ))}
          </section>
          <section className="exhibit-panel exhibit-bag">
            <div className="exhibit-panel-title">INVENTORY</div>
            {inventory.length === 0 ? <p className="exhibit-empty">Empty</p> : inventory.map(item => <div className="exhibit-item" key={item}><span>▣</span>{item}</div>)}
          </section>
        </aside>

        <section className="exhibit-center">
          <div className="exhibit-map-heading">
            <div><span>ROOM</span><h1>{roomNames[roomKey]}</h1></div>
          </div>
          <div className={"exhibit-world exhibit-world-" + roomKey}>
            <div className="exhibit-floor-grid" />
            {roomKey === "main" && <>
              <div className="exhibit-wall-label">MUSEUM OF ARUNIKA</div>
              <div className="exhibit-main-plinth"><span>EMPTY DISPLAY</span><b>◈</b><small>GLASS CASE 01</small></div>
              <div className="exhibit-bench bench-one" /><div className="exhibit-bench bench-two" />
              <div className="exhibit-info-desk"><span>INFORMATION</span></div>
              <button className="exhibit-hotspot hotspot-evidence" style={{left:"31%",top:"43%"}} onClick={() => void doAction("display_label")}><b>▤</b><span>EXHIBIT LABEL</span><i>{evidence.some(v=>v.startsWith("Nomor")) ? "FOUND" : "INSPECT"}</i></button>
              <button className="exhibit-hotspot hotspot-evidence" style={{left:"69%",top:"43%"}} onClick={() => void doAction("opening_hours")}><b>▧</b><span>INFO BOARD</span><i>{evidence.some(v=>v.startsWith("Jam buka")) ? "FOUND" : "INSPECT"}</i></button>
              <button className="exhibit-door" style={{left:"91%",top:"52%"}} onClick={() => void doAction("door_security")}><b>⇢</b><span>SECURITY</span></button>
            </>}
            {roomKey === "security" && <>
              <div className="exhibit-wall-label">STAFF ONLY · SECURITY</div>
              <div className="exhibit-monitor"><span>CAM 01 / CAM 02 / CAM 03</span><b>NO SIGNAL</b><small>POWER INTERRUPTED</small></div>
              <div className="exhibit-rack"><span>CONTROL RACK</span><i /><i /><i /></div>
              <button className="exhibit-hotspot hotspot-panel" style={{left:"50%",top:"44%"}} onClick={() => void doAction("security_panel")}><b>⌑</b><span>ACCESS PANEL</span><i>{snapshot?.room.state.security_solved ? "UNLOCKED" : "ENTER CODE"}</i></button>
              <button className="exhibit-door exhibit-door-left" style={{left:"9%",top:"52%"}} onClick={() => void doAction("door_main")}><b>⇠</b><span>MAIN HALL</span></button>
              <button className="exhibit-door" style={{left:"91%",top:"52%"}} onClick={() => void doAction("door_archive")}><b>{snapshot?.room.state.archive_unlocked ? "⇢" : "▣"}</b><span>ARCHIVE</span></button>
            </>}
            {roomKey === "archive" && <>
              <div className="exhibit-wall-label">RESTRICTED DOCUMENT ARCHIVE</div>
              <div className="exhibit-file-cabinets"><span>FILE 01</span><span>FILE 02</span><span>FILE 03</span></div>
              <div className="exhibit-document-table"><span>SEALED DOCUMENT</span><b>◫</b><small>DELIVERY RECORD</small></div>
              <button className="exhibit-hotspot hotspot-document" style={{left:"50%",top:"45%"}} onClick={() => void doAction("archive_clue")}><b>▤</b><span>DELIVERY RECORD</span><i>{snapshot?.room.state.clue_found ? "READ" : "INSPECT"}</i></button>
              <button className="exhibit-door exhibit-door-left" style={{left:"9%",top:"52%"}} onClick={() => void doAction("door_security")}><b>⇠</b><span>SECURITY</span></button>
            </>}
            {playerList.filter(p => p.room_key === roomKey).map(player => {
              const point = player.id === session.player_id ? myPos : { x: player.x, y: player.y };
              return <div className={"exhibit-player-marker " + (player.id === session.player_id ? "is-self" : "")} key={player.id} style={{left:point.x+"%",top:point.y+"%"}}>
                <b>{player.name.slice(0,1).toUpperCase()}</b><span>{player.id === session.player_id ? "YOU" : player.name}</span>
              </div>;
            })}
            <div className="exhibit-world-corner">{playerList.filter(p=>p.room_key===roomKey).length} HERE</div>
          </div>
          <div className="exhibit-controls">
            <div className="exhibit-joystick" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);joystick(e);}} onPointerMove={e=>{if(e.buttons)joystick(e);}} onPointerUp={()=>{stickRef.current={x:0,y:0};}} onPointerCancel={()=>{stickRef.current={x:0,y:0};}}>
              <span className="joystick-north">▲</span><span className="joystick-south">▼</span><span className="joystick-west">◀</span><span className="joystick-east">▶</span><b />
            </div>
            <div className="exhibit-control-copy"><strong>MOVE</strong><span>Joystick · WASD</span><small>SHIFT · Sprint</small></div>
            <div className="exhibit-control-badge">2D<br /><b>CO-OP</b></div>
          </div>
          {status && <div className="exhibit-status-line" role="status">{status}</div>}
        </section>

        <aside className="exhibit-right-rail">
          <section className="exhibit-panel exhibit-evidence">
            <div className="exhibit-panel-title">EVIDENCE BOARD <span>{evidence.length} FOUND</span></div>
            {evidence.length === 0 ? <div className="exhibit-evidence-empty"><b>⌕</b><p>No evidence yet.</p></div> : evidence.map((item,index)=><div className="exhibit-evidence-card" key={item}><i>0{index+1}</i><span>{item}</span><b>✓</b></div>)}
          </section>
          <section className="exhibit-panel exhibit-room-map">
            <div className="exhibit-panel-title">MUSEUM DIRECTORY</div>
            <div className="exhibit-mini-map">
              <div className={"mini-room mini-archive "+(roomKey==="archive"?"current":"")}>ARCHIVE</div>
              <div className="mini-connector vertical" />
              <div className={"mini-room mini-security "+(roomKey==="security"?"current":"")}>SECURITY</div>
              <div className="mini-connector horizontal" />
              <div className={"mini-room mini-main "+(roomKey==="main"?"current":"")}>MAIN HALL</div>
            </div>
            
          </section>
          <section className="exhibit-panel exhibit-room-actions">
            
            <div className="exhibit-room-code-large">{session.code}</div>
            <button className="exhibit-copy" onClick={() => { void navigator.clipboard?.writeText(session.code); setStatus("Room code copied."); }}>COPY ROOM CODE</button>
            <button className="exhibit-exit" onClick={() => void leaveGame()}>LEAVE GAME</button>
          </section>
        </aside>
      </div>

      {inspectPopup && <div className="exhibit-modal-backdrop" onClick={() => setInspectPopup(null)}>
        <section className="exhibit-inspect-modal" role="dialog" aria-modal="true" aria-labelledby="exhibit-inspect-title" onClick={event => event.stopPropagation()}>
          <span className="exhibit-kicker">EVIDENCE</span>
          <h2 id="exhibit-inspect-title">{inspectPopup.title}</h2>
          <p>{inspectPopup.body}</p>
          <button className="exhibit-primary" onClick={() => setInspectPopup(null)}>CONTINUE</button>
        </section>
      </div>}

      {panelOpen && <div className="exhibit-modal-backdrop">
        <form className="exhibit-panel-modal" onSubmit={solvePanel}>
          <span className="exhibit-kicker">SECURITY</span>
          <h2>Unlock Archive</h2>
          <p>Enter the code from the two clues.</p>
          <div className="exhibit-code-hints">
            <span>EXHIBIT NO. <b>{snapshot?.room.state.inventory_found ? "43" : "??"}</b></span>
            <span>OPENING <b>{snapshot?.room.state.opening_found ? "09" : "??"}</b></span>
          </div>
          <input value={answer} onChange={e=>setAnswer(e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="_ _ _ _" inputMode="numeric" maxLength={4} autoFocus />
          <button className="exhibit-primary" disabled={busy || answer.length!==4}>{busy ? "CHECKING..." : "UNLOCK ARCHIVE"}</button>
          <button type="button" className="exhibit-modal-cancel" onClick={()=>setPanelOpen(false)}>CANCEL</button>
        </form>
      </div>}

      {(completed || expired) && <div className="exhibit-finish-overlay">
        <div className="exhibit-finish-card">
          <span className="exhibit-kicker">{completed ? "CASE FILE · UPDATED" : "CASE FILE · CLOSED"}</span>
          <div className="exhibit-finish-icon">{completed ? "◈" : "⌛"}</div>
          <h2>{completed ? "THE CLUE IS FOUND" : "TIME'S UP"}</h2>
          <p>{completed ? "The records reveal that Kompas Arunika was scheduled for shipment at 22:30 through the North Dock. The investigation has uncovered the next lead." : "The museum's transport window has passed. The team ran out of time before finding the final record."}</p>
          <button className="exhibit-primary" onClick={() => void leaveGame()}>RETURN TO GAME HUB</button>
        </div>
      </div>}
    </main>
  );
}
