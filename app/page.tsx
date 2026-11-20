"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Room = { id: string; code: string; status: string; round: number };
type Player = { id: string; room_id: string; name: string; hp: number; max_hp: number; ammo: number; role: string | null; item: string | null; round_wins: number; is_alive: boolean; is_ready: boolean; ability_used: boolean; ability_cooldown: number; item_uses: number };\n

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
  const [abilityBusy, setAbilityBusy] = useState(false);\n  const [abilityTarget, setAbilityTarget] = useState("");\n  const [guessedRole, setGuessedRole] = useState("KING");

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
    if ((me.role === "DETECTIVE" || me.role === "NINJA") && !abilityTarget) {
      setError("Pilih target ability dulu.");
      return;
    }
    setAbilityBusy(true);
    const { error } = await supabase.functions.invoke("use-ability", {
      body: {
        room_id: room.id,
        player_id: me.id,
        target_player_id: abilityTarget || null,
        guessed_role: me.role === "DETECTIVE" ? guessedRole : null
      }
    });
    if (error) setError(error.message);
    setAbilityBusy(false);
    await loadPlayers(room.id);
    await loadGameState(room.id);
  }

  async function skipAbility() {
    if (!room || !me || me.ability_used || abilityBusy) return;
    setAbilityBusy(true);
    const { error } = await supabase.functions.invoke("use-ability", {
      body: { room_id: room.id, player_id: me.id, skip: true }
    });
    if (error) setError(error.message);
    setAbilityBusy(false);
    await loadPlayers(room.id);
    await loadGameState(room.id);
  }
